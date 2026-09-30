import { expect, it } from 'vitest';
import { formatKstDate } from '../src/index.ts';

it('uses the Seoul calendar day for both Date and ISO input across UTC midnight and year-end', () => {
  expect(formatKstDate(new Date('2026-10-11T19:58:00Z'))).toBe('10/12');
  expect(formatKstDate('2026-10-11T19:58:00Z')).toBe('10/12');
  expect(formatKstDate('2026-12-31T15:00:00Z')).toBe('1/1');
  expect(formatKstDate('2026-10-11T14:59:59Z')).toBe('10/11');
});
