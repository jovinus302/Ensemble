import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { CodexSessionConnector, type SessionEvent, type TaskInstructionsInput } from '@ensemble/agents';
import { project, type AnyEvent } from '@ensemble/core';
import type { LlmProvider, LlmRequest } from '@ensemble/llm';
import { MemoryLedgerStore } from '@ensemble/store';
import { ProjectManager } from '../src/pm.ts';

let n = 0;
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

/** A real CodexSessionConnector over the fake app-server, driven through the PM. */
async function fixture(mode: string, options: { turnTimeoutMs?: number; tasks?: string[] } = {}) {
  const ctx = { projectId: `agent-results-${++n}`, targetProductId: 'product' };
  const root = await mkdtemp(path.join(tmpdir(), 'ensemble-agent-results-'));
  const requests: LlmRequest[] = [];
  const llm: LlmProvider = { async complete(request) {
    requests.push(request);
    const file = /### 파일: ([^\n]+)/.exec(request.messages[0]!.content)?.[1];
    return { text: '', model: 'fake', responseId: 'r', usage: { inputTokens: 0, outputTokens: 0 },
      toolCalls: [{ name: request.forceTool!, input: { conditions: [{ index: 1, met: true, file, quote: '가입 흐름' }], decisionConflicts: [] } }] };
  } };
  const store = new MemoryLedgerStore();
  const connector = new CodexSessionConnector({ workspaceRoot: root, rpc: { command: process.execPath,
    args: [fileURLToPath(new URL('../../agents/test/fixtures/fake-app-server.mjs', import.meta.url))],
    env: { ...process.env, ENSEMBLE_FAKE_PROTOCOL: mode, ENSEMBLE_FAKE_DUPLICATE: '1' } } });
  const sessionEvents: SessionEvent[] = [];
  connector.onEvent(event => sessionEvents.push(event));
  const pm = new ProjectManager({ ...ctx, store, llm, connector, model: 'fake', turnTimeoutMs: options.turnTimeoutMs });
  cleanup.push(async () => { await pm.stop(); await rm(root, { recursive: true, force: true }); });
  const human = { kind: 'human' as const, id: 'owner' };
  const tasks = options.tasks ?? ['research'];
  await store.append([
    { ...ctx, actor: human, type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: '사용자' } },
    { ...ctx, actor: human, type: 'member_joined', payload: { memberId: 'research-agent', kind: 'agent', displayName: '조사 Agent' } },
    { ...ctx, actor: human, type: 'goal_set', payload: { text: '대안 조사', decider: 'owner', delegation: { pmMayApply: [] } } },
    { ...ctx, actor: human, type: 'plan_committed', payload: { version: 1, basedOn: null, reason: 'approved', approvedBy: 'owner', sourceMessageIds: [],
      tasks: tasks.map(id => ({ id, title: '대안 2개를 표로', assignee: 'research-agent', dependsOn: [], handoffConditions: ['대안 2개가 표로 비교되어 있다'] })) } },
  ]);
  const input = (taskId: string): TaskInstructionsInput => ({ taskId, planVersion: 1, goalSummary: { text: '대안 조사', sourceId: 'goal' },
    taskTitle: { text: '대안 2개를 표로', sourceId: 'plan' }, handoffConditions: [], decisions: [], inputs: [], openQuestions: [] });
  const start = async (taskId = tasks[0]!) => { await pm.sessions.startSession('research-agent'); return pm.sessions.startTask('research-agent', input(taskId)); };
  const events = async () => await store.read({ projectId: ctx.projectId }) as AnyEvent[];
  return { pm, store, root, requests, sessionEvents, start, events, workspace: path.join(root, ctx.projectId, 'research-agent') };
}

it('records the reported file as a channel attachment with a human summary, then runs the handoff judgement on it', async () => {
  const f = await fixture('result');
  const turnId = await f.start();
  await vi.waitFor(async () => expect((await f.events()).some(e => e.type === 'handoff_reviewed')).toBe(true));
  await f.pm.flush();
  const events = await f.events();
  const attachments = events.filter(e => e.type === 'attachment_recorded');
  expect(attachments).toHaveLength(1);
  const attachment = attachments[0]!.payload;
  expect(attachment).toMatchObject({ name: 'alternatives-research.md', mimeType: 'text/markdown', taskId: 'research' });
  expect(Buffer.from(attachment.uri.split(',')[1]!, 'base64').toString('utf8')).toContain('| A | 가입 흐름 |');
  expect(events.find(e => e.type === 'result_submitted')?.payload).toMatchObject({ resultId: `result:${turnId}:0`, artifactIds: [attachment.attachmentId] });
  const summary = events.find(e => e.type === 'reply_recorded' && e.payload.attachmentIds?.length);
  expect(summary?.payload).toMatchObject({ memberId: 'research-agent', taskId: 'research', attachmentIds: [attachment.attachmentId],
    text: expect.stringContaining('무엇이 됐나: 대안 2개를 표로 정리했습니다') });
  // The judge saw the attached file's content.
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0]!.messages[0]!.content).toContain('| A | 가입 흐름 |');
  expect(project(events).tasks.get('research')?.status).toBe('checked');
  expect(events.some(e => e.type === 'agent_report_recorded')).toBe(true);
  expect(events.some(e => e.type === 'reply_recorded' && e.payload.text.includes('```ensemble-report'))).toBe(false);
});

it('keeps one thread per agent: the next task, started by the handoff, is a new turn on the same thread', async () => {
  const f = await fixture('result', { tasks: ['first', 'second'] });
  const first = await f.start('first');
  await vi.waitFor(async () => expect((await f.events()).filter(e => e.type === 'result_submitted')).toHaveLength(2));
  await f.pm.flush();
  const events = await f.events();
  const second = events.flatMap(e => e.type === 'task_started' && e.payload.taskId === 'second' ? [e.payload.turnId] : [])[0];
  expect(second).toBeDefined();
  const turns = f.sessionEvents.filter(e => e.type === 'turn');
  expect(new Set(turns.map(e => e.turnId))).toEqual(new Set([first, second]));
  expect(new Set(turns.map(e => e.threadId)).size).toBe(1);
  expect(events.filter(e => e.type === 'session_linked')).toHaveLength(1);
  expect(events.filter(e => e.type === 'result_submitted').map(e => e.payload.taskId)).toEqual(['first', 'second']);
});

it.each([
  ['linked', 'outside the workspace'],
  ['big', 'exceeds'],
  ['missing', 'not found'],
])('rejects a %s result file without attaching it', async (mode, reason) => {
  const f = await fixture(mode);
  if (mode === 'linked') {
    // A junction inside the workspace pointing at a secret outside it.
    const outside = await mkdtemp(path.join(tmpdir(), 'ensemble-outside-'));
    cleanup.push(() => rm(outside, { recursive: true, force: true }));
    await writeFile(path.join(outside, 'secret.md'), 'secret');
    await mkdir(f.workspace, { recursive: true });
    await symlink(outside, path.join(f.workspace, 'link'), 'junction');
  }
  await f.start();
  await vi.waitFor(async () => expect((await f.events()).some(e => e.type === 'turn_observed' && e.payload.status === 'completed')).toBe(true));
  await f.pm.flush();
  const events = await f.events();
  expect(events.filter(e => e.type === 'attachment_recorded' || e.type === 'result_submitted')).toHaveLength(0);
  expect(events).toContainEqual(expect.objectContaining({ type: 'reply_recorded', payload: expect.objectContaining({ text: expect.stringContaining(reason) }) }));
  expect(f.requests).toHaveLength(0);
  expect(project(events).tasks.get('research')?.status).toBe('blocked');
  expect(events.filter(e => e.type === 'pm_spoke')).toHaveLength(1);
});

it('blocks the task with one PM notice when the turn exceeds its time limit, without restarting it', async () => {
  const f = await fixture('hang', { turnTimeoutMs: 150 });
  const turnId = await f.start();
  await vi.waitFor(async () => expect((await f.events()).some(e => e.type === 'turn_observed' && e.payload.status === 'interrupted')).toBe(true));
  const posts = await f.pm.flush();
  expect(posts).toEqual([expect.objectContaining({ text: expect.stringContaining('제한 시간') })]);
  const events = await f.events();
  expect(events.filter(e => e.type === 'task_blocked')).toEqual([expect.objectContaining({ idempotencyKey: `turn-blocked:${turnId}` })]);
  expect(events.filter(e => e.type === 'pm_spoke')).toHaveLength(1);
  expect(events.filter(e => e.type === 'task_started')).toHaveLength(1);
  const state = project(events);
  expect(state.tasks.get('research')?.status).toBe('blocked');
  expect(state.activeTurn.has('research-agent')).toBe(false);
});

it('blocks the task with one PM notice when the agent session fails', async () => {
  const f = await fixture('fail');
  await f.start();
  await vi.waitFor(async () => expect((await f.events()).some(e => e.type === 'task_blocked')).toBe(true));
  const posts = await f.pm.flush();
  expect(posts).toEqual([expect.objectContaining({ text: expect.stringContaining('fake model failure') })]);
  const events = await f.events();
  expect(events.filter(e => e.type === 'pm_spoke')).toHaveLength(1);
  expect(project(events).tasks.get('research')?.status).toBe('blocked');
});
