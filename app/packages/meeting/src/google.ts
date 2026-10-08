// Google Meet REST v2 + Calendar v3 over fetch. The access token comes from an injected provider (OAuth is the
// host's job) and is never logged or put in an error. This path has NOT been run against Google: no test account
// or OAuth client was available (docs/feasibility/meeting-google-meet.md). Meet Media API is deliberately not used.
import type { Id } from '@ensemble/core';
import type { AdapterOutcome, AttendeeResponse, InviteRequest, MeetingAdapter, MeetingInvite, MeetingParticipant, MeetingSpace } from './types.ts';

export const GOOGLE_MEET_API = 'https://meet.googleapis.com/v2';
export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
/** Least scopes for flow B: create spaces this app owns, and write events on the configured calendar. */
export const GOOGLE_MEETING_SCOPES = [
  'https://www.googleapis.com/auth/meetings.space.created',
  'https://www.googleapis.com/auth/calendar.events',
] as const;

export interface GoogleMeetingAdapterOptions {
  /** Returns a current OAuth access token. Refresh and storage stay with the host. */
  accessToken: () => Promise<string>;
  fetch?: typeof fetch;
  /** Calendar that owns the event (the PM Agent's account). Default `primary`. */
  calendarId?: string;
  /** Meet space access type. `TRUSTED` lets the organisation and invited guests in without knocking. */
  accessType?: 'OPEN' | 'TRUSTED' | 'RESTRICTED';
  timeoutMs?: number;
}

type Failed = Extract<AdapterOutcome<never>, { status: 'failed' }>;
type Response<T> = { status: 'ok'; code: number; body: T } | Failed;

interface GoogleEvent {
  id?: string; status?: string; htmlLink?: string; location?: string;
  attendees?: { email?: string; responseStatus?: string }[];
  extendedProperties?: { private?: Record<string, string> };
}

const RESPONSES: readonly AttendeeResponse[] = ['needsAction', 'accepted', 'declined', 'tentative'];
const clip = (text: string) => text.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 200);

function failure(code: number, body: unknown, mutating: boolean): Failed {
  const error = (body as { error?: { status?: string; message?: string; errors?: { reason?: string }[] } } | undefined)?.error;
  const reason = error?.errors?.[0]?.reason;
  const message = clip(`${code} ${error?.status ?? ''} ${error?.message ?? ''}`.replace(/\s+/g, ' ').trim());
  if (code === 401) return { status: 'failed', code: 'unauthenticated', message, retryable: false };
  if (code === 403 && /rateLimit/i.test(reason ?? '')) return { status: 'failed', code: 'rate_limited', message, retryable: true };
  if (code === 403) return { status: 'failed', code: 'permission_denied', message, retryable: false };
  if (code === 404) return { status: 'failed', code: 'not_found', message, retryable: false };
  if (code === 409) return { status: 'failed', code: 'conflict', message, retryable: false };
  if (code === 429) return { status: 'failed', code: 'rate_limited', message, retryable: true };
  if (code >= 500) return { status: 'failed', code: 'provider_error', message, retryable: true, uncertain: mutating };
  return { status: 'failed', code: 'rejected', message, retryable: false };
}

export class GoogleMeetCalendarAdapter implements MeetingAdapter {
  readonly name = 'google-meet-calendar';
  readonly evidence = 'api_response' as const;
  private readonly fetchImpl: typeof fetch;
  private readonly calendarId: string;

  constructor(private readonly options: GoogleMeetingAdapterOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.calendarId = options.calendarId ?? 'primary';
  }

  private async call<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<Response<T>> {
    const mutating = method !== 'GET';
    let token: string;
    try { token = await this.options.accessToken(); }
    catch { return { status: 'failed', code: 'auth_unavailable', message: 'access token provider failed', retryable: false }; }
    let response: globalThis.Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 20_000),
      });
    } catch (error) {
      // The request may have been applied before the connection dropped.
      return { status: 'failed', code: 'network', message: clip(error instanceof Error ? error.name : 'fetch failed'), retryable: true, uncertain: mutating };
    }
    const parsed = await response.json().catch(() => undefined) as unknown;
    if (!response.ok) return failure(response.status, parsed, mutating);
    return { status: 'ok', code: response.status, body: parsed as T };
  }

  private eventUrl(eventId?: string, query = '') {
    return `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(this.calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ''}${query}`;
  }

  async createSpace(_input: { meetingId: Id; attempt: number }): Promise<AdapterOutcome<MeetingSpace>> {
    const result = await this.call<{ name?: string; meetingUri?: string; meetingCode?: string }>('POST', `${GOOGLE_MEET_API}/spaces`, { config: { accessType: this.options.accessType ?? 'TRUSTED' } });
    if (result.status !== 'ok') return result;
    const { name, meetingUri, meetingCode } = result.body ?? {};
    if (!name || !meetingUri) return { status: 'failed', code: 'bad_response', message: 'spaces.create returned no name/meetingUri', retryable: true, uncertain: true };
    return { status: 'ok', value: { name, meetingUri, ...(meetingCode ? { meetingCode } : {}) } };
  }

  async insertInvite(input: InviteRequest): Promise<AdapterOutcome<MeetingInvite>> {
    const body = {
      id: input.calendarEventId,
      summary: input.purpose,
      description: [
        input.purpose,
        ...(input.agenda.length ? ['', '논점', ...input.agenda.map(item => `- ${item}`)] : []),
        '', `Google Meet: ${input.space.meetingUri}`,
        '', 'Ensemble PM Agent가 프로젝트 Space의 위임 범위에서 만든 회의입니다. PM Agent가 참여할 수 있으며 회의의 결정·제안·미해결 사항이 Space에 기록될 수 있습니다.',
      ].join('\n'),
      location: input.space.meetingUri,
      start: { dateTime: input.start, ...(input.timeZone ? { timeZone: input.timeZone } : {}) },
      end: { dateTime: input.end, ...(input.timeZone ? { timeZone: input.timeZone } : {}) },
      attendees: input.attendees.map(attendee => ({ email: attendee.email })),
      guestsCanInviteOthers: false,
      extendedProperties: { private: { ensembleMeetingId: input.meetingId, ensembleProjectId: input.projectId } },
    };
    // sendUpdates=all asks Calendar to email the guests. Acceptance of this request is not proof of delivery.
    const inserted = await this.call<GoogleEvent>('POST', this.eventUrl(undefined, `?sendUpdates=${input.sendUpdates}`), body);
    if (inserted.status === 'ok') return { status: 'ok', value: { eventId: inserted.body.id ?? input.calendarEventId, ...(inserted.body.htmlLink ? { htmlLink: inserted.body.htmlLink } : {}), link: inserted.body.location ?? input.space.meetingUri } };
    if (inserted.code !== 'conflict') return inserted;
    // Same id already exists: a previous attempt got through. Read it back instead of inserting (no second email).
    const existing = await this.call<GoogleEvent>('GET', this.eventUrl(input.calendarEventId));
    if (existing.status !== 'ok') return existing;
    if (existing.body.extendedProperties?.private?.ensembleMeetingId !== input.meetingId) return { status: 'failed', code: 'id_conflict', message: 'calendar event id is held by another event', retryable: false };
    if (existing.body.status === 'cancelled') return { status: 'failed', code: 'cancelled', message: 'the event for this meeting was cancelled', retryable: false };
    return { status: 'ok', replayed: true, value: { eventId: input.calendarEventId, ...(existing.body.htmlLink ? { htmlLink: existing.body.htmlLink } : {}), ...(existing.body.location ? { link: existing.body.location } : {}) } };
  }

  async readResponses(calendarEventId: string): Promise<AdapterOutcome<{ email: string; response: AttendeeResponse }[]>> {
    const result = await this.call<GoogleEvent>('GET', this.eventUrl(calendarEventId));
    if (result.status !== 'ok') return result;
    return { status: 'ok', value: (result.body.attendees ?? []).flatMap(attendee => attendee.email && RESPONSES.includes(attendee.responseStatus as AttendeeResponse)
      ? [{ email: attendee.email, response: attendee.responseStatus as AttendeeResponse }] : []) };
  }

  async listParticipants(spaceName: string): Promise<AdapterOutcome<MeetingParticipant[]>> {
    const filter = encodeURIComponent(`space.name = "${spaceName}"`);
    const records = await this.call<{ conferenceRecords?: { name?: string }[] }>('GET', `${GOOGLE_MEET_API}/conferenceRecords?filter=${filter}`);
    if (records.status !== 'ok') return records;
    const participants: MeetingParticipant[] = [];
    for (const record of records.body.conferenceRecords ?? []) {
      if (!record.name) continue;
      const listed = await this.call<{ participants?: { name?: string; earliestStartTime?: string; latestEndTime?: string; signedinUser?: { displayName?: string }; anonymousUser?: { displayName?: string }; phoneUser?: { displayName?: string } }[] }>('GET', `${GOOGLE_MEET_API}/${record.name}/participants`);
      if (listed.status !== 'ok') return listed;
      for (const p of listed.body.participants ?? []) {
        if (!p.name) continue;
        const displayName = p.signedinUser?.displayName ?? p.anonymousUser?.displayName ?? p.phoneUser?.displayName;
        participants.push({ name: p.name, ...(displayName ? { displayName } : {}), ...(p.earliestStartTime ? { joinedAt: p.earliestStartTime } : {}), ...(p.latestEndTime ? { leftAt: p.latestEndTime } : {}) });
      }
    }
    return { status: 'ok', value: participants };
  }

  /** Harmless reads to check access: one Calendar event list page and one Meet conference record page. */
  async probe(): Promise<{ calendar: AdapterOutcome<{ items: number }>; meet: AdapterOutcome<{ items: number }> }> {
    const calendar = await this.call<{ items?: unknown[] }>('GET', this.eventUrl(undefined, '?maxResults=1'));
    const meet = await this.call<{ conferenceRecords?: unknown[] }>('GET', `${GOOGLE_MEET_API}/conferenceRecords?pageSize=1`);
    return {
      calendar: calendar.status === 'ok' ? { status: 'ok', value: { items: calendar.body?.items?.length ?? 0 } } : calendar,
      meet: meet.status === 'ok' ? { status: 'ok', value: { items: meet.body?.conferenceRecords?.length ?? 0 } } : meet,
    };
  }

  async sendInMeeting(): Promise<AdapterOutcome<{ ref: string }>> {
    return { status: 'unsupported', capability: 'chat_send', reason: 'Meet REST API에는 회의 중 채팅·음성 전송 경로가 없고 Meet Media API는 Developer Preview 신규 신청을 받지 않는다' };
  }
}
