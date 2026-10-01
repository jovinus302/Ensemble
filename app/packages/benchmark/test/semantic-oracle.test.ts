import { expect, it } from 'vitest';
// @ts-expect-error Browser module is native JavaScript, shared with the offline runner.
import { confirmationMatches } from '../browser/acceptance.mjs';
const expected = { date: '2030-06-17', time: '19:00', guests: 6 };
it.each(['2030-06-17', 'Monday, June 17, 2030', '17 June 2030', 'Jun. 17, 2030'])('accepts supported equivalent date %s', date => {
  expect(confirmationMatches(`${date}\n19:00\n6 guests`, expected)).toBe(true);
});
it('normalizes labeled party and 12-hour time without confusing the date digit for guests', () => {
  expect(confirmationMatches('June 17, 2030\n2030-06-17\nTime\n19:00\nGuests\n6 guests', expected)).toBe(true);
  expect(confirmationMatches('June 17, 2030\n7:00 PM\nParty size: 6', expected)).toBe(true);
  expect(confirmationMatches('June 17, 2030\n19:00\n16 guests', expected)).toBe(false);
});
it.each(['June 18, 2030\n19:00\n6 guests', 'June 17, 2030\n18:00\n6 guests', 'June 17, 2030\n19:00\n5 guests',
  '2030-06-17\nJune 18, 2030\n19:00\n6 guests', '06/17/2030\n19:00\n6 guests',
  'Reservation saved\n19:00\n6 guests', '2030-06-17\n19:00\nreference 6'])('rejects wrong, conflicting or unsupported semantics: %s', text => {
  expect(confirmationMatches(text, expected)).toBe(false);
});
