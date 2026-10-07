// Read model for meetings in one Space. It deliberately has no "done"/"success" state: a link, an accepted
// invite request or a transcript is reported as exactly that, and failures/waits stay visible next to it.
import type { Id, LedgerEvent } from '@ensemble/core';
import type {
  MeetingAttendee, MeetingCapability, MeetingEventPayloads, MeetingEventType, MeetingFailure, MeetingNoteRecordedPayload,
  MeetingObservedPayload, MeetingOrigin, MeetingRequestedPayload,
} from './types.ts';

export type MeetingLedgerEvent = { [K in MeetingEventType]: LedgerEvent<K, MeetingEventPayloads[K]> }[MeetingEventType];
const TYPES = new Set<string>(['meeting_requested', 'meeting_observed', 'meeting_note_recorded']);
export const meetingEvents = (events: readonly LedgerEvent[]): MeetingLedgerEvent[] => events.filter(e => TYPES.has(e.type)) as MeetingLedgerEvent[];

export type MeetingState = 'failed' | 'join_refused' | 'disconnected' | 'no_response' | 'unsupported' | 'pending' | 'invite_sent' | 'created' | 'joined';
const ORDER: readonly MeetingState[] = ['failed', 'join_refused', 'disconnected', 'no_response', 'unsupported', 'pending', 'invite_sent', 'created', 'joined'];

export const STATE_LABELS: Record<MeetingState, string> = {
  failed: '실패',
  join_refused: '입장 거절',
  disconnected: '연결 끊김',
  no_response: '응답 없음',
  unsupported: '지원하지 않는 방식',
  pending: '진행 중 · 결과 미확인',
  invite_sent: '초대 요청 접수 · 수신 미확인',
  created: '방 생성 · 초대 전',
  joined: 'PM Agent 입장 관찰',
};

export type InviteState = 'not_sent' | 'sent_unconfirmed' | 'accepted' | 'tentative' | 'declined' | 'no_response';
export type PmParticipation = 'not_joined' | 'joined' | 'join_refused' | 'disconnected';

export interface MeetingView {
  meetingId: Id;
  origin: MeetingOrigin;
  purpose: string;
  agenda: string[];
  confirmedBy: Id;
  start?: string;
  link?: string;
  spaceName?: string;
  calendarEventId?: string;
  /** `none`: the Calendar event was created without emailing anyone (dry run). */
  sendUpdates: 'all' | 'none';
  /** Every state that applies, most urgent first. */
  states: MeetingState[];
  attendees: (MeetingAttendee & { invite: InviteState; joined: boolean })[];
  pm: PmParticipation;
  /** Participants seen by the provider, without a member mapping unless one was reported. */
  participants: { subjectId?: Id; name?: string; evidence: MeetingObservedPayload['evidence'] }[];
  unsupported: MeetingCapability[];
  /** Questions sent in the meeting and not yet answered. */
  openQuestions: Id[];
  /** Latest unresolved failure of creating, inviting or sending in the meeting. */
  failure?: MeetingFailure;
  /** Latest failed read-back (replies, participants). Not a meeting failure, but nothing new was observed. */
  pollFailure?: MeetingFailure;
  /** In-flight space attempt whose result is not recorded yet. */
  inFlight?: { attempt: number; since: string };
  notes: MeetingNoteRecordedPayload[];
  /** Context or answers came from inside the meeting (chat/voice), not only a transcript. */
  inMeetingEvidence: boolean;
  /** Notes exist but all come from a post-meeting transcript: transcript processing only, not participation. */
  transcriptOnly: boolean;
  /** The invite carries a different Meet link than the recorded space (participants of that link cannot be looked up by space name). */
  spaceMismatch: boolean;
  /** Any fact came from a test double. */
  fake: boolean;
}

const IN_MEETING = new Set(['in_meeting_chat', 'in_meeting_voice']);
const RSVP: Partial<Record<MeetingObservedPayload['kind'], InviteState>> = { invite_accepted: 'accepted', invite_declined: 'declined', invite_tentative: 'tentative' };

function fold(request: MeetingRequestedPayload, observed: MeetingObservedPayload[], notes: MeetingNoteRecordedPayload[]): MeetingView {
  const attendees = request.attendees.map(attendee => ({ ...attendee, invite: 'not_sent' as InviteState, joined: false }));
  const byMember = new Map(attendees.map(attendee => [attendee.memberId, attendee]));
  let space: MeetingObservedPayload['space'];
  let eventId: string | undefined;
  let invitedLink: string | undefined;
  let inviteSent = false;
  let lastStepFailure: MeetingFailure | undefined;
  let chatFailure: MeetingFailure | undefined;
  let pollFailure: MeetingFailure | undefined;
  let reserved: { attempt: number; since: string } | undefined;
  let pm: PmParticipation = 'not_joined';
  const participants: MeetingView['participants'] = [];
  const unsupported = new Set<MeetingCapability>();
  const questions = new Map<Id, 'open' | 'answered' | 'silent'>();
  let inMeeting = false;
  let fake = false;
  for (const o of observed) {
    if (o.evidence === 'fake') fake = true;
    switch (o.kind) {
      case 'space_reserved': reserved = { attempt: o.attempt ?? 1, since: o.observedAt }; lastStepFailure = undefined; break;
      case 'space_created': space = o.space; reserved = undefined; lastStepFailure = undefined; break;
      case 'invite_sent':
        inviteSent = true; eventId = o.event?.id ?? eventId; invitedLink = o.event?.link ?? invitedLink; lastStepFailure = undefined;
        // A silent event (sendUpdates=none) notified nobody.
        if (request.sendUpdates !== 'none') for (const attendee of attendees) if (attendee.invite === 'not_sent') attendee.invite = 'sent_unconfirmed';
        break;
      case 'invite_accepted': case 'invite_declined': case 'invite_tentative': {
        const attendee = o.subjectId ? byMember.get(o.subjectId) : undefined;
        if (attendee) attendee.invite = RSVP[o.kind]!;
        break;
      }
      case 'no_response': {
        const attendee = o.subjectId ? byMember.get(o.subjectId) : undefined;
        if (o.questionId) { if (questions.get(o.questionId) === 'open') questions.set(o.questionId, 'silent'); }
        else if (attendee && (attendee.invite === 'sent_unconfirmed' || attendee.invite === 'not_sent')) attendee.invite = 'no_response';
        break;
      }
      case 'joined':
        if (o.subjectId === 'pm') pm = 'joined';
        else {
          const attendee = o.subjectId ? byMember.get(o.subjectId) : undefined;
          if (attendee) attendee.joined = true;
          participants.push({ ...(o.subjectId ? { subjectId: o.subjectId } : {}), ...(o.subjectName ? { name: o.subjectName } : {}), evidence: o.evidence });
        }
        break;
      case 'join_refused': if (o.subjectId === 'pm' || o.subjectId === undefined) pm = 'join_refused'; break;
      case 'disconnected': if (o.subjectId === 'pm' || o.subjectId === undefined) pm = 'disconnected'; break;
      case 'unsupported': if (o.capability) unsupported.add(o.capability); break;
      case 'context_received': if (IN_MEETING.has(o.source.channel)) inMeeting = true; break;
      case 'question_sent': chatFailure = undefined; if (o.questionId) questions.set(o.questionId, 'open'); break;
      case 'answer_received':
        if (IN_MEETING.has(o.source.channel)) inMeeting = true;
        if (o.questionId) questions.set(o.questionId, 'answered');
        break;
      case 'failed':
        if (!o.failure) break;
        if (o.failure.step === 'space' || o.failure.step === 'invite') { lastStepFailure = o.failure; if (o.failure.step === 'space') reserved = undefined; }
        else if (o.failure.step === 'chat_send') chatFailure = o.failure;
        else pollFailure = o.failure;
        break;
    }
  }
  const states = new Set<MeetingState>();
  if (request.origin === 'arranged') {
    if (lastStepFailure) states.add('failed');
    else if (inviteSent) states.add(request.sendUpdates === 'none' ? 'created' : 'invite_sent');
    else if (space) { states.add('created'); states.add('pending'); }
    else states.add('pending');
  } else if (pm === 'not_joined') states.add('pending');
  if (chatFailure) states.add('failed');
  if (pm !== 'not_joined') states.add(pm);
  if (unsupported.size) states.add('unsupported');
  const silent = [...questions.values()].includes('silent');
  if (silent || attendees.some(attendee => attendee.invite === 'no_response')) states.add('no_response');
  // The event's own link wins: a space recorded by a later attempt may not be the one people were invited to.
  const link = invitedLink ?? space?.meetingUri ?? request.link;
  const spaceMismatch = invitedLink !== undefined && space !== undefined && invitedLink !== space.meetingUri;
  const spaceName = spaceMismatch ? undefined : space?.name;
  const calendarEventId = eventId ?? (inviteSent ? request.calendarEventId : undefined);
  return {
    meetingId: request.meetingId, origin: request.origin, purpose: request.purpose, agenda: request.agenda, confirmedBy: request.confirmedBy,
    ...(request.start ? { start: request.start } : {}),
    ...(link ? { link } : {}), ...(spaceName ? { spaceName } : {}), ...(calendarEventId ? { calendarEventId } : {}), sendUpdates: request.sendUpdates ?? 'all',
    states: ORDER.filter(state => states.has(state)),
    attendees, pm, participants, unsupported: [...unsupported],
    openQuestions: [...questions].flatMap(([id, state]) => state === 'open' ? [id] : []),
    ...(lastStepFailure ?? chatFailure ? { failure: (lastStepFailure ?? chatFailure)! } : {}),
    ...(pollFailure ? { pollFailure } : {}),
    ...(reserved && !space ? { inFlight: reserved } : {}),
    notes,
    inMeetingEvidence: inMeeting,
    spaceMismatch,
    transcriptOnly: notes.length > 0 && !inMeeting && notes.every(note => note.source.channel === 'transcript'),
    fake,
  };
}

/** All meetings in this Space's ledger, in request order. */
export function meetingViews(events: readonly LedgerEvent[]): MeetingView[] {
  const typed = meetingEvents(events);
  const requests = typed.flatMap(e => e.type === 'meeting_requested' ? [e.payload] : []);
  return requests.map(request => fold(
    request,
    typed.flatMap(e => e.type === 'meeting_observed' && e.payload.meetingId === request.meetingId ? [e.payload] : []),
    typed.flatMap(e => e.type === 'meeting_note_recorded' && e.payload.meetingId === request.meetingId ? [e.payload] : []),
  ));
}

export const meetingView = (events: readonly LedgerEvent[], meetingId: Id) => meetingViews(events).find(view => view.meetingId === meetingId);

/** One Korean line for the Space conversation. Names the state as observed, never as completed. */
export function meetingStatusLine(view: MeetingView): string {
  const states = view.states.map(state => STATE_LABELS[state]).join(', ');
  const replies = view.attendees.filter(a => a.invite === 'declined' || a.invite === 'no_response').map(a => `${a.memberId}(${a.invite === 'declined' ? '거절' : '응답 없음'})`);
  return [
    `"${view.purpose}" 미팅: ${states}`,
    ...(view.sendUpdates === 'none' && view.calendarEventId ? ['초대 메일 없이 일정만 생성'] : []),
    ...(view.failure ? [`사유 ${view.failure.code}${view.failure.uncertain ? ' · 요청 반영 여부 불확실' : ''}`] : []),
    ...(replies.length ? [`초대 ${replies.join(', ')}`] : []),
    ...(view.unsupported.length ? [`미지원 ${view.unsupported.join(', ')}`] : []),
    ...(view.transcriptOnly ? ['회의록 처리만 확인됨'] : []),
    ...(view.fake ? ['테스트 기록'] : []),
  ].join(' · ');
}
