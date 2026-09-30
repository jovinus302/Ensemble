import { expect, it } from 'vitest';
import { applyOps, opAuthority, project, type PlanOp, type TaskSpec } from '../src/index.ts';
const tasks: TaskSpec[] = [{ id: 'T4', title: '프로토타입', assignee: 'agent', dependsOn: ['T3'], handoffConditions: ['가입', '결제'] }];
const exclude = (item: string): PlanOp => ({ type: 'exclude_scope', taskId: 'T4', item, sourceMessageIds: ['m'] });
const limit = (...items: string[]): PlanOp => ({ type: 'limit_scope', taskId: 'T4', items, sourceMessageIds: ['m'] });

// M11 replaces the lossy condition rewriting contract; every original condition is retained.
it.each(['결제', '결제 모형(모의 결제) 화면 및 상호작용', '결제 화면과 모의 결제 버튼', '결제 관련 반응 정리', '모의 결제 버튼 동작 구현'])('preserves QA C1/N6 requirements and prohibitions when excluding %s', item => {
  const conditions = [
    '설계된 흐름(가입→수업시간선택→예약확인→모의결제)을 그대로 반영한 클릭 가능한 단일 HTML 파일로 구현(로컬에서 바로 열림)',
    '설계된 화면 목록과 상호작용을 반영한 클릭 가능 HTML 파일을 외부 연결·배포 없이 로컬에서 열리는 형태로 제출',
    '가입 오류·재입력, 시간 선택·예약 확인, 모의 결제 버튼 동작을 실제 개인정보 수집·결제 없이 시연 가능하도록 구현',
    '실제 결제·개인정보 저장·외부 네트워크 호출 없이 로컬 브라우저에서 동작한다',
  ];
  const original = [{ ...tasks[0]!, handoffConditions: conditions }];
  const next = applyOps(original, [exclude(item), limit('가입', '수업 시간 선택', '예약 확인')]);
  expect(next[0]!.handoffConditions).toEqual(conditions);
  expect(next[0]).toMatchObject({ id: 'T4', assignee: 'agent', dependsOn: ['T3'], baseTitle: '프로토타입', exclusions: [item], limits: ['가입', '수업 시간 선택', '예약 확인'] });
  expect(original[0]).not.toHaveProperty('exclusions');
  expect(applyOps(next, [exclude(item), limit('가입', '수업 시간 선택', '예약 확인')])).toEqual(next);
});
it('appends unique metadata and recomputes one title annotation from baseTitle', () => {
  const once = applyOps(tasks, [exclude('결제'), limit('요금제 비교', '가입까지만')]);
  expect(once[0]!.title).toBe('프로토타입 (결제 제외, 요금제 비교·가입까지)');
  const again = applyOps(once, [exclude('결제 화면과 모의 결제 버튼'), limit('가입'), exclude('예약 알림')]);
  expect(again[0]).toMatchObject({ title: '프로토타입 (결제 제외, 예약 알림 제외, 요금제 비교·가입까지)', exclusions: ['결제', '예약 알림'], limits: ['요금제 비교', '가입'] });
  expect(again[0]!.handoffConditions).toEqual(tasks[0]!.handoffConditions);
  expect(applyOps([{ ...again[0]!, title: '잘못 누적된 제목' }], [exclude('결제')])[0]!.title).toBe(again[0]!.title);
});
it('does not merge scopes merely because one name is a substring', () => {
  expect(applyOps(tasks, [exclude('예약'), exclude('예약 알림')])[0]!.exclusions).toEqual(['예약', '예약 알림']);
});
it.each([
  ['프로토타입 (결제 제외) (결제 제외)', '프로토타입 (결제 제외)', []],
  ['프로토타입 (결제 제외) (범위: 가입 · 수업 시간 선택 · 예약 확인만)', '프로토타입 (결제 제외, 가입·수업 시간 선택·예약 확인까지)', ['가입', '수업 시간 선택', '예약 확인']],
  ['프로토타입(HTML)', '프로토타입(HTML) (결제 제외)', []],
] as const)('recovers legacy title %s without touching old conditions', (title, expected, limits) => {
  const next = applyOps([{ ...tasks[0]!, title }], [exclude('결제')])[0]!;
  expect(next.title).toBe(expected);
  expect(next.limits).toEqual(limits);
  expect(next.handoffConditions).toEqual(tasks[0]!.handoffConditions);
  expect(applyOps([next], [exclude('결제')])).toEqual([next]);
});
it('retains the sole condition when all requested scope was excluded', () => {
  const next = applyOps([{ ...tasks[0]!, handoffConditions: ['결제 화면이 표시됨'] }], [exclude('결제 화면')])[0]!;
  expect(next.handoffConditions).toEqual(['결제 화면이 표시됨']);
  expect(next.exclusions).toEqual(['결제 화면']);
});
it('preserves early-handoff and reassignment semantics', () => {
  const op: PlanOp = { type: 'handoff_early', taskId: 'T4', sourceMessageIds: ['m'] };
  const next = applyOps(tasks, [op, op, { type: 'reassign', taskId: 'T4', assignee: 'other', sourceMessageIds: ['m'] }])[0]!;
  expect(next.handoffConditions).toEqual(['가입', '결제', '초안 단계에서 인계 가능']);
  expect(next.assignee).toBe('other');
  expect(next.title).toBe(tasks[0]!.title);
});
it('availability, deadline and goal operations do not create plan task changes', () => {
  expect(applyOps(tasks, [
    { type: 'set_availability', memberId: 'designer', weeklyHours: 5, sourceMessageIds: ['m'] },
    { type: 'set_deadline', date: '2026-10-12', sourceMessageIds: ['m'] },
    { type: 'change_goal', text: '목표', sourceMessageIds: ['m'] },
  ])).toEqual(tasks);
});
it.each(['exclude_scope', 'set_deadline', 'change_goal'] as const)('requires the decider source for %s even within delegation', type => {
  const state = project([]);
  state.goal = { text: '목표', decider: 'owner', delegation: { pmMayApply: ['scope_reduce', 'deadline_change', 'goal_change'] } };
  state.messages = [{ messageId: 'designer-message', authorId: 'designer', text: '제안', seq: 1 }, { messageId: 'owner-message', authorId: 'owner', text: '동의', seq: 2 }];
  const details = type === 'exclude_scope' ? { type, taskId: 'T4', item: '결제' } : type === 'set_deadline' ? { type, date: '2026-10-12' } : { type, text: '새 목표' };
  expect(opAuthority(state, { ...details, sourceMessageIds: ['designer-message'] }).allowed).toBe(false);
  expect(opAuthority(state, { ...details, sourceMessageIds: ['owner-message'] }).allowed).toBe(true);
});
