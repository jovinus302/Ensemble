import { expect, it } from 'vitest';
import { availabilityWeek, forecast, project, forecastFromState, type LedgerEvent } from '../src/index.ts';

const now = new Date('2026-09-28T00:00:00+09:00');
const input = { now, deadline: new Date('2026-10-05T00:00:00+09:00'), tasks: [{ id: 'a', assignee: 'person', assigneeKind: 'human' as const, dependsOn: [], done: false, hours: { min: 14, max: 14 } }], weeklyHours: new Map([['person', 14]]) };
it('uses a reduced week then restores the baseline for remaining work and shortage', () => {
  const weeklyOverrides = new Map([['person', new Map([['2026-09-28', 7]])]]);
  expect(forecast({ ...input, weeklyOverrides })).toMatchObject({ ok: true, days: { min: 10.5, max: 10.5 }, shortages: [{ memberId: 'person', hours: 7 }] });
  expect(forecast({ ...input, now: new Date('2026-10-05T00:00:00+09:00'), weeklyOverrides })).toMatchObject({ ok: true, days: { min: 7, max: 7 } });
});
it('waits through a zero-hour week, without overlapping one person’s tasks', () => {
  const weeklyOverrides = new Map([['person', new Map([['2026-09-28', 0]])]]);
  const result = forecast({ ...input, tasks: [...input.tasks, { ...input.tasks[0]!, id: 'b' }], weeklyOverrides });
  expect(result).toMatchObject({ ok: true, tasks: [{ min: { startDay: 0, endDay: 14 } }, { min: { startDay: 14, endDay: 21 } }], days: { max: 21 } });
});
it('replays baseline and overrides independently and recognizes Seoul Monday', () => {
  const events = [
    { type: 'availability_updated', payload: { memberId: 'person', weeklyHours: 14 } },
    { type: 'availability_updated', payload: { memberId: 'person', weeklyHours: 7, weekStart: '2026-09-28' } },
  ].map((e,i) => ({ ...e, id: String(i), seq: i+1, at: now.toISOString(), projectId: 'p', targetProductId: 'p', actor: { kind: 'human', id: 'person' } })) as LedgerEvent[];
  const state = project(events);
  expect(state.availability.get('person')).toBe(14);
  expect(state.availabilityOverrides.get('person')?.get('2026-09-28')).toBe(7);
  expect(availabilityWeek(new Date('2026-09-27T15:00:00Z'))).toBe('2026-09-28');
  expect(availabilityWeek(new Date('2026-09-27T14:59:59Z'))).toBe('2026-09-21');
  expect(forecastFromState(state, now).ok).toBe(true);
});
