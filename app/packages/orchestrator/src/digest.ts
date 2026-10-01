// Daily digest (B9): once a day at the digest hour (Q4: 09:00 Asia/Seoul, on by default) the channel gets one
// code-written summary that mentions only the people something changed for. No change, no post. A timer (the
// web runtime, MD2) calls `ProjectManager.digest(now)`; the day's key makes every later call that day a no-op.
import {
  DEFAULT_DIGEST_SETTINGS, digestDue, digestFacts, digestKey, lastDigestAt, project,
  type AnyEvent, type DigestSettings, type EventContext, type Id, type NewLedgerEvent, type PersonDigest, type ProjectState,
} from '@ensemble/core';
import type { LedgerStore } from '@ensemble/store';
import type { CoordinationResult } from './coordination.ts';

type PmPost = CoordinationResult['posts'][number];
const DAY = 24 * 3_600_000;
const TITLES_SHOWN = 3;

export interface DigestOptions {
  store: LedgerStore;
  context: EventContext;
  /** Q4: hour (Asia/Seoul) and on/off. Default `DEFAULT_DIGEST_SETTINGS` (09:00, on). */
  settings?: DigestSettings;
}

const monthDay = (day: string) => { const [, m, d] = day.split('-'); return `${Number(m)}/${Number(d)}`; };

function titles(state: ProjectState, ids: Id[]): string {
  const names = ids.slice(0, TITLES_SHOWN).map(id => `"${state.tasks.get(id)?.spec.title ?? '작업'}"`);
  return `${names.join(', ')}${ids.length > TITLES_SHOWN ? ` 외 ${ids.length - TITLES_SHOWN}건` : ''}`;
}

/** One line per person, from code only: work titles and counts, never internal ids. */
function personLine(state: ProjectState, person: PersonDigest): string {
  const parts = [
    ...(person.completedTaskIds.length ? [`완료 ${person.completedTaskIds.length}건(${titles(state, person.completedTaskIds)})`] : []),
    ...(person.startedAgentTaskIds.length ? [`Agent가 새로 시작 ${person.startedAgentTaskIds.length}건(${titles(state, person.startedAgentTaskIds)})`] : []),
    ...(person.newDecisionIds.length ? [`새 결정 요청 ${person.newDecisionIds.length}건`] : []),
    ...(person.openDecisions ? [`답을 기다리는 결정 ${person.openDecisions}건`] : []),
    ...(person.forecastChange ? [`예상 완료 ${monthDay(person.forecastChange.from)} → ${monthDay(person.forecastChange.to)}`] : []),
  ];
  return `- @${state.members.get(person.memberId)?.displayName ?? person.memberId} ${parts.join(' · ')}`;
}

/** The digest text for these facts; empty when nobody has anything new. */
export function digestText(state: ProjectState, people: readonly PersonDigest[]): string {
  if (!people.length) return '';
  return ['지난 요약 이후 바뀐 것을 정리했어요.', ...people.map(person => personLine(state, person))].join('\n');
}

/**
 * Posts the day's digest when it is due (`digestDue`: enabled, at or after the hour, not yet recorded today).
 * The window runs from the previous digest (else the last 24 hours) to `now`. When nobody has a change the
 * day is still recorded as handled (a silent consideration under the same key), so nothing posts later that day.
 */
export async function runDigest(options: DigestOptions, now: Date): Promise<PmPost[]> {
  const { store, context } = options;
  const settings = options.settings ?? DEFAULT_DIGEST_SETTINGS;
  const events = await store.read({ projectId: context.projectId }) as AnyEvent[];
  if (!digestDue(events, now, settings)) return [];
  const state = project(events);
  const last = lastDigestAt(events);
  const since = last !== undefined ? new Date(last) : new Date(now.getTime() - DAY);
  const facts = digestFacts(state, events, since, now);
  const text = digestText(state, facts.people);
  const key = digestKey(now);
  const at = now.toISOString();
  const actor = { kind: 'system' as const, id: 'pm' };
  const append: NewLedgerEvent[] = [
    { ...context, actor, type: 'pm_considered', idempotencyKey: key, at, payload: { considerationId: key, triggerId: key,
      whoseAction: facts.people.map(person => person.memberId).join(', ') || null, alreadyKnows: text ? 'no' : 'yes',
      evidence: facts.people.flatMap(person => [...person.completedTaskIds, ...person.startedAgentTaskIds, ...person.newDecisionIds]).concat(key),
      decision: text ? 'speak' : 'silent', reason: text ? '하루 요약: 바뀐 것이 있는 사람에게만 알린다' : '하루 요약: 지난 요약 이후 바뀐 것이 없어 게시하지 않는다', openTopics: state.openTopics } },
    ...(text ? [{ ...context, actor: { kind: 'pm' as const, id: 'pm' }, type: 'pm_spoke' as const, idempotencyKey: `${key}:0`, at,
      payload: { considerationId: key, messageId: `${key}:0`, text, kind: 'summary' as const } }] : []),
  ];
  const tx = await store.transaction(context.projectId, current => current.some(e => e.idempotencyKey === key) ? { append: [], result: false } : { append, result: true });
  return tx.result && text ? [{ text, kind: 'summary' }] : [];
}
