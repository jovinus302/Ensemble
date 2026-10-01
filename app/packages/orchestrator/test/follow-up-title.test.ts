import { expect, it } from 'vitest';
import { followUpTitle } from '../src/index.ts';

it('numbers follow-ups of follow-ups instead of repeating the 보완 suffix', () => {
  expect(followUpTitle('예약 프로토타입')).toBe('예약 프로토타입 보완');
  expect(followUpTitle('예약 프로토타입 보완')).toBe('예약 프로토타입 보완 2');
  expect(followUpTitle('예약 프로토타입 보완 2')).toBe('예약 프로토타입 보완 3');
  // A second follow-up on the original takes the next free number, so titles (and file names) stay distinct.
  expect(followUpTitle('예약 프로토타입', ['예약 프로토타입', '예약 프로토타입 보완', '예약 프로토타입 보완 2'])).toBe('예약 프로토타입 보완 3');
  // Other work items that merely share a prefix do not count.
  expect(followUpTitle('흐름', ['흐름 설계 보완'])).toBe('흐름 보완');
  let title = '예약 프로토타입';
  for (let i = 0; i < 4; i++) title = followUpTitle(title);
  expect(title).toBe('예약 프로토타입 보완 4');
  expect(title).not.toMatch(/보완 보완/);
});
