import { expect, it } from 'vitest';
import { applyOps, opAuthority, project, type PlanOp, type TaskSpec } from '../src/index.ts';

const tasks: TaskSpec[] = [{ id: 'T4', title: '프로토타입', assignee: 'agent', dependsOn: ['T3'], handoffConditions: ['가입', '결제'] }];
it('removes excluded acceptance requirements while preserving identity and independent conditions', () => {
  const op: PlanOp = { type: 'exclude_scope', taskId: 'T4', item: '결제', sourceMessageIds: ['owner-message'] };
  const next = applyOps(tasks, [op, op]);
  expect(next).toEqual([{ ...tasks[0], title: '프로토타입 (결제 제외)', handoffConditions: ['가입', '제외: 결제'] }]);
  expect(tasks[0]?.handoffConditions).toEqual(['가입', '결제']);
  expect(applyOps(next, [op])).toEqual(next);
});

it('removes sentences requiring excluded scope and replaces previous scope limits idempotently', () => {
  const plan = [{ ...tasks[0]!, handoffConditions: ['가입 오류 표시', '결제 승인과 취소 흐름 포함', '범위: 결제, 가입만'] }];
  const ops: PlanOp[] = [
    { type: 'exclude_scope', taskId: 'T4', item: '결제', sourceMessageIds: ['m'] },
    { type: 'limit_scope', taskId: 'T4', items: ['가입까지만'], sourceMessageIds: ['m'] },
  ];
  const next = applyOps(plan, ops);
  expect(next[0]?.handoffConditions).toEqual(['가입 오류 표시', '제외: 결제', '범위: 가입만']);
  expect(next[0]?.title).toBe('가입 — 범위 한정');
  expect(applyOps(next, ops)).toEqual(next);
  expect(plan[0]?.handoffConditions).toContain('결제 승인과 취소 흐름 포함');
});

it.each(['결제 화면과 모의 결제 버튼', '결제 화면(모의 결제 버튼 포함)', '결제'])('removes actual recovery requirements for %s while preserving other flows and prohibitions', item => {
  const plan: TaskSpec[] = [{ ...tasks[0]!, handoffConditions: [
    '설계된 화면 목록과 상호작용을 반영한 클릭 가능한 단일/연결 HTML 파일을 로컬에서 실행 가능하도록 제작',
    '외부 서비스 연결, 실제 결제, 실제 개인정보 수집 없이 모의 결제 버튼과 더미 데이터만 사용',
    '가입 정상/오류 흐름, 시간 선택·예약 확인, 결제 화면이 모두 클릭으로 이동 가능함을 확인',
  ] }];
  const op: PlanOp = { type: 'exclude_scope', taskId: 'T4', item, sourceMessageIds: ['owner'] };
  const next = applyOps(plan, [op]);
  const positive = next[0]!.handoffConditions.filter(c => !c.startsWith('제외:'));
  expect(positive).toEqual([
    plan[0]!.handoffConditions[0],
    '외부 서비스 연결, 실제 개인정보 수집 없이 더미 데이터만 사용',
    '가입 정상/오류 흐름, 시간 선택·예약 확인 항목이 모두 클릭으로 이동 가능함을 확인',
  ]);
  expect(positive.join(' ')).not.toContain('결제');
  expect(applyOps(next, [op])).toEqual(next);
});

it('keeps one title-based delivery requirement if exclusions remove every positive condition', () => {
  const op: PlanOp = { type: 'exclude_scope', taskId: 'T4', item: '결제 화면', sourceMessageIds: ['owner'] };
  const next = applyOps([{ ...tasks[0]!, handoffConditions: ['결제 화면이 표시됨'] }], [op]);
  expect(next[0]?.handoffConditions).toEqual(['프로토타입의 제외 범위를 뺀 결과물을 제출', '제외: 결제 화면']);
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

it('adds a scope exclusion mark to the title only once, even when the same scope is worded differently', () => {
  const base: TaskSpec = { id: 'prototype', title: '프로토타입', assignee: 'agent', dependsOn: [], handoffConditions: ['가입과 결제 화면이 동작'] };
  const exclude = (item: string): PlanOp => ({ type: 'exclude_scope', taskId: 'prototype', item, sourceMessageIds: ['m1'] });
  const once = applyOps([base], [exclude('결제')]);
  expect(once[0]!.title).toBe('프로토타입 (결제 제외)');
  // The same scope named again, alone or with UI words around it, adds no second mark.
  expect(applyOps(once, [exclude('결제 화면(모의 결제 버튼 포함)')])[0]!.title).toBe('프로토타입 (결제 제외)');
  expect(applyOps([{ ...base, title: '프로토타입 (결제 화면 제외)' }], [exclude('결제')])[0]!.title).toBe('프로토타입 (결제 화면 제외)');
  // Real PM wording of one payment cut, routed from a checked flow and named again for the prototype.
  const real = applyOps([base], [exclude('결제 모형(모의) 화면 및 상호작용 설계'), exclude('결제 화면 및 모의 결제 버튼')])[0]!;
  expect(real.title).toBe('프로토타입 (결제 모형(모의) 화면 및 상호작용 설계 제외)');
  expect(real.handoffConditions).toEqual(expect.arrayContaining(['제외: 결제 모형(모의) 화면 및 상호작용 설계', '제외: 결제 화면 및 모의 결제 버튼']));
  // A different scope still gets its own mark.
  expect(applyOps(once, [exclude('예약 알림')])[0]!.title).toBe('프로토타입 (결제 제외) (예약 알림 제외)');
});
