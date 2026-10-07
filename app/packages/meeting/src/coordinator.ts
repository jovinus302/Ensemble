// PM Agent meeting coordination for one Space (#80). Every step is a ledger fact first: a retry with the same
// coordination key finds the same meeting, the same Meet space and the same Calendar event id, so it cannot
// create a second room or send a second invite. Waiting and failed states are posted to the Space conversation
// through the existing pm_considered/pm_spoke path, without touching the shared Space UI.
import { project, type Actor, type EventContext, type Id, type LedgerEvent, type NewLedgerEvent } from '@ensemble/core';
import type { LedgerStore } from '@ensemble/store';
import { calendarEventIdFor, key, meetingIdFor, noteIdFor, requestDigestOf } from './ids.ts';
import { meetingEvents, meetingStatusLine, meetingView, type MeetingState, type MeetingView } from './projection.ts';
import {
  MeetingRequestError,
  type AdapterOutcome, type MeetingAdapter, type MeetingAttendee, type MeetingCapability, type MeetingChannel, type MeetingEvidence,
  type MeetingNoteKind, type MeetingNoteRecordedPayload, type MeetingObservedPayload, type MeetingRequestedPayload, type MeetingSourceRef, type MeetingStep,
} from './types.ts';

export interface MeetingCoordinatorOptions {
  store: LedgerStore;
  context: EventContext;
  adapter: MeetingAdapter;
  now?: () => Date;
  /** An unfinished space attempt blocks a new one this long (a crash mid-call must not double-create). Default 2 minutes. */
  inFlightLeaseMs?: number;
  /** The PM Agent's member id; its own utterances are never ingested back. Default `pm`. */
  pmId?: Id;
  /** Post waiting/failed states to the Space conversation. Default true. */
  announce?: boolean;
}

export interface ArrangeInput {
  /** Same key → same meeting. Use the conflict/blocker id that triggered the meeting. */
  coordinationKey: string;
  purpose: string;
  agenda?: string[];
  attendees: MeetingAttendee[];
  start: string;
  end: string;
  timeZone?: string;
  /** The human who confirmed attendees and schedule (issue #80 B2). */
  confirmedBy: Id;
}

export interface InvitationInput {
  coordinationKey: string;
  purpose: string;
  agenda?: string[];
  /** Existing meeting link the person gave the PM Agent. */
  link: string;
  /** The human who invited the PM Agent. */
  confirmedBy: Id;
  attendees?: MeetingAttendee[];
}

export type ReportedKind = 'joined' | 'join_refused' | 'disconnected' | 'unsupported' | 'no_response';
export interface ReportInput {
  kind: ReportedKind;
  /** `pm` for the PM Agent, a member id, or absent for the meeting. */
  subjectId?: Id;
  capability?: MeetingCapability;
  reportedBy: Id;
  evidence: Extract<MeetingEvidence, 'human_report' | 'bot_observation'>;
  channel?: MeetingChannel;
  detail?: string;
  observedAt?: string;
}

export interface Utterance {
  /** Provider- or reporter-side id; the same ref is ingested once. */
  ref: string;
  speaker: { kind: 'human' | 'pm' | 'agent' | 'unknown'; id?: Id; name?: string };
  text: string;
  channel: Extract<MeetingChannel, 'in_meeting_chat' | 'in_meeting_voice' | 'transcript'>;
  at: string;
  /** The PM Agent's question this answers. */
  replyTo?: Id;
}

export interface NoteInput {
  kind: MeetingNoteKind;
  text: string;
  reason?: string;
  ownerId?: Id;
  author: MeetingNoteRecordedPayload['author'];
  source: Omit<MeetingSourceRef, 'meetingId'>;
  observedAt: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** States worth telling a person about. `pending`/`created` are transient and stay on the read model only. */
const ANNOUNCE: readonly MeetingState[] = ['failed', 'join_refused', 'disconnected', 'no_response', 'unsupported', 'invite_sent'];
const HINT: Partial<Record<MeetingState, string>> = {
  failed: '다시 시도하거나 사람이 직접 확인해야 해요.',
  join_refused: '호스트의 입장 승인이 필요해요.',
  disconnected: '다시 연결하거나 사람이 이어받아야 해요.',
  no_response: '응답을 기다리고 있어요.',
  unsupported: '이 방식으로는 할 수 없어 다른 경로가 필요해요.',
  invite_sent: '참여자의 수신과 입장은 아직 확인하지 않았어요.',
};

export class MeetingCoordinator {
  private readonly now: () => Date;
  private readonly pmId: Id;
  private readonly inFlight = new Map<Id, Promise<unknown>>();

  constructor(private readonly options: MeetingCoordinatorOptions) {
    this.now = options.now ?? (() => new Date());
    this.pmId = options.pmId ?? 'pm';
  }

  private get context() { return this.options.context; }
  private get adapter() { return this.options.adapter; }
  private get adapterEvidence(): MeetingEvidence { return this.adapter.evidence === 'fake' ? 'fake' : 'api_response'; }
  private get pollEvidence(): MeetingEvidence { return this.adapter.evidence === 'fake' ? 'fake' : 'api_poll'; }
  private read() { return this.options.store.read({ projectId: this.context.projectId }); }

  /** Calls for one meeting run one at a time in this process; the ledger guards the rest. */
  private single<T>(meetingId: Id, fn: () => Promise<T>): Promise<T> {
    const previous = this.inFlight.get(meetingId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(fn);
    this.inFlight.set(meetingId, next);
    void next.catch(() => undefined).then(() => { if (this.inFlight.get(meetingId) === next) this.inFlight.delete(meetingId); });
    return next;
  }

  private observation(meetingId: Id, kind: MeetingObservedPayload['kind'], rest: Omit<MeetingObservedPayload, 'observationId' | 'meetingId' | 'kind' | 'observedAt' | 'source' | 'evidence'> & { source?: Partial<MeetingSourceRef>; evidence?: MeetingEvidence; observedAt?: string }, idempotencyKey: string, actor: Actor = { kind: 'pm', id: this.pmId }): NewLedgerEvent {
    const { source, evidence, observedAt, ...fields } = rest;
    const at = this.now().toISOString();
    const payload: MeetingObservedPayload = {
      observationId: idempotencyKey, meetingId, kind,
      source: { meetingId, channel: 'meet_rest', ...source },
      evidence: evidence ?? this.adapterEvidence,
      observedAt: observedAt ?? at,
      ...fields,
    };
    return { ...this.context, actor, type: 'meeting_observed', idempotencyKey, at, payload };
  }

  private failedObservation(meetingId: Id, step: MeetingStep, outcome: Exclude<AdapterOutcome<unknown>, { status: 'ok' }>, idempotencyKey: string, extra: { attempt?: number } = {}): NewLedgerEvent {
    if (outcome.status === 'unsupported') return this.observation(meetingId, 'unsupported', { capability: outcome.capability, detail: outcome.reason, ...extra }, `${idempotencyKey}:unsupported`);
    return this.observation(meetingId, 'failed', {
      failure: { step, code: outcome.code, message: outcome.message, retryable: outcome.retryable, ...(outcome.uncertain ? { uncertain: true } : {}) }, ...extra,
    }, idempotencyKey);
  }

  private requireView(events: readonly LedgerEvent[], meetingId: Id): MeetingView {
    const view = meetingView(events, meetingId);
    if (!view) throw new MeetingRequestError('not_found', `unknown meeting ${meetingId}`);
    return view;
  }

  private requireHuman(events: readonly LedgerEvent[], memberId: Id, role: string) {
    const member = project(events).members.get(memberId);
    if (!member || member.kind !== 'human') throw new MeetingRequestError('forbidden', `${role} must be a human member of this Space: ${memberId}`);
  }

  async view(meetingId: Id): Promise<MeetingView | undefined> { return meetingView(await this.read(), meetingId); }

  /**
   * Flow B: create a Meet space and a Calendar invite for confirmed attendees. Safe to call again with the same
   * key: an existing space or invite is reused, a request that differs from the first one is refused.
   */
  async arrange(input: ArrangeInput): Promise<MeetingView> {
    const coordinationKey = input.coordinationKey.trim();
    const purpose = input.purpose.trim();
    if (!coordinationKey || !purpose) throw new MeetingRequestError('invalid', 'coordinationKey and purpose are required');
    if (!input.attendees.length || input.attendees.some(attendee => !EMAIL.test(attendee.email))) throw new MeetingRequestError('invalid', 'attendees need valid emails');
    const start = Date.parse(input.start), end = Date.parse(input.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new MeetingRequestError('invalid', 'start must be before end');
    const { projectId } = this.context;
    const meetingId = meetingIdFor(projectId, coordinationKey);
    const fields = {
      purpose, agenda: input.agenda ?? [], attendees: input.attendees.map(a => ({ memberId: a.memberId, email: a.email.trim().toLowerCase() })),
      start: input.start, end: input.end, ...(input.timeZone ? { timeZone: input.timeZone } : {}), confirmedBy: input.confirmedBy,
    };
    const request: MeetingRequestedPayload = {
      meetingId, coordinationKey, origin: 'arranged', ...fields,
      calendarEventId: calendarEventIdFor(projectId, coordinationKey), requestDigest: requestDigestOf({ origin: 'arranged', ...fields }),
    };
    await this.options.store.transaction(projectId, events => {
      this.requireHuman(events, input.confirmedBy, 'confirmedBy');
      for (const attendee of input.attendees) this.requireHuman(events, attendee.memberId, 'attendee');
      const existing = meetingEvents(events).find(e => e.type === 'meeting_requested' && e.payload.meetingId === meetingId);
      if (existing?.type === 'meeting_requested') {
        if (existing.payload.requestDigest !== request.requestDigest) throw new MeetingRequestError('conflict', 'this coordination key already holds a different meeting request');
        return { append: [], result: undefined };
      }
      return { append: [{ ...this.context, actor: { kind: 'pm', id: this.pmId }, type: 'meeting_requested', idempotencyKey: key(meetingId, 'requested'), payload: request }], result: undefined };
    });
    return this.single(meetingId, () => this.advance(meetingId));
  }

  private async advance(meetingId: Id): Promise<MeetingView> {
    const { store } = this.options;
    const { projectId } = this.context;
    // 1. Space. Meet spaces.create has no request id: reserve an attempt in the ledger before calling.
    const reservation = await store.transaction<{ call: false } | { call: true; attempt: number }>(projectId, events => {
      const view = this.requireView(events, meetingId);
      if (view.spaceName) return { append: [], result: { call: false } };
      if (view.inFlight && this.now().getTime() - Date.parse(view.inFlight.since) < (this.options.inFlightLeaseMs ?? 120_000)) return { append: [], result: { call: false } };
      const attempt = meetingEvents(events).filter(e => e.type === 'meeting_observed' && e.payload.meetingId === meetingId && e.payload.kind === 'space_reserved').length + 1;
      return { append: [this.observation(meetingId, 'space_reserved', { attempt }, key(meetingId, 'space', attempt))], result: { call: true, attempt } };
    });
    if (reservation.result.call) {
      const { attempt } = reservation.result;
      const outcome = await this.adapter.createSpace({ meetingId, attempt });
      await store.append([outcome.status === 'ok'
        // A late result of an abandoned attempt is dropped by the key; its space stays unused and uninvited.
        ? this.observation(meetingId, 'space_created', { attempt, space: outcome.value, source: { spaceName: outcome.value.name, link: outcome.value.meetingUri } }, key(meetingId, 'space-created'))
        : this.failedObservation(meetingId, 'space', outcome, key(meetingId, 'space', attempt, 'failed'), { attempt })]);
    }
    // 2. Invite. The Calendar event id is deterministic, so the provider itself refuses a second insert.
    let events = await this.read();
    let view = this.requireView(events, meetingId);
    const request = meetingEvents(events).find(e => e.type === 'meeting_requested' && e.payload.meetingId === meetingId)!.payload as MeetingRequestedPayload;
    const space = meetingEvents(events).find(e => e.type === 'meeting_observed' && e.payload.meetingId === meetingId && e.payload.kind === 'space_created')?.payload as MeetingObservedPayload | undefined;
    if (space?.space && !view.calendarEventId && request.calendarEventId && request.start && request.end) {
      const outcome = await this.adapter.insertInvite({
        meetingId, projectId, calendarEventId: request.calendarEventId, purpose: request.purpose, agenda: request.agenda,
        attendees: request.attendees, start: request.start, end: request.end, ...(request.timeZone ? { timeZone: request.timeZone } : {}), space: space.space,
      });
      const failures = meetingEvents(events).filter(e => e.type === 'meeting_observed' && e.payload.meetingId === meetingId && e.payload.failure?.step === 'invite').length;
      await store.append([outcome.status === 'ok'
        ? this.observation(meetingId, 'invite_sent', {
          event: { id: outcome.value.eventId, ...(outcome.value.htmlLink ? { htmlLink: outcome.value.htmlLink } : {}), replayed: outcome.replayed === true },
          source: { channel: 'calendar_api', calendarEventId: outcome.value.eventId, spaceName: space.space.name, link: space.space.meetingUri },
          detail: 'Calendar가 초대 발송 요청을 수락함. 참여자 수신은 관찰하지 않음',
        }, key(meetingId, 'invite-sent'))
        : this.failedObservation(meetingId, 'invite', outcome, key(meetingId, 'invite', failures + 1, 'failed'))]);
      events = await this.read();
      view = this.requireView(events, meetingId);
    }
    await this.announce(view);
    return view;
  }

  /** Flow A step 1: a person brings the PM Agent into an existing meeting. Joining is a separate observation. */
  async registerInvitation(input: InvitationInput): Promise<MeetingView> {
    const coordinationKey = input.coordinationKey.trim();
    if (!coordinationKey || !input.purpose.trim()) throw new MeetingRequestError('invalid', 'coordinationKey and purpose are required');
    let link: URL;
    try { link = new URL(input.link); } catch { throw new MeetingRequestError('invalid', 'link must be a URL'); }
    if (link.protocol !== 'https:') throw new MeetingRequestError('invalid', 'link must be https');
    const meetingId = meetingIdFor(this.context.projectId, coordinationKey);
    const fields = { purpose: input.purpose.trim(), agenda: input.agenda ?? [], attendees: input.attendees ?? [], confirmedBy: input.confirmedBy, link: link.toString() };
    const request: MeetingRequestedPayload = { meetingId, coordinationKey, origin: 'invited', ...fields, requestDigest: requestDigestOf({ origin: 'invited', ...fields }) };
    await this.options.store.transaction(this.context.projectId, events => {
      this.requireHuman(events, input.confirmedBy, 'confirmedBy');
      const existing = meetingEvents(events).find(e => e.type === 'meeting_requested' && e.payload.meetingId === meetingId);
      if (existing?.type === 'meeting_requested') {
        if (existing.payload.requestDigest !== request.requestDigest) throw new MeetingRequestError('conflict', 'this coordination key already holds a different meeting request');
        return { append: [], result: undefined };
      }
      return { append: [{ ...this.context, actor: { kind: 'human', id: input.confirmedBy }, type: 'meeting_requested', idempotencyKey: key(meetingId, 'requested'), payload: request }], result: undefined };
    });
    return this.requireView(await this.read(), meetingId);
  }

  /** Reads attendee replies back from Calendar. `needsAction` after the start time becomes `no_response`. */
  async refreshResponses(meetingId: Id): Promise<MeetingView> {
    return this.single(meetingId, async () => {
      const view = this.requireView(await this.read(), meetingId);
      if (!view.calendarEventId) throw new MeetingRequestError('invalid', 'no invite has been sent for this meeting');
      const outcome = await this.adapter.readResponses(view.calendarEventId);
      if (outcome.status !== 'ok') {
        await this.options.store.append([this.failedObservation(meetingId, 'responses', outcome, key(meetingId, 'responses', this.now().toISOString(), 'failed'))]);
      } else {
        const started = view.start !== undefined && this.now().getTime() >= Date.parse(view.start);
        await this.options.store.transaction(this.context.projectId, events => {
          const current = this.requireView(events, meetingId);
          const append: NewLedgerEvent[] = [];
          for (const attendee of current.attendees) {
            const reply: string | undefined = outcome.value.find(item => item.email.toLowerCase() === attendee.email)?.response;
            const kind = reply === 'accepted' ? 'invite_accepted' : reply === 'declined' ? 'invite_declined' : reply === 'tentative' ? 'invite_tentative'
              : started && attendee.invite === 'sent_unconfirmed' ? 'no_response' : undefined;
            const stateOf = { invite_accepted: 'accepted', invite_declined: 'declined', invite_tentative: 'tentative', no_response: 'no_response' } as const;
            if (!kind || attendee.invite === stateOf[kind]) continue;
            const seen = meetingEvents(events).filter(e => e.type === 'meeting_observed' && e.payload.meetingId === meetingId && e.payload.subjectId === attendee.memberId).length;
            append.push(this.observation(meetingId, kind, { subjectId: attendee.memberId, evidence: this.pollEvidence, source: { channel: 'calendar_api', calendarEventId: view.calendarEventId! } }, key(meetingId, 'rsvp', attendee.memberId, seen + 1)));
          }
          return { append, result: undefined };
        });
      }
      const next = this.requireView(await this.read(), meetingId);
      await this.announce(next);
      return next;
    });
  }

  /** Participants the provider saw in this space (Meet REST conferenceRecords). Names are not mapped to members. */
  async observeParticipants(meetingId: Id): Promise<MeetingView> {
    return this.single(meetingId, async () => {
      const view = this.requireView(await this.read(), meetingId);
      if (!view.spaceName) throw new MeetingRequestError('invalid', 'no Meet space is known for this meeting');
      const outcome = await this.adapter.listParticipants(view.spaceName);
      await this.options.store.append(outcome.status === 'ok'
        ? outcome.value.map(p => this.observation(meetingId, 'joined', {
          ...(p.displayName ? { subjectName: p.displayName } : {}), evidence: this.pollEvidence,
          source: { spaceName: view.spaceName!, ref: p.name }, ...(p.joinedAt ? { observedAt: p.joinedAt } : {}),
        }, key(meetingId, 'participant', p.name)))
        : [this.failedObservation(meetingId, 'participants', outcome, key(meetingId, 'participants', outcome.status === 'unsupported' ? outcome.capability : this.now().toISOString()))]);
      const next = this.requireView(await this.read(), meetingId);
      await this.announce(next);
      return next;
    });
  }

  /** Records what a person or an automated participant observed: entry, refusal, drop, missing capability, silence. */
  async report(meetingId: Id, input: ReportInput): Promise<MeetingView> {
    const events = await this.read();
    this.requireView(events, meetingId);
    const reporter = project(events).members.get(input.reportedBy);
    if (!reporter) throw new MeetingRequestError('forbidden', `reporter is not a member of this Space: ${input.reportedBy}`);
    if (input.evidence === 'human_report' && reporter.kind !== 'human') throw new MeetingRequestError('forbidden', 'a human report needs a human reporter');
    if (input.kind === 'unsupported' && !input.capability) throw new MeetingRequestError('invalid', 'unsupported needs a capability');
    const observedAt = input.observedAt ?? this.now().toISOString();
    const subject = input.subjectId ?? 'meeting';
    await this.options.store.append([this.observation(meetingId, input.kind, {
      ...(input.subjectId ? { subjectId: input.subjectId } : {}), ...(input.capability ? { capability: input.capability } : {}),
      ...(input.detail ? { detail: input.detail } : {}), evidence: input.evidence, observedAt,
      source: { channel: input.channel ?? 'human_report', ref: `${input.reportedBy}@${observedAt}` },
    }, key(meetingId, 'report', input.kind, subject, input.capability ?? '-', observedAt), { kind: reporter.kind, id: input.reportedBy })]);
    const next = this.requireView(await this.read(), meetingId);
    await this.announce(next);
    return next;
  }

  /**
   * In-meeting (or transcript) context. The PM Agent's own messages are dropped (no self-ingest), the same ref is
   * kept once, and a reply to an open question becomes its answer.
   */
  async ingest(meetingId: Id, utterances: Utterance[]): Promise<{ recorded: number; skippedSelf: number; duplicates: number }> {
    const tx = await this.options.store.transaction(this.context.projectId, events => {
      const view = this.requireView(events, meetingId);
      const known = new Set(events.flatMap(e => e.idempotencyKey ? [e.idempotencyKey] : []));
      const append: NewLedgerEvent[] = [];
      let skippedSelf = 0, duplicates = 0;
      for (const u of utterances) {
        if (u.speaker.kind === 'pm' || u.speaker.id === this.pmId) { skippedSelf += 1; continue; }
        const idempotencyKey = key(meetingId, 'utterance', u.channel, u.ref);
        if (known.has(idempotencyKey)) { duplicates += 1; continue; }
        known.add(idempotencyKey);
        const answers = u.replyTo !== undefined && view.openQuestions.includes(u.replyTo);
        append.push(this.observation(meetingId, answers ? 'answer_received' : 'context_received', {
          ...(u.speaker.id ? { subjectId: u.speaker.id } : {}), ...(u.speaker.name ? { subjectName: u.speaker.name } : {}),
          ...(answers ? { questionId: u.replyTo! } : {}), text: u.text, observedAt: u.at,
          evidence: u.channel === 'transcript' ? 'api_poll' : 'bot_observation',
          source: { channel: u.channel, ref: u.ref, ...(view.link ? { link: view.link } : {}), ...(view.spaceName ? { spaceName: view.spaceName } : {}) },
        }, idempotencyKey));
      }
      return { append, result: { recorded: append.length, skippedSelf, duplicates } };
    });
    return tx.result;
  }

  /** Puts a question or agreement check to the meeting. Missing support is recorded as `unsupported`, not as sent. */
  async ask(meetingId: Id, input: { questionId: Id; text: string }): Promise<MeetingView> {
    return this.single(meetingId, async () => {
      const events = await this.read();
      const view = this.requireView(events, meetingId);
      const sent = meetingEvents(events).some(e => e.type === 'meeting_observed' && e.payload.meetingId === meetingId && e.payload.kind === 'question_sent' && e.payload.questionId === input.questionId);
      if (!sent) {
        const outcome = await this.adapter.sendInMeeting({ meetingId, ...(view.spaceName ? { spaceName: view.spaceName } : {}), text: input.text });
        await this.options.store.append([outcome.status === 'ok'
          ? this.observation(meetingId, 'question_sent', { questionId: input.questionId, text: input.text, source: { channel: 'in_meeting_chat', ref: outcome.value.ref } }, key(meetingId, 'question', input.questionId))
          : outcome.status === 'unsupported'
            ? this.observation(meetingId, 'unsupported', { capability: outcome.capability, questionId: input.questionId, detail: outcome.reason }, key(meetingId, 'unsupported', outcome.capability))
            : this.failedObservation(meetingId, 'chat_send', outcome, key(meetingId, 'question', input.questionId, 'failed', this.now().toISOString()))]);
      }
      const next = this.requireView(await this.read(), meetingId);
      await this.announce(next);
      return next;
    });
  }

  /** Questions without an answer after `waitMs` become `no_response`. */
  async expireQuestions(meetingId: Id, waitMs: number): Promise<MeetingView> {
    await this.options.store.transaction(this.context.projectId, events => {
      const view = this.requireView(events, meetingId);
      const sentAt = new Map(meetingEvents(events).flatMap(e => e.type === 'meeting_observed' && e.payload.meetingId === meetingId && e.payload.kind === 'question_sent' && e.payload.questionId ? [[e.payload.questionId, Date.parse(e.payload.observedAt)] as const] : []));
      const due = view.openQuestions.filter(id => (sentAt.get(id) ?? Infinity) + waitMs <= this.now().getTime());
      return { append: due.map(questionId => this.observation(meetingId, 'no_response', { questionId, source: { channel: 'in_meeting_chat' } }, key(meetingId, 'question', questionId, 'no_response'))), result: undefined };
    });
    const next = this.requireView(await this.read(), meetingId);
    await this.announce(next);
    return next;
  }

  /**
   * 결정/제안/미해결 with author and source. A decision needs a human author: the PM Agent may propose or
   * leave an item open, never decide. The same item from the same source is recorded once.
   */
  async recordNotes(meetingId: Id, notes: NoteInput[]): Promise<{ recorded: Id[]; duplicates: Id[] }> {
    const tx = await this.options.store.transaction(this.context.projectId, events => {
      const view = this.requireView(events, meetingId);
      const members = project(events).members;
      for (const note of notes) {
        if (!note.text.trim()) throw new MeetingRequestError('invalid', 'note text is required');
        if (!Number.isFinite(Date.parse(note.observedAt))) throw new MeetingRequestError('invalid', 'observedAt must be a timestamp');
        if (note.kind === 'decision' && note.author.kind !== 'human') throw new MeetingRequestError('forbidden', 'only a person can be the author of a decision; record it as a proposal');
        if (note.author.kind !== 'pm' && !members.has(note.author.id)) throw new MeetingRequestError('forbidden', `author is not a member of this Space: ${note.author.id}`);
        if (note.author.kind === 'pm' && note.author.id !== this.pmId) throw new MeetingRequestError('forbidden', 'unknown PM Agent id');
        if (note.ownerId && !members.has(note.ownerId)) throw new MeetingRequestError('invalid', `owner is not a member of this Space: ${note.ownerId}`);
      }
      const known = new Set(events.flatMap(e => e.idempotencyKey ? [e.idempotencyKey] : []));
      const append: NewLedgerEvent[] = [];
      const recorded: Id[] = [], duplicates: Id[] = [];
      for (const note of notes) {
        const noteId = noteIdFor(meetingId, note.kind, note.text, note.source.ref ?? note.source.channel);
        const idempotencyKey = `meeting-note:${noteId}`;
        if (known.has(idempotencyKey)) { duplicates.push(noteId); continue; }
        known.add(idempotencyKey);
        recorded.push(noteId);
        const source: MeetingSourceRef = {
          ...(view.spaceName ? { spaceName: view.spaceName } : {}), ...(view.calendarEventId ? { calendarEventId: view.calendarEventId } : {}), ...(view.link ? { link: view.link } : {}),
          ...note.source, meetingId,
        };
        const payload: MeetingNoteRecordedPayload = {
          noteId, meetingId, kind: note.kind, text: note.text.trim(), ...(note.reason ? { reason: note.reason } : {}), ...(note.ownerId ? { ownerId: note.ownerId } : {}),
          author: note.author, source, observedAt: note.observedAt,
        };
        append.push({ ...this.context, actor: { kind: 'pm', id: this.pmId }, type: 'meeting_note_recorded', idempotencyKey, payload });
      }
      return { append, result: { recorded, duplicates } };
    });
    return tx.result;
  }

  /** Posts the meeting's state line to the Space conversation once per distinct line, only for states a person should know. */
  private async announce(view: MeetingView) {
    if (this.options.announce === false) return;
    const first = view.states.find(state => ANNOUNCE.includes(state));
    if (!first) return;
    const text = `${meetingStatusLine(view)}. ${HINT[first] ?? ''}`.trim();
    const considerationId = key(view.meetingId, 'say', requestDigestOf(text).slice(0, 12));
    const at = this.now().toISOString();
    await this.options.store.transaction(this.context.projectId, events => {
      if (events.some(e => e.idempotencyKey === considerationId)) return { append: [], result: undefined };
      const append: NewLedgerEvent[] = [
        { ...this.context, actor: { kind: 'system', id: this.pmId }, type: 'pm_considered', idempotencyKey: considerationId, at, payload: {
          considerationId, triggerId: view.meetingId, whoseAction: view.confirmedBy, alreadyKnows: 'no', evidence: [view.meetingId],
          decision: 'speak', reason: '미팅 상태: 사람이 확인하거나 기다려야 하는 상태를 알린다', openTopics: project(events).openTopics } },
        { ...this.context, actor: { kind: 'pm', id: this.pmId }, type: 'pm_spoke', idempotencyKey: `${considerationId}:0`, at, payload: {
          considerationId, messageId: `${considerationId}:0`, text, kind: 'fact' } },
      ];
      return { append, result: undefined };
    });
  }
}
