import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { CodexSessionConnector, type TaskInstructionsInput, type UpdateInstructionsInput } from '@ensemble/agents';
import { project } from '@ensemble/core';
import { MemoryLedgerStore } from '@ensemble/store';
import { SessionRunner } from '../src/session-runner.ts';

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
  await Promise.all(runners.splice(0).map(runner => runner.stop()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

it('records the complete flow once despite duplicate notifications and acknowledgements preceding steer response', async () => {
  const { runner, store, agentId } = await fixture();
  const turnId = await runner.startTask(agentId, input);
  expect(project(await store.read()).activeTurn.get(agentId)).toBe('task');
  await expect(runner.startTask(agentId, input)).rejects.toThrow('cannot start');
  expect(await runner.sendUpdate(agentId, update)).toEqual({ sent: true });
  await runner.flush();
  await runner.sendUpdate(agentId, update); await runner.flush();
  const events = await store.read();
  for (const type of ['session_linked', 'task_started', 'update_sent', 'update_acknowledged', 'result_submitted']) {
    expect(events.filter(event => event.type === type), type).toHaveLength(1);
  }
  expect(events.filter(event => event.type === 'turn_observed')).toHaveLength(2);
  expect(events.findIndex(event => event.type === 'update_sent')).toBeLessThan(events.findIndex(event => event.type === 'update_acknowledged'));
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
    expect(events).toContainEqual(expect.objectContaining({ type: 'reply_recorded', payload: expect.objectContaining({ text: expect.stringContaining('Rejected result') }) }));
  }
  if (mode === 'errors') {
    const replies = events.filter(event => event.type === 'reply_recorded');
    expect(replies).toContainEqual(expect.objectContaining({ payload: expect.objectContaining({ text: expect.stringContaining('Agent question') }) }));
    expect(replies).toContainEqual(expect.objectContaining({ payload: expect.objectContaining({ text: expect.stringContaining('Invalid agent report') }) }));
  }
});
