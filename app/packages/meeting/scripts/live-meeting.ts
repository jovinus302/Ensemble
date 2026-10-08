// Live round trip for #80 against real Google Meet REST + Calendar. Step by step, one subcommand per run:
//   check                       token exchange + harmless reads; prints result classes and granted scopes only
//   create --key K [--attendee E ...] [--confirm-send]
//                               flow B: spaces.create + events.insert. Without --confirm-send nobody is emailed:
//                               the attendee list is left empty and sendUpdates=none.
//   observe --key K             reads attendee replies and Meet participants into the ledger
// Credentials come from `.env.local` at the worktree root (never printed). The ledger lives in a git-ignored
// SQLite file so a rerun in a new process finds what the previous one did.
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { LedgerEvent, NewLedgerEvent } from '@ensemble/core';
import { SqliteLedgerStore } from '@ensemble/store';
import {
  GoogleMeetCalendarAdapter, MeetingCoordinator, MeetingRequestError, OAuthTokenError, RefreshTokenProvider, meetingEvents, meetingIdFor, meetingView,
  type MeetingRequestedPayload, type MeetingView,
} from '../src/index.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REQUIRED = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN'] as const;
const OPERATOR = 'operator';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    key: { type: 'string' },
    attendee: { type: 'string', multiple: true },
    'confirm-send': { type: 'boolean', default: false },
    purpose: { type: 'string' },
    start: { type: 'string' },
    minutes: { type: 'string' },
    'time-zone': { type: 'string' },
    space: { type: 'string' },
    state: { type: 'string' },
    env: { type: 'string' },
    calendar: { type: 'string' },
  },
});
const command = positionals[0];
if (!command || !['check', 'create', 'observe'].includes(command)) {
  console.error('usage: npm run live:meeting -- <check|create|observe> [--key K] [--attendee EMAIL ...] [--confirm-send] [--start ISO] [--minutes N] [--purpose TEXT] [--space ID] [--state FILE] [--env FILE] [--calendar ID]');
  process.exit(2);
}

// ---- credentials (names only are ever printed) ----
const envFile = values.env ?? process.env.ENSEMBLE_MEETING_ENV_FILE ?? join(ROOT, '.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const missing = REQUIRED.filter(name => !process.env[name]);
if (missing.length) {
  console.error(`credentials missing: ${missing.join(', ')} (looked in ${existsSync(envFile) ? envFile : `${envFile} — file not found`})`);
  process.exit(2);
}

// Logs each Google call as method + host/path + status. URLs carry no secrets; headers and bodies are not logged.
const apiCalls: string[] = [];
const loggedFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  try {
    const response = await fetch(input, init);
    apiCalls.push(`${init?.method ?? 'GET'} ${url.host}${url.pathname} → ${response.status}`);
    return response;
  } catch (error) {
    apiCalls.push(`${init?.method ?? 'GET'} ${url.host}${url.pathname} → network error`);
    throw error;
  }
};
const tokens = new RefreshTokenProvider({
  clientId: process.env.GOOGLE_OAUTH_CLIENT_ID!, clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!, refreshToken: process.env.GOOGLE_OAUTH_REFRESH_TOKEN!, fetch: loggedFetch,
});
const adapter = new GoogleMeetCalendarAdapter({ accessToken: tokens.accessToken, fetch: loggedFetch, ...(values.calendar ? { calendarId: values.calendar } : {}) });
const printCalls = () => { console.log(`api calls (${apiCalls.length}):`); for (const call of apiCalls) console.log(`  ${call}`); };

if (command === 'check') {
  try {
    await tokens.accessToken();
    console.log(`token: OK (expires in ${Math.round((tokens.expiresInMs ?? 0) / 1000)}s)`);
    console.log(`granted scopes: ${(tokens.scopes ?? []).join(' ') || '(none reported)'}`);
  } catch (error) {
    console.log(`token: ERROR ${error instanceof OAuthTokenError ? error.code : 'unexpected'}`);
    printCalls();
    process.exit(1);
  }
  const probe = await adapter.probe();
  const line = (name: string, outcome: typeof probe.calendar) => console.log(`${name}: ${outcome.status === 'ok' ? 'OK' : outcome.status === 'failed' ? `ERROR ${outcome.code}` : `UNSUPPORTED ${outcome.capability}`}`);
  line('calendar events.list (read)', probe.calendar);
  line('meet conferenceRecords.list (read)', probe.meet);
  printCalls();
  process.exit(probe.calendar.status === 'ok' ? 0 : 1);
}

// ---- ledger-backed commands ----
const key = values.key?.trim();
if (!key) { console.error('--key is required'); process.exit(2); }
const statePath = resolve(values.state ?? join(ROOT, '.local', 'meeting', 'ledger.db'));
mkdirSync(dirname(statePath), { recursive: true });
const store = new SqliteLedgerStore(statePath);
const context = { projectId: values.space ?? 'live-meeting-80', targetProductId: 'meeting-feasibility' };
const coordinator = new MeetingCoordinator({ store, context, adapter, pmId: 'pm' });
const meetingId = meetingIdFor(context.projectId, key);
const before = (await store.read({ projectId: context.projectId })).at(-1)?.seq ?? 0;
console.log(`space: ${context.projectId} · key: ${key} · meeting: ${meetingId}`);
console.log(`state file: ${statePath}`);

function summary(view: MeetingView | undefined) {
  if (!view) { console.log('meeting: not in this ledger'); return; }
  console.log(`states: ${view.states.join(', ')}`);
  console.log(`meeting uri: ${view.link ?? '-'}`);
  console.log(`space name: ${view.spaceName ?? '-'}${view.spaceMismatch ? ' (the invite carries the link of an earlier attempt; the recorded space is unused)' : ''}`);
  console.log(`calendar event id: ${view.calendarEventId ?? '-'} · sendUpdates: ${view.sendUpdates}`);
  if (view.failure) console.log(`failure: ${view.failure.step} ${view.failure.code}${view.failure.uncertain ? ' (uncertain)' : ''} — ${view.failure.message}`);
  if (view.pollFailure) console.log(`last read-back failure: ${view.pollFailure.step} ${view.pollFailure.code}`);
  for (const a of view.attendees) console.log(`attendee ${a.email}: invite=${a.invite} joined=${a.joined}`);
  for (const p of view.participants) console.log(`participant seen: ${p.name ?? '(no name)'} [${p.evidence}]`);
  console.log(`pm participation: ${view.pm}`);
}
async function printNewRecords() {
  const added = (await store.read({ projectId: context.projectId, afterSeq: before })) as LedgerEvent[];
  console.log(`ledger records written this run: ${added.length}`);
  for (const e of added) {
    const p = e.payload as Record<string, unknown>;
    const brief = e.type === 'meeting_observed'
      ? { kind: p.kind, ...(p.attempt ? { attempt: p.attempt } : {}), ...(p.space ? { space: p.space } : {}), ...(p.event ? { event: p.event } : {}), ...(p.failure ? { failure: p.failure } : {}), ...(p.subjectId ? { subjectId: p.subjectId } : {}), ...(p.subjectName ? { subjectName: p.subjectName } : {}), evidence: p.evidence, source: p.source }
      : e.type === 'pm_spoke' ? { text: p.text } : e.type === 'meeting_requested' ? { purpose: p.purpose, attendees: (p.attendees as { email: string }[]).map(a => a.email), start: p.start, end: p.end, sendUpdates: p.sendUpdates, calendarEventId: p.calendarEventId } : undefined;
    console.log(`  #${e.seq} ${e.type}${e.idempotencyKey ? ` [${e.idempotencyKey}]` : ''}${brief ? ` ${JSON.stringify(brief)}` : ''}`);
  }
}
async function seedMembers(emails: string[]) {
  const actor = { kind: 'human' as const, id: OPERATOR };
  const members = [{ id: OPERATOR, name: 'operator' }, ...emails.map(email => ({ id: `guest:${email}`, name: email }))];
  await store.append(members.map(m => ({ ...context, actor, type: 'member_joined', idempotencyKey: `live-seed:member:${m.id}`, payload: { memberId: m.id, kind: 'human', displayName: m.name } } satisfies NewLedgerEvent)));
}

try {
  if (command === 'create') {
    const confirm = values['confirm-send'];
    const requested = (values.attendee ?? []).map(email => email.trim().toLowerCase()).filter(Boolean);
    if (confirm && !requested.length) { console.error('--confirm-send needs at least one --attendee'); process.exit(2); }
    if (!confirm && requested.length) console.log(`DRY RUN: ${requested.length} attendee(s) NOT added and nobody emailed. Add --confirm-send (with a NEW --key) to send invites.`);
    const attendees = confirm ? requested : [];
    // Reruns reuse the stored schedule so the same key always describes the same request.
    const existing = meetingEvents(await store.read({ projectId: context.projectId })).find(e => e.type === 'meeting_requested' && e.payload.meetingId === meetingId)?.payload as MeetingRequestedPayload | undefined;
    const minutes = Number(values.minutes ?? 30);
    const nextHour = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 3_600_000);
    const start = values.start ?? existing?.start ?? nextHour.toISOString();
    const end = values.start ? new Date(Date.parse(values.start) + minutes * 60_000).toISOString() : existing?.end ?? new Date(Date.parse(start) + minutes * 60_000).toISOString();
    await seedMembers(attendees);
    const view = await coordinator.arrange({
      coordinationKey: key, purpose: values.purpose ?? existing?.purpose ?? 'Ensemble #80 미팅 주선 실연동 테스트', agenda: existing?.agenda ?? ['PM Agent가 만든 방과 초대가 도착했는지 확인'],
      attendees: attendees.map(email => ({ memberId: `guest:${email}`, email })), start, end, timeZone: values['time-zone'] ?? existing?.timeZone ?? 'Asia/Seoul',
      confirmedBy: OPERATOR, notifyAttendees: confirm,
    });
    summary(view);
    const invite = meetingEvents(await store.read({ projectId: context.projectId })).find(e => e.type === 'meeting_observed' && e.payload.meetingId === meetingId && e.payload.kind === 'invite_sent');
    if (invite?.type === 'meeting_observed') console.log(`htmlLink: ${invite.payload.event?.htmlLink ?? '-'} · replayed=${invite.payload.event?.replayed}`);
  } else {
    let view = meetingView(await store.read({ projectId: context.projectId }), meetingId);
    if (!view) { console.error('no meeting for this key in the state file; run create first'); process.exit(2); }
    if (view.calendarEventId) view = await coordinator.refreshResponses(meetingId);
    else console.log('skip replies: no calendar event recorded');
    if (view.spaceName) view = await coordinator.observeParticipants(meetingId);
    else console.log('skip participants: no Meet space recorded');
    summary(view);
  }
  await printNewRecords();
  printCalls();
} catch (error) {
  if (error instanceof MeetingRequestError) console.error(`refused: ${error.code} — ${error.message}`);
  else if (error instanceof OAuthTokenError) console.error(`token: ERROR ${error.code}`);
  else console.error(`unexpected error: ${error instanceof Error ? `${error.name}: ${error.message}`.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 300) : 'unknown'}`);
  printCalls();
  process.exitCode = 1;
} finally {
  store.close();
}
