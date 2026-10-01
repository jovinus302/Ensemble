import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { ClaudeSessionConnector, CodexSessionConnector, type TaskInstructionsInput, type UpdateInstructionsInput } from '@ensemble/agents';
import { project } from '@ensemble/core';
import { MemoryLedgerStore } from '@ensemble/store';
import { SessionRunner, type SessionRunnerOptions } from '../src/session-runner.ts';

const ctx = { projectId: 'runner-tests', targetProductId: 'product' };
const input: TaskInstructionsInput = { taskId: 'task', planVersion: 1, goalSummary: { text: 'Goal', sourceId: 'goal' },
  taskTitle: { text: 'Sections', sourceId: 'plan' }, handoffConditions: [], decisions: [], inputs: [], openQuestions: [] };
const update: UpdateInstructionsInput = { updateId: 'u1', fromVersion: 1, toVersion: 2, keep: ['signup'], change: ['interests'], drop: ['결제'], reason: 'scope' };
const runners: SessionRunner[] = [];
const roots: string[] = [];
async function fixture(mode = 'normal') {
  const store = new MemoryLedgerStore();
  const agentId = `test-${randomUUID()}`;
  const root = await mkdtemp(path.join(tmpdir(), 'ensemble-runner-')); roots.push(root);
  const connector = new CodexSessionConnector({ workspaceRoot: root, rpc: { command: process.execPath,
    args: [fileURLToPath(new URL('../../agents/test/fixtures/fake-app-server.mjs', import.meta.url))],
    env: { ...process.env, ENSEMBLE_FAKE_PROTOCOL: mode, ENSEMBLE_FAKE_DUPLICATE: '1' } } });
  const runner = new SessionRunner(connector, store, ctx); runners.push(runner);
  await store.append([
    { ...ctx, actor: { kind: 'human', id: 'user' }, type: 'member_joined', payload: { memberId: agentId, kind: 'agent', displayName: 'Agent' } },
    { ...ctx, actor: { kind: 'human', id: 'user' }, type: 'plan_committed', payload: { version: 1, basedOn: null,
      tasks: [{ id: 'task', title: 'Sections', assignee: agentId, dependsOn: [], handoffConditions: [] }],
      reason: 'approved', approvedBy: 'user', sourceMessageIds: [] } },
  ]);
  const { workspace } = await runner.startSession(agentId);
  await writeFile(path.join(workspace, 'onboarding.md'), '# 온보딩 관심 분야 선택');
  return { store, runner, agentId };
}
afterEach(async () => {
  delete process.env.ENSEMBLE_FAKE_CLAUDE;
  await Promise.all(runners.splice(0).map(runner => runner.stop()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

it('records the complete flow once despite duplicate notifications and acknowledgements preceding steer response', async () => {
  const { runner, store, agentId } = await fixture();
  const turnId = await runner.startTask(agentId, input);
  expect(project(await store.read()).activeTurn.get(agentId)).toBe('task');
  await expect(runner.startTask(agentId, input)).rejects.toThrow('작업을 시작할 수 없습니다');
  expect(await runner.sendUpdate(agentId, update)).toEqual({ sent: true });
  await runner.flush();
  await runner.sendUpdate(agentId, update); await runner.flush();
  const events = await store.read();
  for (const type of ['session_linked', 'task_started', 'update_sent', 'update_acknowledged', 'result_submitted']) {
    expect(events.filter(event => event.type === type), type).toHaveLength(1);
  }
  expect(events.filter(event => event.type === 'turn_observed')).toHaveLength(2);
  expect(events.findIndex(event => event.type === 'update_sent')).toBeLessThan(events.findIndex(event => event.type === 'update_acknowledged'));
  // The PM's steer is one automatic action by the PM, recorded once.
  expect(events.find(event => event.type === 'update_sent')?.actor).toEqual({ kind: 'pm', id: 'pm' });
  expect(events.find(event => event.type === 'task_started')?.idempotencyKey).toBe(`turn:${turnId}`);
  expect(events.find(event => event.type === 'result_submitted')).toMatchObject({ idempotencyKey: `result:${turnId}:1`, payload: { artifactIds: [expect.stringMatching(/^onboarding-md-[0-9a-f]{12}$/)], planVersion: 2 } });
  expect(events.filter(event => event.type === 'attachment_recorded')).toHaveLength(1);
  expect(project(events).activeTurn.has(agentId)).toBe(false);
  expect(project(events).tasks.get('task')?.updates[0]?.status).toBe('acknowledged');
});

it.each(['bad-ack', 'bad-result', 'unsafe-path', 'errors'])('records validation failures or questions for %s', async mode => {
  const { runner, store, agentId } = await fixture(mode);
  await runner.startTask(agentId, input); await runner.sendUpdate(agentId, update); await runner.flush();
  const events = await store.read();
  if (mode === 'bad-ack') expect(events.filter(event => event.type === 'update_rejected')).toHaveLength(1);
  if (mode === 'bad-result' || mode === 'unsafe-path') {
    expect(events.filter(event => event.type === 'result_submitted')).toHaveLength(0);
    expect(events).toContainEqual(expect.objectContaining({ type: 'reply_recorded', payload: expect.objectContaining({ text: expect.stringContaining('결과를 받지 못했습니다') }) }));
  }
  if (mode === 'errors') {
    const replies = events.filter(event => event.type === 'reply_recorded');
    expect(replies).toContainEqual(expect.objectContaining({ payload: expect.objectContaining({ text: '질문이 있습니다. Which color?\n선택지: blue / green' }) }));
    expect(replies.map(event => (event.payload as { text: string }).text).join('\n')).not.toMatch(/Agent question|Options/);
    expect(replies).toContainEqual(expect.objectContaining({ payload: expect.objectContaining({ text: expect.stringContaining('Agent 보고 형식 오류') }) }));
  }
});

it('steers a change into a live turn through deliver, never starts a second turn, and never sends it twice', async () => {
  const { runner, store, agentId } = await fixture('hold');
  const turnId = await runner.startTask(agentId, input);
  expect(await runner.deliver(agentId, 'task', update)).toEqual({ via: 'steer', sent: true, turnId });
  await runner.flush();
  expect(await runner.deliver(agentId, 'task', update)).toMatchObject({ sent: true });
  await runner.flush();
  const events = await store.read();
  expect(events.filter(event => event.type === 'task_started')).toHaveLength(1);
  expect(events.filter(event => event.type === 'update_sent')).toHaveLength(1);
  expect(events.filter(event => event.type === 'update_acknowledged')).toHaveLength(1);
});

it('delivers to a task whose turn ended with a new turn on the same thread, and leaves tasks that are not running alone', async () => {
  const { runner, store, agentId } = await fixture('question');
  expect(await runner.deliver(agentId, 'task', update)).toMatchObject({ sent: false, via: 'next_turn' });
  const first = await runner.startTask(agentId, input);
  await vi.waitFor(async () => { await runner.flush(); expect(project(await store.read()).activeTurn.has(agentId)).toBe(false); });
  const delivery = await runner.deliver(agentId, 'task', update);
  expect(delivery).toMatchObject({ via: 'next_turn', sent: true, turnId: expect.not.stringMatching(first) });
  await vi.waitFor(async () => { await runner.flush(); expect((await store.read()).some(event => event.type === 'result_submitted')).toBe(true); });
  expect(await runner.deliver(agentId, 'task', update)).toMatchObject({ sent: true });
  await runner.flush();
  const events = await store.read();
  expect(events.filter(event => event.type === 'task_started').map(event => (event.payload as { turnId: string }).turnId)).toEqual([first, delivery.sent ? delivery.turnId : '']);
  expect(events.filter(event => event.type === 'update_sent')).toHaveLength(1);
  expect(events.find(event => event.type === 'update_acknowledged')?.payload).toMatchObject({ updateId: 'u1', planVersion: 2, dropped: ['결제'] });
  expect(events.find(event => event.type === 'result_submitted')?.payload).toMatchObject({ taskId: 'task', planVersion: 2 });
});

async function claudeFixture(mode: string, options: SessionRunnerOptions = {}) {
  process.env.ENSEMBLE_FAKE_CLAUDE = mode;
  const store = new MemoryLedgerStore();
  const agentId = `test-${randomUUID()}`;
  const root = await mkdtemp(path.join(tmpdir(), 'ensemble-runner-')); roots.push(root);
  const connector = new ClaudeSessionConnector({ workspaceRoot: root, executable: process.execPath,
    executableArgs: [fileURLToPath(new URL('../../agents/test/fixtures/fake-claude.mjs', import.meta.url))] });
  const runner = new SessionRunner(connector, store, ctx, options); runners.push(runner);
  await store.append([
    { ...ctx, actor: { kind: 'human', id: 'user' }, type: 'member_joined', payload: { memberId: agentId, kind: 'agent', displayName: 'Agent' } },
    { ...ctx, actor: { kind: 'human', id: 'user' }, type: 'plan_committed', payload: { version: 1, basedOn: null,
      tasks: [{ id: 'task', title: 'Sections', assignee: agentId, dependsOn: [], handoffConditions: [] }],
      reason: 'approved', approvedBy: 'user', sourceMessageIds: [] } },
  ]);
  const { workspace } = await runner.startSession(agentId);
  await writeFile(path.join(workspace, 'out.md'), '# 결과');
  return { store, runner, agentId };
}

it('defers a change a live turn cannot take and carries it in a new turn once that turn ends', async () => {
  const { runner, store, agentId } = await claudeFixture('ask');
  const first = await runner.startTask(agentId, input);
  // A Claude turn cannot be steered: the change waits for the live turn instead of failing the task.
  expect(await runner.deliver(agentId, 'task', update)).toMatchObject({ via: 'next_turn', sent: false });
  await runner.flush();
  expect((await store.read()).filter(event => ['update_rejected', 'task_blocked', 'update_sent'].includes(event.type))).toEqual([]);
  // Both turns end (their processes exit) and the second one submits the result.
  await vi.waitFor(async () => { await runner.flush(); expect((await store.read()).filter(event => event.type === 'turn_observed' && (event.payload as { status: string }).status === 'completed')).toHaveLength(2); }, { timeout: 20_000, interval: 100 });
  const events = await store.read();
  expect(events.filter(event => event.type === 'task_started').map(event => (event.payload as { turnId: string }).turnId)).toEqual([first, expect.not.stringMatching(first)]);
  expect(events.filter(event => event.type === 'update_sent')).toHaveLength(1);
  expect(events.find(event => event.type === 'update_acknowledged')?.payload).toMatchObject({ updateId: 'u1', planVersion: 2 });
  expect(events.find(event => event.type === 'result_submitted')?.payload).toMatchObject({ taskId: 'task', planVersion: 2 });
  expect(events.some(event => event.type === 'update_rejected' || event.type === 'task_blocked')).toBe(false);
}, 30_000);

it('keeps the live turn and its time limit when a change has to wait', async () => {
  const onBlocked = vi.fn();
  const { runner, store, agentId } = await claudeFixture('hang', { turnTimeoutMs: 1000, onBlocked });
  const turnId = await runner.startTask(agentId, input);
  expect(await runner.deliver(agentId, 'task', update)).toMatchObject({ sent: false });
  await vi.waitFor(async () => { await runner.flush(); expect((await store.read()).some(event => event.type === 'turn_observed' && (event.payload as { status: string }).status === 'interrupted')).toBe(true); }, { timeout: 20_000, interval: 100 });
  expect(onBlocked).toHaveBeenCalledTimes(1);
  expect(onBlocked).toHaveBeenCalledWith(expect.objectContaining({ turnId, reason: expect.stringContaining('제한 시간(1초)') }));
  const events = await store.read();
  expect(events.filter(event => event.type === 'task_started')).toHaveLength(1);
  expect(events.some(event => event.type === 'update_rejected' || event.type === 'update_sent')).toBe(false);
}, 30_000);
