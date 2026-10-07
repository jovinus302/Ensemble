// Figma participation records in the Space's own ledger (issue #78, EXPERIMENT).
// They live outside core `EventPayloads` on purpose: `project()` ignores unknown types, so the experiment adds
// no state to the core model until the path is proven. Every record keeps file key, node, comment id, version or
// observation time, and who acted. "Inspected" (PM read the file itself) and "claimed" (a commenter said so) are
// separate fields and are never merged.
import type { Id, LedgerEvent } from '@ensemble/core';
import type { FigmaErrorKind, FigmaUser } from './client.ts';

export type FigmaOrigin =
  /** A member (usually a personal Agent) shared a Figma link and a question into the Space. */
  | { kind: 'shared_link'; sharedBy: Id; onBehalfOf?: Id; sourceMessageId?: Id }
  /** The Space decided something and the PM carries it to the design file. */
  | { kind: 'space_decision'; decisionId: Id };
export type FigmaStage = 'me' | 'file' | 'comments';
export interface FigmaNodeObservation { id: string; found: boolean; name?: string; type?: string }
export type FollowUpVerification =
  /** Only the commenter's word. */
  | 'claimed'
  /** PM re-read the file: it changed after the request, content not judged. */
  | 'file_changed_unconfirmed'
  /** PM re-read the file: same version as when it asked. */
  | 'no_change_observed';

export interface FigmaEventPayloads {
  figma_request_opened: { requestId: Id; origin: FigmaOrigin; url: string; fileKey: string; nodeId?: string; question: string };
  /** What the PM actually read, and the Space context it read alongside. */
  figma_inspected: {
    inspectionId: Id; requestId: Id; fileKey: string; fileName: string; version: string; lastModified: string; observedAt: string;
    nodes: FigmaNodeObservation[];
    /** Comments already on the inspected frame (or the file, without a node). */
    relatedCommentIds: string[];
    pm: FigmaUser;
    space: { goal?: string; decisionIds: Id[] };
  };
  figma_access_failed: { requestId: Id; stage: FigmaStage; kind: FigmaErrorKind | 'unknown'; status?: number; detail: string; observedAt: string };
  figma_comment_attempted: { requestId: Id; attemptId: Id; inspectionId: Id; fileKey: string; nodeId?: string; message: string };
  /** Only a comment id returned (or found) on Figma counts as delivery. */
  figma_comment_posted: { requestId: Id; attemptId: Id; commentId: string; fileKey: string; nodeId?: string; author: FigmaUser; createdAt: string; reconciled: boolean };
  figma_comment_failed: { requestId: Id; attemptId: Id; kind: FigmaErrorKind | 'unknown'; status?: number; detail: string; ambiguous: boolean };
  figma_reply_received: {
    requestId: Id; commentId: string; parentId: string; fileKey: string; author: FigmaUser; message: string; createdAt: string; observedAt: string;
    /** The reply came from the PM's own Figma account without the PM tag: the person behind it is not identifiable. */
    sameAccountAsPm: boolean;
  };
  /** A reply becomes an open item in the Space for the next action. */
  figma_followup_linked: { followUpId: Id; requestId: Id; replyCommentId: string; text: string; author: FigmaUser; verification: 'claimed' };
  figma_followup_rechecked: { followUpId: Id; requestId: Id; inspectionId: Id; baselineVersion: string; observedVersion: string; observedAt: string; verification: Exclude<FollowUpVerification, 'claimed'> };
  /** A member (personal Agent) reports applying the item or being blocked. Still a claim. */
  figma_followup_reported: { followUpId: Id; by: Id; outcome: 'applied' | 'blocked'; note: string };
}
export type FigmaEventType = keyof FigmaEventPayloads;
export type FigmaEvent = { [K in FigmaEventType]: LedgerEvent<K, FigmaEventPayloads[K]> }[FigmaEventType];

export const isFigmaEvent = (event: LedgerEvent): event is FigmaEvent => event.type.startsWith('figma_');

export type FigmaRequestStatus =
  | 'opened'
  | 'access_failed'
  /** The file opened but the linked frame did not. */
  | 'frame_not_found'
  | 'inspected'
  /** An attempt has no recorded outcome yet. */
  | 'delivering'
  | 'delivery_failed'
  /** A write that may or may not exist on Figma; reconcile before posting again. */
  | 'delivery_unknown'
  | 'awaiting_reply'
  | 'reply_received';

export interface FigmaFollowUp {
  followUpId: Id; requestId: Id; replyCommentId: string; text: string; author: FigmaUser;
  verification: FollowUpVerification; recheck?: FigmaEventPayloads['figma_followup_rechecked'];
  reports: FigmaEventPayloads['figma_followup_reported'][];
}
export interface FigmaRequestView {
  requestId: Id; origin: FigmaOrigin; url: string; fileKey: string; nodeId?: string; question: string;
  status: FigmaRequestStatus;
  inspection?: FigmaEventPayloads['figma_inspected'];
  /** Most recent failure not yet followed by a success at the same stage. */
  problem?: FigmaEventPayloads['figma_access_failed'] | FigmaEventPayloads['figma_comment_failed'];
  /** The latest attempt whose outcome is not known: no result yet, or an ambiguous failure. */
  pendingAttempt?: FigmaEventPayloads['figma_comment_attempted'];
  delivery?: FigmaEventPayloads['figma_comment_posted'] & { inspectionId: Id; message: string };
  replies: FigmaEventPayloads['figma_reply_received'][];
  followUps: FigmaFollowUp[];
  /** Ledger seq of the opening record. */
  seq: number;
}

/** Replays the Figma records of one Space. Other event types are ignored. */
export function figmaRequests(events: readonly LedgerEvent[]): Map<Id, FigmaRequestView> {
  const requests = new Map<Id, FigmaRequestView>();
  const attempts = new Map<Id, FigmaEventPayloads['figma_comment_attempted']>();
  for (const original of events) {
    if (!isFigmaEvent(original)) continue;
    const event = structuredClone(original);
    if (event.type === 'figma_request_opened') {
      const p = event.payload;
      if (!requests.has(p.requestId)) requests.set(p.requestId, { ...p, status: 'opened', replies: [], followUps: [], seq: event.seq });
      continue;
    }
    if (event.type === 'figma_followup_reported') continue;
    const request = requests.get(event.payload.requestId);
    if (!request) continue;
    const delivered = !!request.delivery;
    switch (event.type) {
      case 'figma_inspected': {
        request.inspection = event.payload;
        if (request.problem && 'stage' in request.problem) delete request.problem;
        if (!delivered && !request.pendingAttempt && request.status !== 'delivery_unknown' && request.status !== 'delivery_failed') {
          request.status = event.payload.nodes.every(n => n.found) ? 'inspected' : 'frame_not_found';
        }
        break;
      }
      case 'figma_access_failed':
        request.problem = event.payload;
        if (!delivered && !request.pendingAttempt && request.status !== 'delivery_unknown') request.status = 'access_failed';
        break;
      case 'figma_comment_attempted':
        attempts.set(event.payload.attemptId, event.payload);
        request.pendingAttempt = event.payload;
        if (!delivered) request.status = 'delivering';
        break;
      case 'figma_comment_failed':
        // An ambiguous failure keeps the attempt pending: it may exist on Figma until reconciled.
        if (request.pendingAttempt?.attemptId === event.payload.attemptId && !event.payload.ambiguous) delete request.pendingAttempt;
        request.problem = event.payload;
        if (!delivered) request.status = event.payload.ambiguous ? 'delivery_unknown' : 'delivery_failed';
        break;
      case 'figma_comment_posted': {
        if (delivered) break;
        const attempt = attempts.get(event.payload.attemptId);
        delete request.pendingAttempt;
        delete request.problem;
        request.delivery = { ...event.payload, inspectionId: attempt?.inspectionId ?? '', message: attempt?.message ?? '' };
        request.status = 'awaiting_reply';
        break;
      }
      case 'figma_reply_received':
        if (request.replies.some(r => r.commentId === event.payload.commentId)) break;
        request.replies.push(event.payload);
        if (request.problem && 'stage' in request.problem && request.problem.stage === 'comments') delete request.problem;
        request.status = 'reply_received';
        break;
      case 'figma_followup_linked':
        if (request.followUps.some(f => f.followUpId === event.payload.followUpId)) break;
        request.followUps.push({ ...event.payload, reports: [] });
        break;
      case 'figma_followup_rechecked': {
        const followUp = request.followUps.find(f => f.followUpId === event.payload.followUpId);
        if (followUp) { followUp.recheck = event.payload; followUp.verification = event.payload.verification; }
        break;
      }
    }
  }
  // Reports carry only a followUpId; attach them after all follow-ups are known.
  for (const original of events) {
    if (original.type !== 'figma_followup_reported') continue;
    const payload = (original as LedgerEvent<'figma_followup_reported', FigmaEventPayloads['figma_followup_reported']>).payload;
    for (const request of requests.values()) request.followUps.find(f => f.followUpId === payload.followUpId)?.reports.push(structuredClone(payload));
  }
  return requests;
}

/** What a member reading the Space sees: open Figma follow-ups and requests that need a person. */
export interface FigmaSpaceItem {
  requestId: Id; fileKey: string; nodeId?: string; status: FigmaRequestStatus; question: string;
  problem?: string;
  followUps: { followUpId: Id; text: string; author: string; verification: FollowUpVerification; reports: number }[];
}
export function figmaSpaceItems(events: readonly LedgerEvent[]): FigmaSpaceItem[] {
  return [...figmaRequests(events).values()].sort((a, b) => a.seq - b.seq).map(r => ({
    requestId: r.requestId, fileKey: r.fileKey, ...(r.nodeId ? { nodeId: r.nodeId } : {}), status: r.status, question: r.question,
    ...(r.problem ? { problem: r.problem.detail } : {}),
    followUps: r.followUps.map(f => ({ followUpId: f.followUpId, text: f.text, author: f.author.handle, verification: f.verification, reports: f.reports.length })),
  }));
}
