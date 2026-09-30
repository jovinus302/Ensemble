import { expect, it } from 'vitest';
import { project, type AnyEvent, type PlanOp } from '@ensemble/core';
import { MemoryLedgerStore } from '@ensemble/store';
import type { SessionConnector, UpdateInstructionsInput } from '@ensemble/agents';
import { ProjectManager } from '../src/pm.ts';
import { buildTaskContext } from '../src/context.ts';

const context = { projectId: 'authority', targetProductId: 'product' };
async function setup(op: PlanOp = { type: 'exclude_scope', taskId: 'build', item: 'Payments', sourceMessageIds: [] }) {
  const store = new MemoryLedgerStore();
  const base = { ...context, actor: { kind: 'system' as const, id: 'seed' } };
  await store.append([
    ...['owner', 'other', 'agent'].map(id => ({ ...base, type: 'member_joined', payload: { memberId: id, displayName: id, kind: id === 'agent' ? 'agent' : 'human', role: 'build' } })),
    { ...base, type: 'goal_set', payload: { text: 'Ship', decider: 'owner', delegation: { pmMayApply: [] } } },
    { ...base, type: 'plan_committed', payload: { version: 1, basedOn: null, approvedBy: 'owner', sourceMessageIds: [], reason: 'Initial', tasks: [{ id: 'build', title: 'Build', assignee: 'agent', dependsOn: [], handoffConditions: ['Payments', 'Signup'] }] } },
    { ...base, type: 'authority_requested', payload: { requestId: 'request', personId: op.type === 'set_availability' ? op.memberId : 'owner', changeKinds: ['scope_reduce'], text: 'Approve this change?', operationKey: JSON.stringify(Object.entries(op).filter(([k]) => k !== 'sourceMessageIds').sort(([a], [b]) => a.localeCompare(b))) } },
  ]);
  const updates: UpdateInstructionsInput[] = [];
  const connector: SessionConnector = {
    async startSession(id) { return { threadId: id, workspace: '/fake' }; }, async startTask() { return 'turn'; },
    async sendUpdate(_id, input) { updates.push(input); return { sent: true }; }, onEvent() { return () => {}; }, async stop() {},
  };
  const pm = new ProjectManager({ ...context, store, connector, model: 'fake', llm: { async complete() { throw new Error('Card decisions must not call a model'); } } });
  await pm.sessions.startTask('agent', buildTaskContext(project(await store.read()), 'build', await store.read()));
  return { pm, store, updates };
}

it('authorized card answer uses the coordination path: v2, notification, steer, one decision', async () => {
  const f = await setup();
  await expect(f.pm.decideAuthority('request', 'other', true)).rejects.toThrow('요청받은 사람');
  await Promise.all([f.pm.decideCard('request', 'owner', true), f.pm.decideCard('request', 'owner', true)]);
  const events = await f.store.read() as AnyEvent[], state = project(events);
  expect(state.plan?.version).toBe(2);
  expect(state.plan?.tasks[0]!.handoffConditions).toEqual(['Payments', 'Signup']);
  expect(state.plan?.tasks[0]!.exclusions).toEqual(['Payments']);
  expect(state.pendingAuthority.size).toBe(0);
  expect(events.filter(e => e.type === 'authority_granted')).toHaveLength(1);
  expect(events.filter(e => e.type === 'decision_recorded')).toHaveLength(1);
  expect(events.filter(e => e.type === 'change_notified')).toHaveLength(1);
  expect(f.updates).toHaveLength(1);
  expect(f.updates[0]).toMatchObject({ fromVersion: 1, toVersion: 2, drop: ['Payments'] });
  await f.pm.stop();
});

it('rejection preserves the plan, reopens discussion, posts once and ignores a later approval', async () => {
  const f = await setup();
  const before = project(await f.store.read()).plan;
  expect(await f.pm.decideCard('request', 'owner', false)).toHaveLength(1);
  expect(await f.pm.decideCard('request', 'owner', true)).toEqual([]);
  const events = await f.store.read() as AnyEvent[], state = project(events);
  expect(state.plan).toEqual(before);
  expect(state.openTopics).toContain('Approve this change?');
  expect(state.pendingAuthority.size).toBe(0);
  expect(events.filter(e => e.type === 'pm_spoke')).toHaveLength(1);
  expect(f.updates).toHaveLength(0);
  await f.pm.stop();
});

it('availability authority updates only the requested human and does not rewrite the plan', async () => {
  const f = await setup({ type: 'set_availability', memberId: 'other', weeklyHours: 3, sourceMessageIds: [] });
  await expect(f.pm.decideAuthority('request', 'owner', true)).rejects.toThrow();
  await f.pm.decideAuthority('request', 'other', true);
  const state = project(await f.store.read());
  expect(state.availability.get('other')).toBe(3);
  expect(state.plan?.version).toBe(1);
  expect(state.pendingAuthority.size).toBe(0);
  await f.pm.stop();
});

it('a no-op approval still resolves the pending request once', async () => {
  const f = await setup({ type: 'change_goal', text: 'Ship', sourceMessageIds: [] });
  await f.pm.decideAuthority('request', 'owner', true);
  expect(project(await f.store.read()).pendingAuthority.size).toBe(0);
  expect(project(await f.store.read()).plan?.version).toBe(1);
  expect(await f.pm.decideAuthority('request', 'owner', true)).toEqual([]);
  await f.pm.stop();
});

it('invalid recorded operations stay pending and cannot mutate state', async () => {
  const f = await setup({ type: 'exclude_scope', taskId: 'missing', item: 'Payments', sourceMessageIds: [] });
  await expect(f.pm.decideAuthority('request', 'owner', true)).rejects.toThrow('유효하지 않거나');
  expect(project(await f.store.read()).pendingAuthority.has('request')).toBe(true);
  expect(f.updates).toHaveLength(0);
  await f.pm.stop();
});
