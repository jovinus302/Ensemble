// Test double that mimics the provider behaviours the coordinator relies on: spaces.create has no request id
// (every call makes a new space), events.insert rejects an existing id, and invite emails go out only on a new
// insert. Its observations carry `fake` evidence and must never be shown as a real meeting.
import type { Id } from '@ensemble/core';
import type { AdapterOutcome, AttendeeResponse, InviteRequest, MeetingAdapter, MeetingCapability, MeetingInvite, MeetingParticipant, MeetingSpace } from './types.ts';

type Failure = Extract<AdapterOutcome<never>, { status: 'failed' }>;
type Step = 'createSpace' | 'insertInvite' | 'readResponses' | 'listParticipants' | 'sendInMeeting';

export class FakeMeetingAdapter implements MeetingAdapter {
  readonly name = 'fake';
  readonly evidence = 'fake' as const;
  readonly spaces: MeetingSpace[] = [];
  readonly events = new Map<string, InviteRequest & { cancelled?: boolean }>();
  /** One entry per invite email the provider would send. */
  readonly invitesDelivered: { eventId: string; email: string }[] = [];
  readonly sent: { meetingId: Id; text: string }[] = [];
  readonly calls: Record<Step, number> = { createSpace: 0, insertInvite: 0, readResponses: 0, listParticipants: 0, sendInMeeting: 0 };
  responses = new Map<string, AttendeeResponse>();
  participants: MeetingParticipant[] = [];
  /** Capabilities this fake pretends not to have (the Google path lacks `chat_send`). */
  unsupported = new Set<MeetingCapability>();
  private readonly failures: { step: Step; failure: Failure; afterApply: boolean }[] = [];
  private gate?: Promise<void>;

  /**
   * Fail the next call of `step`. With `afterApply` the provider applies the request first and the reply is
   * lost (a timeout after success).
   */
  failNext(step: Step, failure: Omit<Failure, 'status'>, afterApply = false) { this.failures.push({ step, failure: { status: 'failed', ...failure }, afterApply }); }
  /** Hold every call until the returned release function runs (to overlap concurrent callers). */
  hold(): () => void { let release!: () => void; this.gate = new Promise(resolve => { release = resolve; }); return () => { this.gate = undefined; release(); }; }

  private async enter(step: Step) {
    this.calls[step] += 1;
    if (this.gate) await this.gate;
    const index = this.failures.findIndex(item => item.step === step);
    return index < 0 ? undefined : this.failures.splice(index, 1)[0];
  }

  async createSpace(input: { meetingId: Id; attempt: number }): Promise<AdapterOutcome<MeetingSpace>> {
    const failure = await this.enter('createSpace');
    if (failure && !failure.afterApply) return failure.failure;
    const code = `fak-${String(this.spaces.length + 1).padStart(4, '0')}-${input.attempt}`;
    const space = { name: `spaces/${code}`, meetingUri: `https://meet.example.test/${code}`, meetingCode: code };
    this.spaces.push(space);
    return failure ? failure.failure : { status: 'ok', value: space };
  }

  async insertInvite(input: InviteRequest): Promise<AdapterOutcome<MeetingInvite>> {
    const failure = await this.enter('insertInvite');
    if (failure && !failure.afterApply) return failure.failure;
    const existing = this.events.get(input.calendarEventId);
    if (existing) {
      if (existing.meetingId !== input.meetingId) return { status: 'failed', code: 'id_conflict', message: 'id held by another event', retryable: false };
      return failure ? failure.failure : { status: 'ok', replayed: true, value: { eventId: input.calendarEventId, link: existing.space.meetingUri } };
    }
    this.events.set(input.calendarEventId, input);
    if (input.sendUpdates === 'all') for (const attendee of input.attendees) this.invitesDelivered.push({ eventId: input.calendarEventId, email: attendee.email });
    return failure ? failure.failure : { status: 'ok', value: { eventId: input.calendarEventId, htmlLink: `https://calendar.example.test/${input.calendarEventId}`, link: input.space.meetingUri } };
  }

  async readResponses(calendarEventId: string): Promise<AdapterOutcome<{ email: string; response: AttendeeResponse }[]>> {
    const failure = await this.enter('readResponses');
    if (failure) return failure.failure;
    const event = this.events.get(calendarEventId);
    if (!event) return { status: 'failed', code: 'not_found', message: 'no such event', retryable: false };
    return { status: 'ok', value: event.attendees.map(attendee => ({ email: attendee.email, response: this.responses.get(attendee.email) ?? 'needsAction' })) };
  }

  async listParticipants(_spaceName: string): Promise<AdapterOutcome<MeetingParticipant[]>> {
    const failure = await this.enter('listParticipants');
    if (failure) return failure.failure;
    if (this.unsupported.has('participants_read')) return { status: 'unsupported', capability: 'participants_read', reason: 'fake: disabled' };
    return { status: 'ok', value: [...this.participants] };
  }

  async sendInMeeting(input: { meetingId: Id; spaceName?: string; text: string }): Promise<AdapterOutcome<{ ref: string }>> {
    const failure = await this.enter('sendInMeeting');
    if (failure) return failure.failure;
    if (this.unsupported.has('chat_send')) return { status: 'unsupported', capability: 'chat_send', reason: 'fake: in-meeting chat disabled' };
    this.sent.push({ meetingId: input.meetingId, text: input.text });
    return { status: 'ok', value: { ref: `fake-chat-${this.sent.length}` } };
  }
}
