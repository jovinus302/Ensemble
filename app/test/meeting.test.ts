import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspect } from 'node:util';
import type { NewLedgerEvent } from '@ensemble/core';
import {
  DEFAULT_MEET_ACCESS_TYPE, FakeMeetingAdapter, GoogleMeetCalendarAdapter, MeetingCoordinator, MeetingRequestError, OAuthTokenError, RefreshTokenProvider, calendarEventIdFor, meetingViews,
  type ArrangeInput,
} from '@ensemble/meeting';
import { MemoryLedgerStore } from '@ensemble/store';

// Only the provider is fake; ledger, idempotency keys and the read model are real.
const context = { projectId: 'space-a', targetProductId: 'product' };
async function fixture(options: { lease?: number } = {}) {
  const store = new MemoryLedgerStore();
  const owner = { kind: 'human' as const, id: 'owner' };
  await store.append((['owner', 'mina', 'joon', 'agent'] as const).map(id => ({ ...context, actor: owner, type: 'member_joined', payload: { memberId: id, kind: id === 'agent' ? 'agent' : 'human', displayName: id } } satisfies NewLedgerEvent)));
  const adapter = new FakeMeetingAdapter();
  let now = new Date('2026-10-07T01:00:00.000Z');
  const clock = { set: (iso: string) => { now = new Date(iso); } };
  const coordinator = new MeetingCoordinator({ store, context, adapter, now: () => now, ...(options.lease !== undefined ? { inFlightLeaseMs: options.lease } : {}) });
  const events = () => store.read({ projectId: context.projectId });
  const count = async (type: string, kind?: string) => (await events()).filter(e => e.type === type && (kind === undefined || (e.payload as { kind?: string }).kind === kind)).length;
  const spoken = async () => (await events()).flatMap(e => e.type === 'pm_spoke' ? [(e.payload as { text: string }).text] : []);
  return { store, adapter, coordinator, clock, events, count, spoken };
}
const arrangeInput: ArrangeInput = {
  coordinationKey: 'conflict:checkout-copy', purpose: '결제 문구 충돌 정리', agenda: ['문구 A/B 중 선택', '담당 확정'],
  attendees: [{ memberId: 'mina', email: 'Mina@example.test' }, { memberId: 'joon', email: 'joon@example.test' }],
  start: '2026-10-07T05:00:00.000Z', end: '2026-10-07T05:30:00.000Z', timeZone: 'Asia/Seoul', confirmedBy: 'owner',
};

test('arranging twice, in sequence and concurrently, makes one space, one event and one invite per attendee', async () => {
  const f = await fixture();
  const release = f.adapter.hold();
  const concurrent = Promise.all([f.coordinator.arrange(arrangeInput), f.coordinator.arrange(arrangeInput), f.coordinator.arrange(arrangeInput)]);
  await new Promise(resolve => setTimeout(resolve, 10));
  release();
  const views = await concurrent;
  const again = await f.coordinator.arrange(arrangeInput);
  assert.equal(f.adapter.spaces.length, 1);
  assert.equal(f.adapter.events.size, 1);
  assert.equal(f.adapter.calls.createSpace, 1);
  assert.deepEqual(f.adapter.invitesDelivered.map(i => i.email), ['mina@example.test', 'joon@example.test']);
  assert.ok([...f.adapter.events.keys()][0] === calendarEventIdFor(context.projectId, arrangeInput.coordinationKey));
  assert.equal(await f.count('meeting_requested'), 1);
  assert.equal(await f.count('meeting_observed', 'space_created'), 1);
  assert.equal(await f.count('meeting_observed', 'invite_sent'), 1);
  for (const view of [...views, again]) {
    assert.deepEqual(view.states, ['invite_sent']);
    assert.deepEqual(view.attendees.map(a => a.invite), ['sent_unconfirmed', 'sent_unconfirmed']);
    assert.equal(view.pm, 'not_joined');
    assert.equal(view.fake, true);
  }
  // Told once in the Space conversation, as an accepted request rather than a delivered invite.
  const said = await f.spoken();
  assert.equal(said.length, 1);
  assert.match(said[0]!, /초대 요청 접수 · 수신 미확인/);
  assert.match(said[0]!, /수신과 입장은 아직 확인하지 않았어요/);
});

test('a different request under the same key, a non-human confirmer or a non-member attendee writes nothing', async () => {
  const f = await fixture();
  await f.coordinator.arrange(arrangeInput);
  await assert.rejects(f.coordinator.arrange({ ...arrangeInput, purpose: '다른 목적' }), (e: unknown) => e instanceof MeetingRequestError && e.code === 'conflict');
  await assert.rejects(f.coordinator.arrange({ ...arrangeInput, coordinationKey: 'k2', confirmedBy: 'agent' }), { code: 'forbidden' });
  await assert.rejects(f.coordinator.arrange({ ...arrangeInput, coordinationKey: 'k3', attendees: [{ memberId: 'stranger', email: 's@example.test' }] }), { code: 'forbidden' });
  await assert.rejects(f.coordinator.arrange({ ...arrangeInput, coordinationKey: 'k4', end: arrangeInput.start }), { code: 'invalid' });
  assert.equal(await f.count('meeting_requested'), 1);
  assert.equal(f.adapter.calls.createSpace, 1);
});

test('a failed space call is a failed state; the retry makes the only space', async () => {
  const f = await fixture();
  f.adapter.failNext('createSpace', { code: 'provider_error', message: '503', retryable: true });
  const failed = await f.coordinator.arrange(arrangeInput);
  assert.deepEqual(failed.states, ['failed']);
  assert.equal(failed.failure?.step, 'space');
  assert.equal(failed.link, undefined);
  assert.equal(f.adapter.invitesDelivered.length, 0);
  assert.match((await f.spoken())[0]!, /실패 · 사유 provider_error/);
  const retried = await f.coordinator.arrange(arrangeInput);
  assert.deepEqual(retried.states, ['invite_sent']);
  assert.equal(f.adapter.spaces.length, 1);
  assert.equal(await f.count('meeting_observed', 'space_reserved'), 2);
});

test('an attempt with no recorded result blocks a second space until its lease ends', async () => {
  const f = await fixture({ lease: 60_000 });
  // The first process stalls inside spaces.create (stand-in for a crash before the result is written).
  const release = f.adapter.hold();
  const first = f.coordinator.arrange(arrangeInput);
  await new Promise(resolve => setTimeout(resolve, 10));
  // Another process (own coordinator, same ledger) retries within the lease: it waits instead of creating.
  const other = new MeetingCoordinator({ store: f.store, context, adapter: f.adapter, now: () => new Date('2026-10-07T01:00:30.000Z'), inFlightLeaseMs: 60_000 });
  const during = await other.arrange(arrangeInput);
  assert.deepEqual(during.states, ['pending']);
  assert.equal(during.inFlight?.attempt, 1);
  assert.equal(f.adapter.calls.createSpace, 1);
  assert.equal(f.adapter.invitesDelivered.length, 0);
  assert.deepEqual(await f.spoken(), []);
  release();
  assert.deepEqual((await first).states, ['invite_sent']);
  assert.equal(f.adapter.spaces.length, 1);
});

test('a lease that ran out allows a new attempt; the late first result is not used', async () => {
  const f = await fixture({ lease: 1_000 });
  const release = f.adapter.hold();
  const first = f.coordinator.arrange(arrangeInput);
  await new Promise(resolve => setTimeout(resolve, 10));
  f.clock.set('2026-10-07T01:00:05.000Z');
  const other = new MeetingCoordinator({ store: f.store, context, adapter: f.adapter, now: () => new Date('2026-10-07T01:00:05.000Z'), inFlightLeaseMs: 1_000 });
  const second = other.arrange(arrangeInput);
  await new Promise(resolve => setTimeout(resolve, 10));
  release();
  await Promise.all([first, second]);
  const [view] = meetingViews(await f.events());
  // Two spaces exist at the provider, but only one is recorded and only it was invited to.
  assert.equal(f.adapter.calls.createSpace, 2);
  assert.equal(f.adapter.spaces.length, 2);
  assert.equal(await f.count('meeting_observed', 'space_created'), 1);
  assert.equal(f.adapter.events.size, 1);
  assert.equal(f.adapter.invitesDelivered.length, 2);
  assert.equal([...f.adapter.events.values()][0]!.space.meetingUri, view!.link);
});

test('an invite whose reply was lost is read back on retry without a second email', async () => {
  const f = await fixture();
  f.adapter.failNext('insertInvite', { code: 'network', message: 'timeout', retryable: true, uncertain: true }, true);
  const lost = await f.coordinator.arrange(arrangeInput);
  assert.deepEqual(lost.states, ['failed']);
  assert.equal(lost.failure?.uncertain, true);
  assert.match((await f.spoken()).at(-1)!, /요청 반영 여부 불확실/);
  const retried = await f.coordinator.arrange(arrangeInput);
  assert.deepEqual(retried.states, ['invite_sent']);
  assert.equal(f.adapter.invitesDelivered.length, 2);
  const sent = (await f.events()).find(e => e.type === 'meeting_observed' && (e.payload as { kind: string }).kind === 'invite_sent')!.payload as { event: { replayed: boolean } };
  assert.equal(sent.event.replayed, true);
});

test('attendee replies stay distinct: accepted, declined and silence after the start are not success', async () => {
  const f = await fixture();
  await f.coordinator.arrange(arrangeInput);
  f.adapter.responses.set('mina@example.test', 'declined');
  let view = await f.coordinator.refreshResponses(meetingViews(await f.events())[0]!.meetingId);
  assert.deepEqual(view.attendees.map(a => a.invite), ['declined', 'sent_unconfirmed']);
  f.clock.set('2026-10-07T05:01:00.000Z');
  view = await f.coordinator.refreshResponses(view.meetingId);
  assert.deepEqual(view.attendees.map(a => a.invite), ['declined', 'no_response']);
  assert.deepEqual(view.states, ['no_response', 'invite_sent']);
  f.adapter.responses.set('mina@example.test', 'accepted');
  view = await f.coordinator.refreshResponses(view.meetingId);
  assert.equal(view.attendees[0]!.invite, 'accepted');
  // Repeating a poll with nothing new adds nothing.
  const before = (await f.events()).length;
  await f.coordinator.refreshResponses(view.meetingId);
  assert.equal((await f.events()).length, before);
});

test('an in-meeting question on a path without chat is unsupported, not sent; silence becomes no_response', async () => {
  const f = await fixture();
  const google = new GoogleMeetCalendarAdapter({ accessToken: async () => 'unused', fetch: async () => { throw new Error('no network in tests'); } });
  const meetingOnly = new MeetingCoordinator({ store: f.store, context, adapter: google, now: () => new Date('2026-10-07T05:05:00.000Z') });
  const invited = await f.coordinator.registerInvitation({ coordinationKey: 'weekly', purpose: '주간 회의', link: 'https://meet.google.com/abc-defg-hij', confirmedBy: 'owner' });
  assert.deepEqual(invited.states, ['pending']);
  const unsupported = await meetingOnly.ask(invited.meetingId, { questionId: 'q1', text: '문구 A로 확정할까요?' });
  assert.deepEqual(unsupported.states, ['unsupported', 'pending']);
  assert.deepEqual(unsupported.unsupported, ['chat_send']);
  assert.equal(await f.count('meeting_observed', 'question_sent'), 0);
  // With a chat-capable path the question is sent, then times out without an answer.
  const sent = await f.coordinator.ask(invited.meetingId, { questionId: 'q2', text: '담당은 mina로 할까요?' });
  assert.deepEqual(sent.openQuestions, ['q2']);
  f.clock.set('2026-10-07T01:10:00.000Z');
  const silent = await f.coordinator.expireQuestions(invited.meetingId, 5 * 60_000);
  assert.ok(silent.states.includes('no_response'));
  assert.deepEqual(silent.openQuestions, []);
});

test('reported refusal and disconnection are their own states, and a human report needs a human', async () => {
  const f = await fixture();
  const invited = await f.coordinator.registerInvitation({ coordinationKey: 'weekly', purpose: '주간 회의', link: 'https://meet.google.com/abc-defg-hij', confirmedBy: 'owner' });
  let view = await f.coordinator.report(invited.meetingId, { kind: 'join_refused', subjectId: 'pm', reportedBy: 'owner', evidence: 'human_report', detail: '호스트가 입장 요청을 거절' });
  assert.deepEqual(view.states, ['join_refused']);
  view = await f.coordinator.report(invited.meetingId, { kind: 'joined', subjectId: 'pm', reportedBy: 'owner', evidence: 'human_report', observedAt: '2026-10-07T01:02:00.000Z' });
  assert.deepEqual(view.states, ['joined']);
  view = await f.coordinator.report(invited.meetingId, { kind: 'disconnected', subjectId: 'pm', reportedBy: 'owner', evidence: 'human_report', observedAt: '2026-10-07T01:03:00.000Z' });
  assert.deepEqual(view.states, ['disconnected']);
  await assert.rejects(f.coordinator.report(invited.meetingId, { kind: 'joined', subjectId: 'pm', reportedBy: 'agent', evidence: 'human_report' }), { code: 'forbidden' });
  await assert.rejects(f.coordinator.report(invited.meetingId, { kind: 'unsupported', reportedBy: 'owner', evidence: 'human_report' }), { code: 'invalid' });
  assert.ok((await f.spoken()).some(text => /입장 거절/.test(text)));
  assert.ok((await f.spoken()).some(text => /연결 끊김/.test(text)));
});

test('in-meeting context skips the PM Agent own messages and duplicates; answers close the question', async () => {
  const f = await fixture();
  const invited = await f.coordinator.registerInvitation({ coordinationKey: 'weekly', purpose: '주간 회의', link: 'https://meet.google.com/abc-defg-hij', confirmedBy: 'owner' });
  await f.coordinator.ask(invited.meetingId, { questionId: 'q1', text: '문구 A로 확정할까요?' });
  const utterances = [
    { ref: 'c1', speaker: { kind: 'pm' as const, id: 'pm' }, text: '문구 A로 확정할까요?', channel: 'in_meeting_chat' as const, at: '2026-10-07T01:01:00.000Z' },
    { ref: 'c2', speaker: { kind: 'human' as const, id: 'mina' }, text: '네, A로 가요', channel: 'in_meeting_chat' as const, at: '2026-10-07T01:01:30.000Z', replyTo: 'q1' },
    { ref: 'c3', speaker: { kind: 'human' as const, id: 'joon' }, text: '일정은 금요일까지', channel: 'in_meeting_chat' as const, at: '2026-10-07T01:02:00.000Z' },
  ];
  assert.deepEqual(await f.coordinator.ingest(invited.meetingId, utterances), { recorded: 2, skippedSelf: 1, duplicates: 0 });
  assert.deepEqual(await f.coordinator.ingest(invited.meetingId, utterances), { recorded: 0, skippedSelf: 1, duplicates: 2 });
  const view = (await f.coordinator.view(invited.meetingId))!;
  assert.deepEqual(view.openQuestions, []);
  assert.equal(view.inMeetingEvidence, true);
  assert.equal(await f.count('meeting_observed', 'answer_received'), 1);
});

test('decisions, proposals and open items keep author and source; duplicates and PM decisions are refused', async () => {
  const f = await fixture();
  const arranged = await f.coordinator.arrange(arrangeInput);
  const source = { channel: 'in_meeting_chat' as const, ref: 'c2', quote: '네, A로 가요' };
  const result = await f.coordinator.recordNotes(arranged.meetingId, [
    { kind: 'decision', text: '결제 문구는 A안으로 한다', reason: '전환 테스트 결과', ownerId: 'mina', author: { kind: 'human', id: 'mina' }, source, observedAt: '2026-10-07T05:10:00.000Z' },
    { kind: 'proposal', text: '금요일에 A/B 결과를 다시 본다', author: { kind: 'pm', id: 'pm' }, source: { channel: 'in_meeting_chat', ref: 'c3' }, observedAt: '2026-10-07T05:11:00.000Z' },
    { kind: 'open', text: '영문 문구 담당 미정', author: { kind: 'pm', id: 'pm' }, source: { channel: 'in_meeting_chat', ref: 'c4' }, observedAt: '2026-10-07T05:12:00.000Z' },
  ]);
  assert.equal(result.recorded.length, 3);
  const again = await f.coordinator.recordNotes(arranged.meetingId, [{ kind: 'decision', text: '  결제 문구는  A안으로 한다 ', author: { kind: 'human', id: 'mina' }, source, observedAt: '2026-10-07T05:20:00.000Z' }]);
  assert.deepEqual(again, { recorded: [], duplicates: [result.recorded[0]] });
  await assert.rejects(f.coordinator.recordNotes(arranged.meetingId, [{ kind: 'decision', text: 'PM이 정함', author: { kind: 'pm', id: 'pm' }, source, observedAt: '2026-10-07T05:20:00.000Z' }]), { code: 'forbidden' });
  await assert.rejects(f.coordinator.recordNotes(arranged.meetingId, [{ kind: 'proposal', text: 'x', author: { kind: 'human', id: 'stranger' }, source, observedAt: '2026-10-07T05:20:00.000Z' }]), { code: 'forbidden' });
  const view = (await f.coordinator.view(arranged.meetingId))!;
  assert.deepEqual(view.notes.map(n => n.kind), ['decision', 'proposal', 'open']);
  const decision = view.notes[0]!;
  assert.deepEqual(decision.author, { kind: 'human', id: 'mina' });
  assert.equal(decision.ownerId, 'mina');
  assert.equal(decision.observedAt, '2026-10-07T05:10:00.000Z');
  assert.deepEqual({ channel: decision.source.channel, ref: decision.source.ref, meetingId: decision.source.meetingId, link: decision.source.link, eventId: decision.source.calendarEventId },
    { channel: 'in_meeting_chat', ref: 'c2', meetingId: arranged.meetingId, link: arranged.link, eventId: arranged.calendarEventId });
  // Notes from in-meeting chat without in-meeting context still do not count as in-meeting evidence on their own.
  assert.equal(view.transcriptOnly, false);
});

test('notes only from a transcript are flagged as transcript processing, not participation', async () => {
  const f = await fixture();
  const invited = await f.coordinator.registerInvitation({ coordinationKey: 'weekly', purpose: '주간 회의', link: 'https://meet.google.com/abc-defg-hij', confirmedBy: 'owner' });
  await f.coordinator.ingest(invited.meetingId, [{ ref: 't1', speaker: { kind: 'human', id: 'mina' }, text: 'A안으로', channel: 'transcript', at: '2026-10-07T02:00:00.000Z' }]);
  await f.coordinator.recordNotes(invited.meetingId, [{ kind: 'decision', text: 'A안', author: { kind: 'human', id: 'mina' }, source: { channel: 'transcript', ref: 't1' }, observedAt: '2026-10-07T02:00:00.000Z' }]);
  const view = (await f.coordinator.view(invited.meetingId))!;
  assert.equal(view.transcriptOnly, true);
  assert.equal(view.inMeetingEvidence, false);
  assert.deepEqual(view.states, ['pending']);
});

// ---- Google adapter request shape (fetch is mocked; nothing reaches Google) ----

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown };
function mockFetch(replies: ((call: Call) => { status: number; body?: unknown } | Error)[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const call: Call = { url: String(url), method: init?.method ?? 'GET', headers: init?.headers as Record<string, string>, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) };
    calls.push(call);
    const reply = replies.shift()!(call);
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const SECRET = 'ya29.test-token-not-real';
const invite = {
  meetingId: 'meeting-1', projectId: 'space-a', calendarEventId: 'ens0123abcd', purpose: '결제 문구 충돌 정리', agenda: ['문구 선택'],
  attendees: [{ memberId: 'mina', email: 'mina@example.test' }], start: '2026-10-07T05:00:00.000Z', end: '2026-10-07T05:30:00.000Z', timeZone: 'Asia/Seoul',
  space: { name: 'spaces/abc', meetingUri: 'https://meet.google.com/abc-defg-hij', meetingCode: 'abc-defg-hij' }, sendUpdates: 'all' as const,
};

test('google adapter: spaces.create and events.insert request shape', async () => {
  const { calls, fetchImpl } = mockFetch([
    () => ({ status: 200, body: { name: 'spaces/abc', meetingUri: 'https://meet.google.com/abc-defg-hij', meetingCode: 'abc-defg-hij' } }),
    () => ({ status: 200, body: { id: 'ens0123abcd', htmlLink: 'https://calendar.google.com/event?eid=x' } }),
  ]);
  const adapter = new GoogleMeetCalendarAdapter({ accessToken: async () => SECRET, fetch: fetchImpl, calendarId: 'pm-agent@example.test' });
  const space = await adapter.createSpace({ meetingId: 'meeting-1', attempt: 1 });
  assert.deepEqual(space, { status: 'ok', value: { name: 'spaces/abc', meetingUri: 'https://meet.google.com/abc-defg-hij', meetingCode: 'abc-defg-hij' } });
  assert.equal(calls[0]!.method, 'POST');
  assert.equal(calls[0]!.url, 'https://meet.googleapis.com/v2/spaces');
  assert.equal(calls[0]!.headers.authorization, `Bearer ${SECRET}`);
  // Product decision 2026-10-08: PM-created meetings open without knocking unless configured otherwise.
  assert.deepEqual(calls[0]!.body, { config: { accessType: 'OPEN' } });
  const inserted = await adapter.insertInvite(invite);
  assert.deepEqual(inserted, { status: 'ok', value: { eventId: 'ens0123abcd', htmlLink: 'https://calendar.google.com/event?eid=x', link: 'https://meet.google.com/abc-defg-hij' } });
  assert.equal(calls[1]!.url, 'https://www.googleapis.com/calendar/v3/calendars/pm-agent%40example.test/events?sendUpdates=all');
  const body = calls[1]!.body as Record<string, any>;
  assert.equal(body.id, 'ens0123abcd');
  assert.equal(body.summary, '결제 문구 충돌 정리');
  assert.equal(body.location, 'https://meet.google.com/abc-defg-hij');
  assert.match(body.description, /Google Meet: https:\/\/meet\.google\.com\/abc-defg-hij/);
  assert.match(body.description, /- 문구 선택/);
  assert.match(body.description, /PM Agent가 참여할 수 있으며/);
  assert.deepEqual(body.attendees, [{ email: 'mina@example.test' }]);
  assert.deepEqual(body.start, { dateTime: '2026-10-07T05:00:00.000Z', timeZone: 'Asia/Seoul' });
  assert.deepEqual(body.extendedProperties, { private: { ensembleMeetingId: 'meeting-1', ensembleProjectId: 'space-a' } });
  assert.equal(body.guestsCanInviteOthers, false);
});

test('google adapter: space access defaults to OPEN, is configurable, and reads back via spaces.get', async () => {
  const { calls, fetchImpl } = mockFetch([
    () => ({ status: 200, body: { name: 'spaces/abc', meetingUri: 'https://meet.google.com/abc-defg-hij' } }),
    () => ({ status: 200, body: { name: 'spaces/abc', config: { accessType: 'TRUSTED' } } }),
    () => ({ status: 403, body: { error: { status: 'PERMISSION_DENIED' } } }),
  ]);
  const trusted = new GoogleMeetCalendarAdapter({ accessToken: async () => SECRET, fetch: fetchImpl, accessType: 'TRUSTED' });
  await trusted.createSpace({ meetingId: 'm', attempt: 1 });
  assert.deepEqual(calls[0]!.body, { config: { accessType: 'TRUSTED' } });
  assert.deepEqual(await trusted.readSpaceAccess('spaces/abc'), { status: 'ok', value: { accessType: 'TRUSTED' } });
  assert.equal(calls[1]!.method, 'GET');
  assert.equal(calls[1]!.url, 'https://meet.googleapis.com/v2/spaces/abc');
  const denied = await trusted.readSpaceAccess('spaces/abc');
  assert.equal(denied.status, 'failed');
  assert.equal(DEFAULT_MEET_ACCESS_TYPE, 'OPEN');
});

test('google adapter: 409 reads the event back; a foreign or cancelled holder is a failure', async () => {
  const own = { id: 'ens0123abcd', status: 'confirmed', extendedProperties: { private: { ensembleMeetingId: 'meeting-1' } } };
  for (const [existing, expected] of [
    [own, { status: 'ok', replayed: true, value: { eventId: 'ens0123abcd' } }],
    [{ ...own, extendedProperties: { private: { ensembleMeetingId: 'other' } } }, { code: 'id_conflict' }],
    [{ ...own, status: 'cancelled' }, { code: 'cancelled' }],
  ] as const) {
    const { calls, fetchImpl } = mockFetch([() => ({ status: 409, body: { error: { code: 409, status: 'ALREADY_EXISTS', message: 'The requested identifier already exists.' } } }), () => ({ status: 200, body: existing })]);
    const result = await new GoogleMeetCalendarAdapter({ accessToken: async () => SECRET, fetch: fetchImpl }).insertInvite(invite);
    if ('replayed' in expected) assert.deepEqual(result, expected);
    else assert.equal(result.status === 'failed' && result.code, expected.code);
    assert.equal(calls[1]!.method, 'GET');
    assert.equal(calls[1]!.url, 'https://www.googleapis.com/calendar/v3/calendars/primary/events/ens0123abcd');
  }
});

test('google adapter: errors are classified and never carry the token', async () => {
  const cases = [
    [() => ({ status: 401, body: { error: { status: 'UNAUTHENTICATED', message: `Bearer ${SECRET} invalid` } } }), { code: 'unauthenticated', retryable: false }],
    [() => ({ status: 403, body: { error: { status: 'PERMISSION_DENIED', message: 'scope' } } }), { code: 'permission_denied', retryable: false }],
    [() => ({ status: 429, body: {} }), { code: 'rate_limited', retryable: true }],
    [() => ({ status: 503, body: {} }), { code: 'provider_error', retryable: true, uncertain: true }],
    [() => new TypeError('fetch failed'), { code: 'network', retryable: true, uncertain: true }],
  ] as const;
  for (const [reply, expected] of cases) {
    const { fetchImpl } = mockFetch([reply as never]);
    const result = await new GoogleMeetCalendarAdapter({ accessToken: async () => SECRET, fetch: fetchImpl }).createSpace({ meetingId: 'm', attempt: 1 });
    assert.equal(result.status, 'failed');
    if (result.status !== 'failed') continue;
    assert.equal(result.code, expected.code);
    assert.equal(result.retryable, expected.retryable);
    assert.equal(result.uncertain === true, 'uncertain' in expected);
    assert.ok(!result.message.includes(SECRET));
  }
  const noToken = await new GoogleMeetCalendarAdapter({ accessToken: async () => { throw new Error(SECRET); }, fetch: (async () => { throw new Error('must not be called'); }) as typeof fetch }).createSpace({ meetingId: 'm', attempt: 1 });
  assert.deepEqual(noToken, { status: 'failed', code: 'auth_unavailable', message: 'access token provider failed', retryable: false });
});

test('google adapter: replies and participants are read back; in-meeting chat is unsupported', async () => {
  const { calls, fetchImpl } = mockFetch([
    () => ({ status: 200, body: { attendees: [{ email: 'mina@example.test', responseStatus: 'accepted' }, { email: 'joon@example.test', responseStatus: 'needsAction' }, { email: 'room@example.test', responseStatus: 'weird' }] } }),
    () => ({ status: 200, body: { conferenceRecords: [{ name: 'conferenceRecords/r1' }] } }),
    () => ({ status: 200, body: { participants: [{ name: 'conferenceRecords/r1/participants/p1', earliestStartTime: '2026-10-07T05:01:00Z', signedinUser: { user: 'users/1', displayName: 'Mina' } }] } }),
  ]);
  const adapter = new GoogleMeetCalendarAdapter({ accessToken: async () => SECRET, fetch: fetchImpl });
  assert.deepEqual(await adapter.readResponses('ens0123abcd'), { status: 'ok', value: [{ email: 'mina@example.test', response: 'accepted' }, { email: 'joon@example.test', response: 'needsAction' }] });
  assert.deepEqual(await adapter.listParticipants('spaces/abc'), { status: 'ok', value: [{ name: 'conferenceRecords/r1/participants/p1', displayName: 'Mina', joinedAt: '2026-10-07T05:01:00Z' }] });
  assert.equal(calls[1]!.url, `https://meet.googleapis.com/v2/conferenceRecords?filter=${encodeURIComponent('space.name = "spaces/abc"')}`);
  assert.equal(calls[2]!.url, 'https://meet.googleapis.com/v2/conferenceRecords/r1/participants');
  const chat = await adapter.sendInMeeting();
  assert.equal(chat.status, 'unsupported');
  assert.equal(calls.length, 3);
});

test('participants seen by the provider are recorded once each, without guessing members', async () => {
  const f = await fixture();
  const arranged = await f.coordinator.arrange(arrangeInput);
  f.adapter.participants = [{ name: 'p/1', displayName: 'Mina Kim', joinedAt: '2026-10-07T05:01:00.000Z' }];
  await f.coordinator.observeParticipants(arranged.meetingId);
  const view = await f.coordinator.observeParticipants(arranged.meetingId);
  assert.deepEqual(view.participants, [{ name: 'Mina Kim', evidence: 'fake' }]);
  assert.deepEqual(view.attendees.map(a => a.joined), [false, false]);
  assert.equal(view.pm, 'not_joined');
});

// ---- live-path additions: silent events, cross-ledger replay, OAuth refresh, access probe ----

test('notifyAttendees false creates the event without emailing anyone and is not reported as an invite', async () => {
  const f = await fixture();
  const view = await f.coordinator.arrange({ ...arrangeInput, notifyAttendees: false });
  assert.equal(f.adapter.events.size, 1);
  assert.equal(f.adapter.invitesDelivered.length, 0);
  assert.equal([...f.adapter.events.values()][0]!.sendUpdates, 'none');
  assert.deepEqual(view.states, ['created']);
  assert.equal(view.sendUpdates, 'none');
  assert.deepEqual(view.attendees.map(a => a.invite), ['not_sent', 'not_sent']);
  // The same key with sending switched on is a different request.
  await assert.rejects(f.coordinator.arrange(arrangeInput), { code: 'conflict' });
  const { calls, fetchImpl } = mockFetch([() => ({ status: 200, body: { id: 'ens0123abcd' } })]);
  await new GoogleMeetCalendarAdapter({ accessToken: async () => SECRET, fetch: fetchImpl }).insertInvite({ ...invite, sendUpdates: 'none' });
  assert.match(calls[0]!.url, /\?sendUpdates=none$/);
});

test('a retry from an empty ledger reuses the provider event and reports the link people were invited with', async () => {
  const f = await fixture();
  const first = await f.coordinator.arrange(arrangeInput);
  // Same Space and key, but the local state was lost: a new space is made, the event insert is replayed.
  const g = await fixture();
  const other = new MeetingCoordinator({ store: g.store, context, adapter: f.adapter, now: () => new Date('2026-10-07T01:00:00.000Z') });
  const replay = await other.arrange(arrangeInput);
  assert.equal(f.adapter.spaces.length, 2);
  assert.equal(f.adapter.events.size, 1);
  assert.equal(f.adapter.invitesDelivered.length, 2);
  assert.equal(replay.link, first.link);
  assert.equal(replay.spaceMismatch, true);
  assert.equal(replay.spaceName, undefined);
  assert.equal(first.spaceMismatch, false);
});

const TOKEN_ENV = { clientId: 'client-id-not-real', clientSecret: 'client-secret-not-real', refreshToken: 'refresh-token-not-real' };
test('refresh-token provider: form request, cache until expiry, one exchange for concurrent callers', async () => {
  let now = 1_000_000;
  const { calls, fetchImpl } = mockFetch([
    () => ({ status: 200, body: { access_token: 'access-1', expires_in: 3600, scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/meetings.space.created', token_type: 'Bearer' } }),
    () => ({ status: 200, body: { access_token: 'access-2', expires_in: 3600 } }),
  ]);
  // mockFetch parses bodies as JSON; capture the raw form separately.
  const forms: string[] = [];
  const provider = new RefreshTokenProvider({ ...TOKEN_ENV, now: () => now, fetch: (async (url, init) => { forms.push(String(init?.body)); return fetchImpl(url, { ...init, body: undefined }); }) as typeof fetch });
  assert.deepEqual(await Promise.all([provider.accessToken(), provider.accessToken(), provider.accessToken()]), ['access-1', 'access-1', 'access-1']);
  assert.equal(provider.exchanges, 1);
  assert.equal(calls[0]!.url, 'https://oauth2.googleapis.com/token');
  assert.equal(calls[0]!.method, 'POST');
  assert.equal(calls[0]!.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(forms[0])), { grant_type: 'refresh_token', client_id: TOKEN_ENV.clientId, client_secret: TOKEN_ENV.clientSecret, refresh_token: TOKEN_ENV.refreshToken });
  assert.deepEqual(provider.scopes, ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/meetings.space.created']);
  now += 3_500_000; // 100 s before expiry: still cached
  assert.equal(await provider.accessToken(), 'access-1');
  assert.equal(provider.exchanges, 1);
  now += 50_000; // 50 s before expiry: inside the 60 s skew, refreshed
  assert.equal(await provider.accessToken(), 'access-2');
  assert.equal(provider.exchanges, 2);
  const printed = JSON.stringify(provider) + inspect(provider, { showHidden: true, depth: 5 });
  for (const secret of [...Object.values(TOKEN_ENV), 'access-1', 'access-2']) assert.ok(!printed.includes(secret), `leaked ${secret}`);
});

test('refresh-token provider: failures name an error class only', async () => {
  const cases = [
    [() => ({ status: 400, body: { error: 'invalid_grant', error_description: `Bad ${TOKEN_ENV.refreshToken}` } }), 'invalid_grant'],
    [() => ({ status: 401, body: { error: 'invalid_client' } }), 'invalid_client'],
    [() => ({ status: 500, body: { error: { message: 'html?' } } }), 'http_500'],
    [() => ({ status: 200, body: { token_type: 'Bearer' } }), 'bad_response'],
    [() => new TypeError('fetch failed'), 'network'],
  ] as const;
  for (const [reply, code] of cases) {
    const { fetchImpl } = mockFetch([reply as never]);
    const provider = new RefreshTokenProvider({ ...TOKEN_ENV, fetch: (async (url, init) => fetchImpl(url, { ...init, body: undefined })) as typeof fetch });
    const error = await provider.accessToken().then(() => undefined, (e: unknown) => e);
    assert.ok(error instanceof OAuthTokenError);
    assert.equal(error.code, code);
    for (const secret of Object.values(TOKEN_ENV)) assert.ok(!error.message.includes(secret));
  }
  assert.throws(() => new RefreshTokenProvider({ ...TOKEN_ENV, refreshToken: '' }), { code: 'missing_refreshToken' });
});

test('google adapter: access probe reads one Calendar page and one Meet page', async () => {
  const { calls, fetchImpl } = mockFetch([() => ({ status: 200, body: { items: [{}] } }), () => ({ status: 403, body: { error: { status: 'PERMISSION_DENIED', message: 'scope' } } })]);
  const probe = await new GoogleMeetCalendarAdapter({ accessToken: async () => SECRET, fetch: fetchImpl }).probe();
  assert.deepEqual(probe.calendar, { status: 'ok', value: { items: 1 } });
  assert.equal(probe.meet.status === 'failed' && probe.meet.code, 'permission_denied');
  assert.deepEqual(calls.map(c => `${c.method} ${c.url}`), ['GET https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1', 'GET https://meet.googleapis.com/v2/conferenceRecords?pageSize=1']);
});
