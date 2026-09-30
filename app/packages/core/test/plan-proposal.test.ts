import { expect, it } from 'vitest';
import { project, type LedgerEvent, type EventPayloads } from '../src/index.ts';

it('proposals replay as pending cards without executable tasks; decisions close them', () => {
  const payload: EventPayloads['plan_proposed'] = { proposalId: 'proposal', version: 1, forMemberId: 'owner', reason: 'Draft', tasks: [{ id: 't', title: 'Task', assignee: 'agent', dependsOn: [], handoffConditions: ['Result'] }], estimates: [{ taskId: 't', hours: { min: 1, max: 2 } }] };
  const base = { projectId: 'p', targetProductId: 'p', actor: { kind: 'system' as const, id: 'pm' }, at: 'now' };
  const proposed: LedgerEvent = { ...base, id: '1', seq: 1, type: 'plan_proposed', payload };
  const state = project([proposed]);
  expect(state.pendingPlans.get('proposal')).toEqual(payload);
  expect(state.tasks.size).toBe(0);
  expect(state.plan).toBeUndefined();
  state.pendingPlans.get('proposal')!.tasks[0]!.title = 'Mutated';
  expect(project([proposed]).pendingPlans.get('proposal')!.tasks[0]!.title).toBe('Task');
  for (const approved of [true, false]) {
    const decided: LedgerEvent = { ...base, id: '2', seq: 2, type: 'plan_decided', payload: { proposalId: 'proposal', memberId: 'owner', approved } };
    expect(project([proposed, decided]).pendingPlans.size).toBe(0);
  }
});
