import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { MemoryLedgerStore } from '@ensemble/store';
import { project, type AnyEvent } from '@ensemble/core';
import { updateInstructions, type SessionConnector, type SessionEvent, type TaskInstructionsInput, type UpdateInstructionsInput } from '@ensemble/agents';
import type { LlmProvider, LlmRequest } from '@ensemble/llm';
import { SCENE_NOW, scene2, scene3, sceneEvents, sceneTasks } from '@ensemble/scenarios';
import { ProjectManager } from '../src/pm.ts';
import { buildTaskContext } from '../src/context.ts';

class FakeConnector implements SessionConnector {
  handlers = new Set<(e: SessionEvent) => void>();
  starts: TaskInstructionsInput[] = [];
  updates: UpdateInstructionsInput[] = [];
  workspace = '/fake';
  async startSession(agentId: string) { return { threadId: `thread:${agentId}`, workspace: this.workspace }; }
  async startTask(_agent: string, input: TaskInstructionsInput) { this.starts.push(input); return `turn:${input.taskId}`; }
  async sendUpdate(_agent: string, input: UpdateInstructionsInput) { this.updates.push(input); return { sent: true as const }; }
  onEvent(handler: (e: SessionEvent) => void) { this.handlers.add(handler); return () => { this.handlers.delete(handler); }; }
  async stop() {}
  emit(event: SessionEvent) { for (const handler of this.handlers) handler(event); }
}
type Reply = (request: LlmRequest) => Record<string, unknown>;
function llm(replies: Reply[]): LlmProvider {
  return { async complete(request) {
    const reply = replies.shift();
    if (!reply) throw new Error(`Unexpected call ${request.forceTool}`);
    return { text: '', model: 'fake', responseId: 'r', usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [{ name: request.forceTool!, input: reply(request) }] };
  } };
}
const routeResult: Reply = () => ({ kind: 'result', taskId: 'design' });
const handoff = (complete: boolean): Reply => request => {
  const file = /### 파일: ([^\n]+)/.exec(request.messages[0]!.content)![1]!;
  return { conditions: [{ index: 1, met: true, file, quote: '가입 흐름' }, complete ? { index: 2, met: true, file, quote: '오류 흐름' } : { index: 2, met: false, missing: '오류 안내와 재입력 흐름을 추가해 주세요' }], decisionConflicts: [] };
};
const context = { projectId: 'scene-test', targetProductId: 'product' };
async function setup(scene: 2 | 3, replies: Reply[]) {
  const store = new MemoryLedgerStore();
  await store.append(sceneEvents(scene, context));
  const connector = new FakeConnector();
  const pm = new ProjectManager({ ...context, store, connector, llm: llm(replies), model: 'fake', clock: () => SCENE_NOW, readResult: async result => Object.fromEntries(result.artifactIds.map(id => [id, '가입 결제'])) });
  return { pm, connector, store };
}

it('scene 2: insufficient draft requests revision, supplemented draft starts prototype exactly once with six context fields', async () => {
  const f = await setup(2, [routeResult, handoff(false), routeResult, handoff(true)]);
  await f.store.append([
    { ...context, actor: { kind: 'human', id: 'owner' }, type: 'message_recorded', payload: { messageId: 'prototype-context', authorId: 'owner', text: 'prototype은 초안 기준으로 진행합니다.', attachmentIds: [] } },
    { ...context, actor: { kind: 'human', id: 'owner' }, type: 'decision_recorded', payload: { decisionId: 'privacy', summary: 'prototype에 실명 정보는 넣지 않는다', sourceMessageIds: ['prototype-context'], approvedBy: 'owner', changeKinds: ['scope_reduce'] } },
    { ...context, actor: { kind: 'system', id: 'pm' }, type: 'pm_spoke', payload: { considerationId: 'initial-question', messageId: 'question:prototype:1', kind: 'ask', text: 'prototype 색상 확인이 필요합니다.' } },
  ]);
  const first = scene2[0]!;
  const revision = await f.pm.postMessage(first.as, first.text, first.attachments);
  expect(revision[0]?.text).toContain('오류');
  expect(f.connector.starts).toHaveLength(0);
  const next = scene2[1]!;
  await f.pm.postMessage(next.as, next.text, next.attachments);
  expect(f.connector.starts).toHaveLength(1);
  const input = f.connector.starts[0]!;
  expect(input).toMatchObject({ taskId: 'prototype', planVersion: 1, goalSummary: { text: expect.stringContaining('고객 반응') }, taskTitle: { text: '프로토타입' }, handoffConditions: expect.any(Array), decisions: [expect.objectContaining({ sourceId: 'privacy' })], inputs: expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('결과 파일') }), expect.objectContaining({ text: expect.stringContaining('[대화]'), sourceId: 'prototype-context' })]), openQuestions: [expect.objectContaining({ sourceId: 'question:prototype:1' })] });
  const state = project(await f.store.read());
  expect(state.tasks.get('design')?.status).toBe('checked');
  expect(state.tasks.get('prototype')?.status).toBe('running');
  expect((await f.store.read()).filter(e => e.type === 'task_start_reserved' && (e.payload as { taskId: string }).taskId === 'prototype')).toHaveLength(1);
  await f.pm.stop();
});

const interpretation = (stage: number): Reply => request => {
  const { facts } = JSON.parse(request.messages[0]!.content);
  return { conversation: { questionMessageId: stage === 0 || stage === 1 ? facts.messageId : null, waitingOnMemberIds: stage === 0 ? ['owner'] : [], directedToPm: stage === 1 }, factMentions: [], category: stage === 1 ? 'question' : 'scope', summary: '초안으로 계속하고 결제는 제외합니다', conflicts: [], ops: stage === 0 ? [{ type: 'set_availability', memberId: 'designer', weeklyHours: 5, sourceMessageIds: [facts.messages.find((m: { authorId: string }) => m.authorId === 'designer').messageId] }] : stage === 3 ? sceneTasks.filter(t => t.handoffConditions.includes('결제')).map(t => ({ type: 'exclude_scope', taskId: t.id, item: '결제', sourceMessageIds: [facts.messageId] })) : [] };
};
const judgement = (stage: number): Reply => request => {
  const { facts } = JSON.parse(request.messages[0]!.content);
  return { targetMemberIds: ['owner'], changesOpenQuestionAnswer: false, answerFactIds: stage === 1 ? ['forecast:current'] : [], whoseAction: stage === 0 || stage === 2 ? null : '담당자가 다음 작업 범위를 결정', alreadyKnows: 'no', evidence: stage === 1 ? ['forecast:current', 'forecast:before_availability'] : [`msg:${facts.messageId}`], decision: stage === 0 || stage === 2 ? 'silent' : 'speak', reason: stage === 0 || stage === 2 ? '사람들이 조율 중' : '계산과 합의를 다음 작업에 반영', openTopics: [], text: stage === 1 ? `가용 시간 변경 시 종료 범위가 ${facts.factList.find((f: { id: string }) => f.id === 'forecast:current').value.days.max - facts.factList.find((f: { id: string }) => f.id === 'forecast:before_availability').value.days.max}일 늦어집니다.` : '정리하면: 결제는 제외합니다.' };
};
it('scene 3: silence, forecast answer, then summary/v2/targeted notifications and steer', async () => {
  const f = await setup(3, [0, 1, 2, 3].flatMap(stage => [interpretation(stage), judgement(stage)]));
  await f.pm.sessions.startTask('prototype-agent', buildTaskContext(project(await f.store.read()), 'prototype', await f.store.read()));
  const posts = [];
  for (const step of scene3) posts.push(await f.pm.postMessage(step.as, step.text));
  expect(posts[0]).toEqual([]);
  expect(posts[1]![0]?.text).toContain('2일');
  expect(posts[2]).toEqual([]);
  expect(posts[3]![0]?.text).toContain('정리하면');
  expect(project(await f.store.read()).plan?.version).toBe(2);
  expect(f.connector.updates).toHaveLength(1);
  expect(f.connector.updates[0]).toMatchObject({ drop: ['결제'], toVersion: 2 });
  const events = await f.store.read() as AnyEvent[];
  expect(events.filter(e => e.type === 'change_notified').map(e => e.payload.recipientId).sort()).toEqual(['prototype-agent', 'reviewer']);
  expect(events.filter(e => e.type === 'pm_considered').map(e => e.payload.decision)).toEqual(['silent', 'speak', 'silent', 'speak']);
  for (const considered of events.filter(e => e.type === 'pm_considered')) expect(considered.payload).toHaveProperty('alreadyKnows');
  await f.pm.stop();
});

it('routes question → person answer → acknowledged update → result handoff through SessionRunner', async () => {
  const f = await setup(3, [() => ({ kind: 'answer', taskId: 'prototype', questionId: 'question:prototype:1' }), request => { const file = /### 파일: ([^\n]+)/.exec(request.messages[0]!.content)![1]!; return { conditions: [{ index: 1, met: true, file, quote: '가입' }, { index: 2, met: true, file, quote: '결제' }], decisionConflicts: [] }; }]);
  // Reported files are read from the agent's workspace and recorded as attachments.
  f.connector.workspace = await mkdtemp(path.join(tmpdir(), 'ensemble-pm-scenes-'));
  await writeFile(path.join(f.connector.workspace, 'output.md'), '가입 결제');
  await f.pm.sessions.startSession('prototype-agent');
  await f.pm.sessions.startTask('prototype-agent', buildTaskContext(project(await f.store.read()), 'prototype', await f.store.read()));
  const base = { agentId: 'prototype-agent', taskId: 'prototype', threadId: 'thread', turnId: 'turn:prototype', type: 'report' as const, itemId: 'question', index: 0 };
  f.connector.emit({ ...base, report: { type: 'question', taskId: 'prototype', question: '가입 버튼 색은 파란색인가요?' } });
  const questionPosts = await f.pm.flush();
  expect(questionPosts[0]?.text).toContain('사용자');
  await f.pm.postMessage('owner', '네, 파란색으로 해 주세요.');
  const update = f.connector.updates[0]!;
  expect(updateInstructions(update)).toContain('acknowledge_update');
  expect(update.change[0]).toContain('파란색');
  const report = { type: 'result_report' as const, taskId: 'prototype', planVersion: 1, summary: '시제품 완성', files: [{ path: 'output.md', description: '가입 결제' }] };
  f.connector.emit({ ...base, itemId: 'result-before-ack', index: 1, report });
  await f.pm.flush();
  expect(project(await f.store.read()).tasks.get('prototype')?.status).toBe('revising');
  f.connector.emit({ ...base, itemId: 'ack', index: 2, report: { type: 'acknowledge_update', updateId: update.updateId, planVersion: 1, applied: update.change, dropped: [] } });
  await f.pm.flush();
  f.connector.emit({ ...base, itemId: 'result-after-ack', index: 3, report });
  await f.pm.flush();
  expect(project(await f.store.read()).tasks.get('prototype')?.status).toBe('checked');
  f.connector.emit({ ...base, itemId: 'result-after-ack', index: 3, report });
  await f.pm.flush();
  expect((await f.store.read()).filter(e => e.type === 'task_checked' && (e.payload as { taskId: string }).taskId === 'prototype')).toHaveLength(1);
  await f.pm.stop();
  await rm(f.connector.workspace, { recursive: true, force: true });
});


it('records immediately during PM work, processes in order, exposes activity and ignores duplicate processing', async () => {
  const store = new MemoryLedgerStore();
  await store.append(sceneEvents(3, context));
  const connector = new FakeConnector();
  const seen: string[] = [];
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const provider: LlmProvider = { async complete(request) {
    const { facts } = JSON.parse(request.messages[0]!.content);
    let input: Record<string, unknown>;
    if (request.forceTool === 'interpret_coordination') {
      seen.push(facts.messageId);
      if (seen.length === 1) { entered(); await barrier; }
      expect(facts.messages.filter((m: any) => m.authorId === 'owner').at(-1).messageId).toBe(facts.messageId);
      input = { category: 'chat', summary: '', ops: [], conflicts: [], conversation: { questionMessageId: null, waitingOnMemberIds: [], directedToPm: false }, factMentions: [] };
    } else input = { whoseAction: null, alreadyKnows: 'yes', evidence: [], decision: 'silent', reason: '행동 변화 없음', openTopics: [], text: '', targetMemberIds: [], changesOpenQuestionAnswer: false, answerFactIds: [] };
    return { text: '', model: 'fake', responseId: 'r', usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [{ name: request.forceTool!, input }] };
  } };
  const pm = new ProjectManager({ ...context, store, connector, llm: provider, model: 'fake', clock: () => SCENE_NOW });
  const first = await pm.recordMessage('owner', '첫 메시지');
  expect(pm.isProcessing).toBe(false);
  const processing = pm.processRecordedMessage(first.messageId);
  await started;
  expect(pm.isProcessing).toBe(true);
  const second = await pm.recordMessage('owner', '둘째 메시지');
  expect(project(await store.read()).messages.at(-1)?.messageId).toBe(second.messageId);
  const queued = pm.processRecordedMessage(second.messageId);
  release(); await Promise.all([processing, queued]);
  expect(seen).toEqual([first.messageId, second.messageId]);
  const count = (await store.read()).length;
  expect(await pm.processRecordedMessage(first.messageId)).toEqual([]);
  expect((await store.read()).length).toBe(count);
  expect(pm.isProcessing).toBe(false);
  await pm.postMessage('owner', '기존 진입점');
  expect(seen).toHaveLength(3);
  await pm.stop();
});
