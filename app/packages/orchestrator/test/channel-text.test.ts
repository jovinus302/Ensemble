import { expect, it } from 'vitest';
import { project } from '@ensemble/core';
import { channelText, particle, hasGroundedNumbers, numericFacts } from '../src/channel-text.ts';

it('uses Korean names and particles, hides references, and preserves decimals within two sentences', () => {
  const state = project([]);
  state.plan = { version: 1, reason: '', approvedBy: 'owner', tasks: [{ id: 'interview', title: '고객 인터뷰', assignee: 'owner', dependsOn: [], handoffConditions: [] }] };
  expect(particle('설계')).toBe('를');
  expect(particle('흐름')).toBe('을');
  expect(particle('설계', '이/가')).toBe('가');
  expect(channelText('interview을(를) 확인합니다. 17.5일입니다. 세 번째 문장입니다.', state)).toBe('고객 인터뷰를 확인합니다. 17.5일입니다.');
  expect(channelText('exclude_scope 결과 result:abc와 msg:def 참고', state)).not.toMatch(/exclude_scope|result:|msg:/);
});
it('rejects numbers not in supplied facts while allowing code-rounded values', () => {
  const allowed = numericFacts({ days: 17.543, date: new Date('2026-10-18T00:00:00Z'), weekly: 8 });
  expect(hasGroundedNumbers('주 8시간, 최대 17.5일, 10/18입니다.', allowed)).toBe(true);
  expect(hasGroundedNumbers('주 999시간입니다.', allowed)).toBe(false);
});
