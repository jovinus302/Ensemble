import { expect, it } from 'vitest';
import { project } from '@ensemble/core';
import { channelText, particle, hasGroundedNumbers, numericFacts } from '../src/channel-text.ts';

it('removes attachment UUIDs from human-facing PM records', () => {
  expect(channelText('첨부 854ad043-a359-49fd-aa16-ee113a5b523c와 result:fake-854ad043-a359-49fd-aa16-ee113a5b523c:1 확인', project([]))).not.toMatch(/result:|854ad043|a359/);
});

it('uses Korean names and particles, hides references, and preserves decimals within two sentences', () => {
  const state = project([]);
  state.plan = { version: 1, reason: '', approvedBy: 'owner', tasks: [{ id: 'interview', title: '고객 인터뷰', assignee: 'owner', dependsOn: [], handoffConditions: [] }] };
  expect(particle('설계')).toBe('를');
  expect(particle('흐름')).toBe('을');
  expect(particle('설계', '이/가')).toBe('가');
  expect(channelText('interview을(를) 확인합니다. 17.5일입니다. 세 번째 문장입니다.', state)).toBe('고객 인터뷰를 확인합니다. 17.5일입니다.');
  expect(channelText('exclude_scope 결과 result:abc와 msg:def 참고', state)).not.toMatch(/exclude_scope|result:|msg:/);
});
it('normalizes directional particles including the rieul exception and malformed condition copy', () => {
  expect(particle('사용자', '으로/로')).toBe('로');
  expect(particle('담당', '으로/로')).toBe('으로');
  expect(particle('서울', '으로/로')).toBe('로');
  expect(channelText('사용자(으)로 바꾸고 조건를 확인합니다. 서울(으)로 갑니다.', project([]))).toBe('사용자로 바꾸고 조건을 확인합니다. 서울로 갑니다.');
  expect(hasGroundedNumbers('최대 10/12입니다.', numericFacts(new Date('2026-10-11T19:58Z')))).toBe(true);
});
it('rejects numbers not in supplied facts while allowing code-rounded values', () => {
  const allowed = numericFacts({ days: 17.543, date: new Date('2026-10-18T00:00:00Z'), weekly: 8 });
  expect(hasGroundedNumbers('주 8시간, 최대 17.5일, 10/18입니다.', allowed)).toBe(true);
  expect(hasGroundedNumbers('주 999시간입니다.', allowed)).toBe(false);
});
