// Meeting feasibility (#80): ledger payloads and the adapter contract. Nothing here claims that an invite
// reached a person or that the PM Agent heard or spoke in a meeting; those are separate observations with
// their own evidence. The event types live in this package (not core's EventPayloads) until #81 settles the
// shared Space participation path; the store accepts them as ordinary ledger events and core ignores them.
import type { Id } from '@ensemble/core';

/** `arranged`: the PM Agent created the room (flow B). `invited`: a person brought the PM Agent into an existing meeting (flow A). */
export type MeetingOrigin = 'arranged' | 'invited';

export interface MeetingAttendee { memberId: Id; email: string }

/** What can be done in or around a meeting. Used to record what a path does not support. */
export type MeetingCapability = 'join' | 'chat_read' | 'chat_send' | 'voice_listen' | 'voice_speak' | 'participants_read';

/** Where an observation came from. `transcript` is a post-meeting artifact and never counts as in-meeting evidence. */
export type MeetingChannel = 'meet_rest' | 'calendar_api' | 'in_meeting_chat' | 'in_meeting_voice' | 'transcript' | 'human_report';

/**
 * How the fact was learned. `api_response`: the provider accepted a request (an accepted invite request is not
 * a delivered invite). `api_poll`: read back from the provider later. `human_report`: a person said so.
 * `bot_observation`: an automated participant observed it. `fake`: test double.
 */
export type MeetingEvidence = 'api_response' | 'api_poll' | 'human_report' | 'bot_observation' | 'fake';

/** 원본 참조: which meeting, which provider resource, which observation channel. */
export interface MeetingSourceRef {
  meetingId: Id;
  channel: MeetingChannel;
  spaceName?: string;
  calendarEventId?: string;
  link?: string;
  /** Provider- or reporter-side id of the utterance/record the item came from. */
  ref?: string;
  quote?: string;
}

export type ObservationKind =
  // Arrangement (flow B)
  | 'space_reserved' | 'space_created' | 'invite_sent'
  // Attendee replies read back from the calendar
  | 'invite_accepted' | 'invite_declined' | 'invite_tentative' | 'no_response'
  // Participation (flow A and B)
  | 'joined' | 'join_refused' | 'disconnected' | 'unsupported'
  // In-meeting exchange
  | 'context_received' | 'question_sent' | 'answer_received'
  | 'failed';

export type MeetingStep = 'space' | 'invite' | 'responses' | 'participants' | 'chat_send';

export interface MeetingFailure { step: MeetingStep; code: string; message: string; retryable: boolean; uncertain?: boolean }

export interface MeetingRequestedPayload {
  meetingId: Id;
  coordinationKey: string;
  origin: MeetingOrigin;
  purpose: string;
  agenda: string[];
  attendees: MeetingAttendee[];
  start?: string;
  end?: string;
  timeZone?: string;
  /** The human who confirmed attendees and schedule (B) or who invited the PM Agent (A). */
  confirmedBy: Id;
  /** Deterministic Calendar event id for `arranged`; retries reuse it, so the provider rejects a second insert. */
  calendarEventId?: string;
  /** Existing meeting link for `invited`. */
  link?: string;
  /** Calendar `sendUpdates`: `all` emails the attendees, `none` creates the event silently. Absent on older records means `all`. */
  sendUpdates?: 'all' | 'none';
  requestDigest: string;
}

export interface MeetingObservedPayload {
  observationId: Id;
  meetingId: Id;
  kind: ObservationKind;
  source: MeetingSourceRef;
  evidence: MeetingEvidence;
  observedAt: string;
  /** Member id, `pm` for the PM Agent, or absent when it concerns the meeting itself. */
  subjectId?: Id;
  /** Provider-side display name when no member mapping is known. */
  subjectName?: string;
  attempt?: number;
  capability?: MeetingCapability;
  /** Question this answer or silence belongs to. */
  questionId?: Id;
  text?: string;
  space?: { name: string; meetingUri: string; meetingCode?: string };
  event?: { id: string; htmlLink?: string; replayed: boolean; link?: string };
  failure?: MeetingFailure;
  detail?: string;
}

export type MeetingNoteKind = 'decision' | 'proposal' | 'open';

/** 결정/제안/미해결 with 작성 주체, 원본 참조, 관찰 시각. */
export interface MeetingNoteRecordedPayload {
  noteId: Id;
  meetingId: Id;
  kind: MeetingNoteKind;
  text: string;
  reason?: string;
  /** 담당: who acts on it next. */
  ownerId?: Id;
  author: { kind: 'human' | 'pm' | 'agent'; id: Id };
  source: MeetingSourceRef;
  observedAt: string;
}

export interface MeetingEventPayloads {
  meeting_requested: MeetingRequestedPayload;
  meeting_observed: MeetingObservedPayload;
  meeting_note_recorded: MeetingNoteRecordedPayload;
}
export type MeetingEventType = keyof MeetingEventPayloads;

// ---- Adapter contract -------------------------------------------------------------------------------------

export interface MeetingSpace { name: string; meetingUri: string; meetingCode?: string }
/** `link`: the meeting link the event actually carries (on a replay it can differ from a space made by a later attempt). */
export interface MeetingInvite { eventId: string; htmlLink?: string; link?: string }
export type AttendeeResponse = 'needsAction' | 'accepted' | 'declined' | 'tentative';
export interface MeetingParticipant { name: string; displayName?: string; joinedAt?: string; leftAt?: string }

/** `uncertain`: the request may have reached the provider (e.g. timeout), so the result is unknown, not absent. */
export type AdapterOutcome<T> =
  | { status: 'ok'; value: T; replayed?: boolean }
  | { status: 'failed'; code: string; message: string; retryable: boolean; uncertain?: boolean }
  | { status: 'unsupported'; capability: MeetingCapability; reason: string };

export interface InviteRequest {
  meetingId: Id;
  projectId: Id;
  calendarEventId: string;
  purpose: string;
  agenda: string[];
  attendees: MeetingAttendee[];
  start: string;
  end: string;
  timeZone?: string;
  space: MeetingSpace;
  /** `all` asks Calendar to email the attendees; `none` sends nothing. */
  sendUpdates: 'all' | 'none';
}

export interface MeetingAdapter {
  readonly name: string;
  readonly evidence: MeetingEvidence;
  /** Meet REST `spaces.create`. The API has no request id, so callers must guard retries. */
  createSpace(input: { meetingId: Id; attempt: number }): Promise<AdapterOutcome<MeetingSpace>>;
  /** Calendar `events.insert` with a caller-chosen id; an existing event with the same id is returned as `replayed`. */
  insertInvite(input: InviteRequest): Promise<AdapterOutcome<MeetingInvite>>;
  readResponses(calendarEventId: string): Promise<AdapterOutcome<{ email: string; response: AttendeeResponse }[]>>;
  listParticipants(spaceName: string): Promise<AdapterOutcome<MeetingParticipant[]>>;
  /** In-meeting message from the PM Agent. */
  sendInMeeting(input: { meetingId: Id; spaceName?: string; text: string }): Promise<AdapterOutcome<{ ref: string }>>;
}

export class MeetingRequestError extends Error {
  constructor(readonly code: 'conflict' | 'forbidden' | 'invalid' | 'not_found', message: string) { super(message); this.name = 'MeetingRequestError'; }
}
