// Deterministic ids: the same Space and coordination key always name the same meeting, Calendar event and
// ledger idempotency keys, so a retry finds the first attempt instead of creating a second meeting.
import { createHash } from 'node:crypto';
import type { Id } from '@ensemble/core';

const digest = (...parts: string[]) => createHash('sha256').update(parts.join('\u0000')).digest('hex');

export const meetingIdFor = (projectId: Id, coordinationKey: string): Id => `meeting-${digest('meeting', projectId, coordinationKey).slice(0, 20)}`;

/**
 * Calendar event ids allow base32hex characters (a-v, 0-9), length 5-1024. Hex digits are a subset, and the
 * `ens` prefix is too. A deleted event's id stays taken, so a retry can never silently create a second event.
 */
export const calendarEventIdFor = (projectId: Id, coordinationKey: string): string => `ens${digest('calendar-event', projectId, coordinationKey).slice(0, 40)}`;

export const requestDigestOf = (value: unknown): string => digest(JSON.stringify(value)).slice(0, 32);

const normalize = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

/** Same meeting, kind, wording and source record → the same note. */
export const noteIdFor = (meetingId: Id, kind: string, text: string, sourceRef: string): Id => `meeting-note-${digest(meetingId, kind, normalize(text), sourceRef).slice(0, 24)}`;

export const key = (meetingId: Id, ...parts: (string | number)[]) => ['meeting', meetingId, ...parts].join(':');
