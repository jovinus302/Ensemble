import { expect, it } from 'vitest';
import { MemoryLedgerStore } from '@ensemble/store';
import { project, type AnyEvent } from '@ensemble/core';
import type { LlmProvider, LlmRequest } from '@ensemble/llm';
import type { SessionConnector, TaskInstructionsInput } from '@ensemble/agents';
import { ProjectManager } from '../src/pm.ts';

const context = { projectId: 'planning', targetProductId: 'product' };
const members = [
  { memberId: 'owner', kind: 'human' as const, displayName: 'Owner', weeklyHours: 10 },
  { memberId: 'person', kind: 'human' as const, displayName: 'Person' },
  { memberId: 'agent', kind: 'agent' as const, displayName: 'Builder', role: 'build' },
];
const draft = () => ({ reason: 'Build then review', tasks: [
  { id: 'task-1', title: 'Build', assignee: 'agent', role: 'build', dependsOn: [] as string[], handoffConditions: ['Working prototype'], hours: { min: 2, max: 4 } },
  { id: 'task-2', title: 'Review', assignee: 'owner', role: 'human', dependsOn: ['task-1'], handoffConditions: ['Feedback recorded'], hours: { min: 1, max: 2 } },
] });
function provider(replies: unknown[]) {
  const calls: LlmRequest[] = [];
  const llm: LlmProvider = { async complete(request) {
    calls.push(request);
    const input = request.forceTool === 'outline_plan' ? { tasks: ['Build', 'Review'] } : replies.shift() as Record<string, unknown>;
    return { text: '', model: 'fake', responseId: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [{ name: request.forceTool!, input }] };
  } };
  return { calls, llm };
}
async function setup(replies: unknown[] = [draft()]) {
  const store = new MemoryLedgerStore();
  await store.append([
    ...members.map(payload => ({ ...context, actor: { kind: 'system' as const, id: 'seed' }, type: 'member_joined', payload })),
    { ...context, actor: { kind: 'human', id: 'owner' }, type: 'goal_set', payload: { text: 'Seed', decider: 'owner', delegation: { pmMayApply: [] } } },
  ]);
  const starts: TaskInstructionsInput[] = [];
  const connector: SessionConnector = {
    async startSession(id) { return { threadId: id, workspace: '/fake' }; },
    async startTask(_id, input) { starts.push(input); return 'turn'; },
    async sendUpdate() { return { sent: false, reason: 'No active turn' }; }, onEvent() { return () => {}; }, async stop() {},
  };
  const fake = provider(replies);
  const pm = new ProjectManager({ ...context, store, connector, llm: fake.llm, model: 'fake' });
  return { store, starts, pm, ...fake };
}

it('draft → decider approval commits v1/estimates and starts only ready tasks once', async () => {
  const f = await setup();
  await f.pm.setAvailability('owner', 7);
  const proposal = await f.pm.startFreeProject('Ship a prototype', '2026-10-14');
  expect(project(await f.store.read()).pendingPlans.get(proposal.proposalId)).toEqual(proposal);
  expect(project(await f.store.read()).plan).toBeUndefined();
  expect(f.starts).toHaveLength(0);
  expect(JSON.parse(f.calls[0]!.messages[0]!.content).members.find((m: { memberId: string }) => m.memberId === 'owner').weeklyHours).toBe(7);
  await expect(f.pm.decidePlan(proposal.proposalId, 'person', true)).rejects.toThrow('decider');
  await Promise.all([f.pm.decideCard(proposal.proposalId, 'owner', true), f.pm.decideCard(proposal.proposalId, 'owner', true)]);
  const state = project(await f.store.read());
  expect(state.plan).toMatchObject({ version: 1, approvedBy: 'owner' });
  expect(state.estimates.get('task-1')).toEqual({ min: 2, max: 4, source: 'pm' });
  expect(state.pendingPlans.size).toBe(0);
  expect(state.tasks.get('task-2')?.status).toBe('waiting');
  expect(f.starts).toHaveLength(1);
  expect(f.starts[0]).toMatchObject({ taskId: 'task-1', planVersion: 1 });
  await f.pm.stop();
});

it('retries a cyclic draft once and exposes constrained member and task enums', async () => {
  const invalid = draft(); invalid.tasks[0]!.dependsOn = ['task-2'];
  const f = await setup([invalid, draft()]);
  await f.pm.startFreeProject('Ship');
  expect(f.calls).toHaveLength(4);
  expect(JSON.parse(f.calls[2]!.messages[0]!.content).validationError).toContain('Cyclic');
  const schema = f.calls[1]!.tools![0]!.inputSchema as any;
  expect(schema.properties.tasks.items.properties.assignee.enum).toEqual(['owner', 'person', 'agent']);
  expect(schema.properties.tasks.items.properties.dependsOn.items.enum).toEqual(['task-1', 'task-2']);
  await f.pm.stop();
});

it.each(['cycle', 'unknown dependency', 'missing assignee', 'role', 'conditions', 'estimate', 'duplicate'])('rejects two invalid %s drafts without recording a proposal or starting work', async kind => {
  const bad = draft();
  if (kind === 'cycle') bad.tasks[0]!.dependsOn = ['task-2'];
  if (kind === 'unknown dependency') bad.tasks[0]!.dependsOn = ['task-24'];
  if (kind === 'missing assignee') bad.tasks[0]!.assignee = '';
  if (kind === 'role') bad.tasks[0]!.role = 'research';
  if (kind === 'conditions') bad.tasks[0]!.handoffConditions = [];
  if (kind === 'estimate') bad.tasks[0]!.hours = { min: 5, max: 2 };
  if (kind === 'duplicate') bad.tasks[1]!.id = 'task-1';
  const f = await setup([bad, bad]);
  await expect(f.pm.startFreeProject('Ship')).rejects.toThrow('two attempts');
  expect(f.calls).toHaveLength(4);
  expect((await f.store.read()).some(e => e.type === 'plan_proposed')).toBe(false);
  expect(f.starts).toHaveLength(0);
  await f.pm.stop();
});

it('rejection closes the card, asks once, and allows a new proposal', async () => {
  const f = await setup([draft(), draft()]);
  const p = await f.pm.startFreeProject('Ship');
  expect(await f.pm.decideCard(p.proposalId, 'owner', false)).toHaveLength(1);
  expect(await f.pm.decideCard(p.proposalId, 'owner', false)).toEqual([]);
  expect(project(await f.store.read()).plan).toBeUndefined();
  expect(f.starts).toHaveLength(0);
  expect((await f.store.read() as AnyEvent[]).filter(e => e.type === 'pm_spoke')).toHaveLength(2);
  await f.pm.startFreeProject('Ship smaller');
  await f.pm.stop();
});

it('availability accepts zero, rejects non-human and invalid amounts without authority cards', async () => {
  const f = await setup();
  await f.pm.setAvailability('person', 0);
  for (const n of [-1, NaN, Infinity]) await expect(f.pm.setAvailability('person', n)).rejects.toThrow();
  await expect(f.pm.setAvailability('agent', 4)).rejects.toThrow('human');
  expect(project(await f.store.read()).availability.get('person')).toBe(0);
  expect(project(await f.store.read()).pendingAuthority.size).toBe(0);
  await f.pm.stop();
});
