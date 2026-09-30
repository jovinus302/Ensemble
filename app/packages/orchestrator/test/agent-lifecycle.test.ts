import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { CodexSessionConnector } from '@ensemble/agents';
import { project, type AnyEvent } from '@ensemble/core';
import type { LlmProvider, LlmRequest } from '@ensemble/llm';
import { MemoryLedgerStore } from '@ensemble/store';
import { ProjectManager } from '../src/pm.ts';

// Handoff material and agent lifetime through the PM, a real CodexSessionConnector and the fake app-server.
let n = 0;
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

const FLOW = '# 흐름 설계\n1. 가입 → 2. 요금제 비교 → 3. 완료';

async function fixture(mode: 'inputs' | 'question', quote = '가입', answer?: (request: LlmRequest) => Record<string, unknown> | undefined) {
  const ctx = { projectId: `lifecycle-${++n}`, targetProductId: 'product' };
  const root = await mkdtemp(path.join(tmpdir(), 'ensemble-lifecycle-'));
  const llm: LlmProvider = { async complete(request) {
    const input: Record<string, unknown> = answer?.(request) ?? (request.forceTool === 'route_message'
      ? { kind: 'answer', taskId: 'prototype', questionId: 'question:prototype:1' }
      : { conditions: [{ index: 1, met: true, file: /### 파일: ([^\n]+)/.exec(request.messages[0]!.content)?.[1] ?? '', quote }], decisionConflicts: [] });
    return { text: '', model: 'fake', responseId: 'r', usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [{ name: request.forceTool!, input }] };
  } };
  const store = new MemoryLedgerStore();
  const connector = new CodexSessionConnector({ workspaceRoot: root, rpc: { command: process.execPath,
    args: [fileURLToPath(new URL('../../agents/test/fixtures/fake-app-server.mjs', import.meta.url))],
    env: { ...process.env, ENSEMBLE_FAKE_PROTOCOL: mode, ENSEMBLE_FAKE_DUPLICATE: '1' } } });
  const pm = new ProjectManager({ ...ctx, store, llm, connector, model: 'fake' });
  cleanup.push(async () => { await pm.stop(); await rm(root, { recursive: true, force: true }); });
  const owner = { kind: 'human' as const, id: 'owner' };
  await store.append([
    { ...ctx, actor: owner, type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: '사용자' } },
    { ...ctx, actor: owner, type: 'member_joined', payload: { memberId: 'designer', kind: 'human', displayName: '디자이너' } },
    { ...ctx, actor: owner, type: 'member_joined', payload: { memberId: 'prototype-agent', kind: 'agent', displayName: '프로토타입 Agent' } },
    { ...ctx, actor: owner, type: 'goal_set', payload: { text: 'PT 예약 프로토타입', decider: 'owner', delegation: { pmMayApply: [] } } },
    { ...ctx, actor: owner, type: 'plan_committed', payload: { version: 1, basedOn: null, reason: 'approved', approvedBy: 'owner', sourceMessageIds: [], tasks: [
      { id: 'design', title: '흐름 설계', assignee: 'designer', dependsOn: [], handoffConditions: ['가입부터 완료까지 3화면'] },
      { id: 'prototype', title: '프로토타입', assignee: 'prototype-agent', dependsOn: ['design'], handoffConditions: ['흐름 설계대로 클릭 가능'] },
    ] } },
  ]);
  const events = async () => await store.read({ projectId: ctx.projectId }) as AnyEvent[];
  const workspace = path.join(root, ctx.projectId, 'prototype-agent');
  const instructions = async () => (await readdir(workspace)).filter(name => name.startsWith('instructions-')).sort();
  // The designer hands over the flow as an attachment on the design task.
  const handOver = () => pm.postMessage('designer', '흐름 설계 올립니다', [{ name: 'flow.md', mimeType: 'text/markdown', content: FLOW, taskId: 'design' }]);
  return { pm, store, events, workspace, instructions, handOver };
}

it('copies a human attachment into the next agent workspace and names its path, original name and uploader', async () => {
  const f = await fixture('inputs');
  await f.handOver();
  await vi.waitFor(async () => expect((await f.events()).some(e => e.type === 'result_submitted' && e.payload.taskId === 'prototype')).toBe(true), { timeout: 5000 });
  await f.pm.flush();
  const copied = path.join(f.workspace, 'inputs', '흐름 설계', 'flow.md');
  expect(await readFile(copied, 'utf8')).toBe(FLOW);
  const [first] = await f.instructions();
  const text = await readFile(path.join(f.workspace, first!), 'utf8');
  expect(text).toContain('결과 파일: inputs/흐름 설계/flow.md (원래 이름: flow.md, 올린 사람: 디자이너, 선행 작업: 흐름 설계)');
  expect(text).toContain('선행 작업 "흐름 설계"에서 확인된 인계 조건: 가입부터 완료까지 3화면');
  const attachmentId = (await f.events()).find(e => e.type === 'attachment_recorded' && e.payload.name === 'flow.md')!.payload;
  expect(text).not.toContain((attachmentId as { attachmentId: string }).attachmentId);
  // The agent read the handed-over file and built on it.
  expect(await readFile(path.join(f.workspace, 'prototype.html'), 'utf8')).toContain('가입 → 2. 요금제 비교');
  expect(project(await f.events()).tasks.get('prototype')?.status).toBe('checked');
});

it('relays a file question to its uploader, then resumes the stopped agent with a new turn on the same thread', async () => {
  const f = await fixture('question');
  await f.handOver();
  await vi.waitFor(async () => expect((await f.events()).some(e => e.type === 'turn_observed' && e.payload.taskId === 'prototype' && e.payload.status === 'completed')).toBe(true), { timeout: 5000 });
  const posts = await f.pm.flush();
  const ask = posts.find(post => post.kind === 'ask');
  expect(ask?.text).toBe('@디자이너 "프로토타입" 작업을 맡은 프로토타입 Agent가 묻습니다. 흐름 설계 파일의 첫 화면이 무엇인가요?');
  const channel = (await f.events()).flatMap(e => e.type === 'reply_recorded' || e.type === 'pm_spoke' ? [e.payload.text] : []).join('\n');
  expect(channel).not.toMatch(/question:|Agent question|Options|질문 전달/);
  expect(project(await f.events()).activeTurn.has('prototype-agent')).toBe(false);

  await f.pm.postMessage('designer', '첫 화면은 가입입니다');
  await vi.waitFor(async () => expect((await f.events()).some(e => e.type === 'result_submitted' && e.payload.taskId === 'prototype')).toBe(true), { timeout: 5000 });
  await f.pm.flush();
  const events = await f.events();
  const turns = events.flatMap(e => e.type === 'task_started' && e.payload.taskId === 'prototype' ? [e.payload.turnId] : []);
  expect(turns).toHaveLength(2);
  expect(events.find(e => e.type === 'update_sent')?.payload).toMatchObject({ updateId: 'answer:question:prototype:1', turnId: turns[1] });
  expect(events.find(e => e.type === 'update_acknowledged')?.payload).toMatchObject({ updateId: 'answer:question:prototype:1' });
  expect(events.find(e => e.type === 'change_notified')?.payload).toMatchObject({ recipientId: 'prototype-agent', via: 'next_turn' });
  expect(await readFile(path.join(f.workspace, 'answer.md'), 'utf8')).toContain('첫 화면은 가입입니다');
  // The thread already has the task, so the follow-up turn carries only the answer.
  const files = await f.instructions();
  expect(files).toHaveLength(2);
  const followUp = await readFile(path.join(f.workspace, files[1]!), 'utf8');
  expect(followUp).toContain('변경 ID: answer:question:prototype:1');
  expect(followUp).toContain('- 질문 "흐름 설계 파일의 첫 화면이 무엇인가요?"에 대한 답: 첫 화면은 가입입니다');
  expect(followUp).not.toContain('# 작업 지시');

  // Nothing is delivered twice.
  await f.pm.deliverPendingChanges(); await f.pm.flush();
  expect((await f.events()).filter(e => e.type === 'task_started')).toHaveLength(2);
  expect(await f.instructions()).toHaveLength(2);
});

it('delivers a change recorded for next turn to an agent whose turn ended, once, and takes its acknowledgement', async () => {
  const f = await fixture('question');
  await f.handOver();
  await vi.waitFor(async () => expect((await f.events()).some(e => e.type === 'turn_observed' && e.payload.taskId === 'prototype' && e.payload.status === 'completed')).toBe(true), { timeout: 5000 });
  await f.pm.flush();
  // What the coordinator records for an agent without a live turn.
  const ctx = { projectId: (await f.events())[0]!.projectId, targetProductId: 'product' };
  await f.store.append([{ ...ctx, actor: { kind: 'system', id: 'pm' }, type: 'change_notified', idempotencyKey: 'notify:c1', payload: { changeId: 'c1', planVersion: 1, recipientId: 'prototype-agent', via: 'next_turn',
    text: JSON.stringify({ summary: '결제는 제외합니다', tasks: [{ id: 'prototype', title: '프로토타입', handoffConditions: ['흐름 설계대로 클릭 가능', '제외: 결제'] }], drop: ['결제'] }) } }]);
  await Promise.all([f.pm.deliverPendingChanges(), f.pm.deliverPendingChanges()]);
  await vi.waitFor(async () => expect((await f.events()).some(e => e.type === 'update_acknowledged')).toBe(true), { timeout: 5000 });
  await f.pm.flush();
  const events = await f.events();
  expect(events.filter(e => e.type === 'update_sent').map(e => e.payload)).toEqual([expect.objectContaining({ updateId: 'c1:prototype-agent:turn' })]);
  expect(events.find(e => e.type === 'update_acknowledged')?.payload).toMatchObject({ dropped: ['결제'] });
  expect(events.filter(e => e.type === 'task_started')).toHaveLength(2);
  expect(events.some(e => e.type === 'result_submitted' && e.payload.taskId === 'prototype')).toBe(true);
});

it('sends a technical judge failure to the decider, not the submitter, keeps the citation record, and never asks for a revision', async () => {
  const f = await fixture('inputs', '');
  const posts = await f.handOver();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ kind: 'ask', text: expect.stringMatching(/^@사용자 "흐름 설계" 결과: .*검토 과정의 문제예요\. '다시 검토'로 검토를 다시 돌리거나, 결정권자가 결과를 보고 '이대로 확인'할 수 있어요\.$/) });
  expect(posts[0]!.text).not.toMatch(/@디자이너|보완/);
  const events = await f.events();
  const considered = events.find(e => e.type === 'pm_considered' && e.payload.considerationId.startsWith('handoff-notice:'));
  expect(considered?.payload).toMatchObject({ whoseAction: expect.stringMatching(/^owner:/), evidence: expect.arrayContaining([expect.stringContaining('인용 확인 실패: 조건 "가입부터 완료까지 3화면"')]) });
  expect(events.some(e => e.type === 'revision_requested' || e.type === 'task_checked')).toBe(false);
  expect(project(events).tasks.get('design')?.status).toBe('submitted');
});

it('delivers an answer the coordinator found while staying silent, to an ended-turn agent in a new turn, exactly once', async () => {
  const calls: string[] = [];
  const f = await fixture('question', '가입', request => {
    calls.push(request.forceTool!);
    if (request.forceTool === 'route_message') return { kind: 'chat' };
    if (!request.forceTool!.endsWith('_coordination')) return undefined;
    const facts = JSON.parse(request.messages[0]!.content).facts;
    if (request.forceTool === 'interpret_coordination') return { category: 'chat', summary: '', ops: [], conflicts: [], factMentions: [],
      conversation: { questionMessageId: null, waitingOnMemberIds: [], directedToPm: false },
      agentAnswers: facts.pendingAgentQuestions.map((q: { questionId: string }) => ({ questionId: q.questionId, sourceMessageIds: [facts.messageId] })) };
    if (request.forceTool === 'judge_coordination') return { whoseAction: null, alreadyKnows: 'yes', evidence: [], decision: 'silent', reason: '이미 나온 말의 반복', openTopics: [], text: '', targetMemberIds: [], changesOpenQuestionAnswer: false, answerFactIds: [] };
    return undefined;
  });
  await f.handOver();
  await vi.waitFor(async () => expect((await f.events()).some(e => e.type === 'turn_observed' && e.payload.taskId === 'prototype' && e.payload.status === 'completed')).toBe(true), { timeout: 5000 });
  await f.pm.flush();
  expect(await f.pm.postMessage('designer', '@프로토타입 Agent 첫 화면은 가입입니다')).toEqual([]);
  expect(calls).toEqual(expect.arrayContaining(['route_message', 'interpret_coordination', 'judge_coordination']));
  await vi.waitFor(async () => expect((await f.events()).some(e => e.type === 'result_submitted' && e.payload.taskId === 'prototype')).toBe(true), { timeout: 5000 });
  await f.pm.deliverPendingChanges(); await f.pm.flush();
  const events = await f.events();
  expect(events.filter(e => e.type === 'change_notified').map(e => e.payload)).toEqual([expect.objectContaining({ changeId: 'answer:question:prototype:1', via: 'next_turn', text: '@프로토타입 Agent 첫 화면은 가입입니다' })]);
  expect(events.filter(e => e.type === 'update_sent')).toHaveLength(1);
  expect(events.filter(e => e.type === 'task_started')).toHaveLength(2);
  expect(events.find(e => e.type === 'update_acknowledged')?.payload).toMatchObject({ updateId: 'answer:question:prototype:1' });
  expect(await f.instructions()).toHaveLength(2);
});
