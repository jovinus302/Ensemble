import { expect, it } from 'vitest';
import { applyOps, opAuthority, project, type PlanOp, type TaskSpec } from '../src/index.ts';

const tasks: TaskSpec[] = [{ id: 'T4', title: '프로토타입', assignee: 'agent', dependsOn: ['T3'], handoffConditions: ['가입', '결제'] }];
it('excludes scope by adding an explicit condition without rewriting task identity or other fields', () => {
  const op: PlanOp = { type: 'exclude_scope', taskId: 'T4', item: '결제', sourceMessageIds: ['owner-message'] };
  const next = applyOps(tasks, [op, op]);
  expect(next).toEqual([{ ...tasks[0], title: '프로토타입 (결제 제외)', handoffConditions: ['가입', '결제', '제외: 결제'] }]);
  expect(tasks[0]?.handoffConditions).toEqual(['가입', '결제']);
  expect(applyOps(next, [op])).toEqual(next);
});

it('availability, deadline and goal operations do not create plan task changes', () => {
  expect(applyOps(tasks, [
    { type: 'set_availability', memberId: 'designer', weeklyHours: 5, sourceMessageIds: ['m'] },
    { type: 'set_deadline', date: '2026-10-12', sourceMessageIds: ['m'] },
    { type: 'change_goal', text: '목표', sourceMessageIds: ['m'] },
  ])).toEqual(tasks);
});

it.each(['exclude_scope', 'set_deadline', 'change_goal'] as const)('requires the decider’s own source for %s even within delegation', type => {
  const state = project([]);
  state.goal = { text: '목표', decider: 'owner', delegation: { pmMayApply: ['scope_reduce', 'deadline_change', 'goal_change'] } };
  state.messages = [{ messageId: 'designer-message', authorId: 'designer', text: '제안', seq: 1 }, { messageId: 'owner-message', authorId: 'owner', text: '동의', seq: 2 }];
  const details = type === 'exclude_scope' ? { type, taskId: 'T4', item: '결제' } : type === 'set_deadline' ? { type, date: '2026-10-12' } : { type, text: '새 목표' };
  expect(opAuthority(state, { ...details, sourceMessageIds: ['designer-message'] }).allowed).toBe(false);
  expect(opAuthority(state, { ...details, sourceMessageIds: ['owner-message'] }).allowed).toBe(true);
});
