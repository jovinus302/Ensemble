import { expect, it } from 'vitest';
import { applyOps, type PlanOp } from '../src/index.ts';

it.each([
  '결제 빼고 가입, 산책 시간 선택, 예약 확인까지만',
  '결제는 빼자. 단일 HTML, 외부 연결 없음, 실제 개인정보 저장 금지도 그대로',
])('T2 조건 원문을 보존한다: %s', () => {
  const spec = { id: 'prototype', title: '프로토타입', assignee: 'agent', dependsOn: [], handoffConditions: ['가입, 산책 시간 선택, 예약 확인, 모의 결제 화면', '단일 HTML', '외부 연결 없음', '실제 개인정보 저장 금지'] };
  const ops: PlanOp[] = [{ type: 'exclude_scope', taskId: spec.id, item: '결제', sourceMessageIds: ['m'] }, { type: 'limit_scope', taskId: spec.id, items: ['가입', '산책 시간 선택', '예약 확인까지만'], sourceMessageIds: ['m'] }];
  const result = applyOps([spec], ops)[0]!;
  expect(result.handoffConditions).toEqual(spec.handoffConditions);
  expect(result).toMatchObject({ baseTitle: '프로토타입', exclusions: ['결제'], limits: ['가입', '산책 시간 선택', '예약 확인'], title: '프로토타입 (결제 제외, 가입·산책 시간 선택·예약 확인까지)' });
  expect(applyOps([result], ops)).toEqual([result]);
});

it('M11 accept-1: 이미 "…까지"로 기록된 한정 범위는 제목에 "까지까지"로 겹치지 않는다', () => {
  const spec = { id: 'prototype', title: '요가 예약 흐름 프로토타입 (결제 제외, 가입·시간 선택·예약 확인까지)', baseTitle: '요가 예약 흐름 프로토타입', exclusions: ['결제 제외'], limits: ['가입·시간 선택·예약 확인까지'], assignee: 'agent', dependsOn: [], handoffConditions: ['클릭형 흐름'] };
  const result = applyOps([spec], [{ type: 'exclude_scope', taskId: spec.id, item: '결제 화면과 모의 결제 버튼', sourceMessageIds: ['m'] }])[0]!;
  expect(result.title).toBe('요가 예약 흐름 프로토타입 (결제 제외, 가입·시간 선택·예약 확인까지)');
  expect(result.title).not.toContain('까지까지');
  expect(result.limits).toEqual(['가입·시간 선택·예약 확인']);
  expect(result.exclusions).toEqual(['결제']);
});
