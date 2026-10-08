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
  /** `author` is the Figma account as recorded; it is usually the same account the PM acts through. */
  figma_reply_received: { requestId: Id; commentId: string; parentId: string; fileKey: string; author: FigmaUser; message: string; createdAt: string; observedAt: string };
  /** A reply becomes an open item in the Space for the next action. */
  figma_followup_linked: { followUpId: Id; requestId: Id; replyCommentId: string; text: string; author: FigmaUser; verification: 'claimed' };
  figma_followup_rechecked: { followUpId: Id; requestId: Id; inspectionId: Id; baselineVersion: string; observedVersion: string; observedAt: string; verification: Exclude<FollowUpVerification, 'claimed'> };
  /** A member (personal Agent) reports applying the item or being blocked. Still a claim. */
  figma_followup_reported: { followUpId: Id; by: Id; outcome: 'applied' | 'blocked'; note: string };
  /**
   * A human comment (top-level or a reply anywhere in the file) that calls the PM by text (`@ensemble`, `@pm_agent`).
   * `rootId` is where the answer goes: the comment itself when top-level, else its thread root (`parentId`).
   * `author` is recorded as-is; it is usually the account the PM acts through.
   */
  figma_mention_received: {
    mentionId: Id; fileKey: string; commentId: string; rootId: string; parentId?: string; nodeId?: string;
    author: FigmaUser; message: string; query: string; triggers: MentionTrigger[]; createdAt: string; observedAt: string;
  };
  /** The drafted answer. `citedItemIds` are the Space goal/decision/open item ids the answer quotes. */
  figma_mention_answer_attempted: { mentionId: Id; attemptId: Id; fileKey: string; replyTo: string; message: string; selection: MentionSelection; citedItemIds: string[] };
  /** Only a comment id returned (or found by tag) on Figma counts as answered. */
  figma_mention_answer_posted: { mentionId: Id; attemptId: Id; fileKey: string; commentId: string; replyTo: string; author: FigmaUser; createdAt: string; reconciled: boolean };
  figma_mention_answer_failed: { mentionId: Id; attemptId: Id; kind: FigmaErrorKind | 'unknown'; status?: number; detail: string; ambiguous: boolean };
  /**
   * A member (e.g. a designer Agent) reports a canvas change back into the Space. A claim only. `baseline` is the
   * file version the PM last inspected before the report (the request's delivery inspection when a request is linked).
   */
  figma_change_reported: {
    reportId: Id; by: Id; summary: string; url?: string; fileKey: string; nodeId?: string; requestId?: Id; mentionId?: Id;
    baseline?: { inspectionId: Id; version: string; lastModified: string; observedAt: string };
    verification: 'claimed';
  };
  /** The PM re-read the file after a change report: changed or not, content not judged. */
  figma_change_rechecked: {
    reportId: Id; fileKey: string; observedVersion: string; observedLastModified: string; observedAt: string; baselineVersion?: string;
    verification: Exclude<FollowUpVerification, 'claimed'> | 'no_baseline';
  };
}
export type FigmaEventType = keyof FigmaEventPayloads;
export type FigmaEvent = { [K in FigmaEventType]: LedgerEvent<K, FigmaEventPayloads[K]> }[FigmaEventType];
export type MentionTrigger = 'ensemble' | 'pm_agent';
/** keyword: items overlapping the query; fallback: no overlap, current items listed; caller: body written by the caller (model). */
export type MentionSelection = 'keyword' | 'fallback' | 'caller';
type MentionEventType = 'figma_mention_received' | 'figma_mention_answer_attempted' | 'figma_mention_answer_posted' | 'figma_mention_answer_failed';
export type FigmaMentionEvent = Extract<FigmaEvent, { type: MentionEventType }>;
export type FigmaChangeEvent = Extract<FigmaEvent, { type: 'figma_change_reported' | 'figma_change_rechecked' }>;

export const isFigmaEvent = (event: LedgerEvent): event is FigmaEvent => event.type.startsWith('figma_');
export const isFigmaMentionEvent = (event: LedgerEvent): event is FigmaMentionEvent => event.type.startsWith('figma_mention_');
export const isFigmaChangeEvent = (event: LedgerEvent): event is FigmaChangeEvent => event.type.startsWith('figma_change_');

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
    if (!isFigmaEvent(original) || isFigmaMentionEvent(original) || isFigmaChangeEvent(original)) continue;
    const event = structuredClone(original) as Exclude<FigmaEvent, FigmaMentionEvent | FigmaChangeEvent>;
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

export type FigmaMentionStatus =
  | 'received'
  /** An answer attempt has no recorded outcome yet. */
  | 'answering'
  | 'answer_failed'
  /** An answer that may or may not exist on Figma; reconcile by tag before posting again. */
  | 'answer_unknown'
  | 'answered';
export type FigmaMentionView = FigmaEventPayloads['figma_mention_received'] & {
  status: FigmaMentionStatus;
  pendingAttempt?: FigmaEventPayloads['figma_mention_answer_attempted'];
  /** Latest attempt whose outcome was ambiguous. Kept until answered: it may still land on Figma, so every later attempt reconciles first. */
  unconfirmedAttemptId?: Id;
  problem?: FigmaEventPayloads['figma_mention_answer_failed'];
  answer?: FigmaEventPayloads['figma_mention_answer_posted'] & Pick<FigmaEventPayloads['figma_mention_answer_attempted'], 'message' | 'selection' | 'citedItemIds'>;
  seq: number;
};

/** Replays the text-trigger context queries (`@ensemble`/`@pm_agent` comments) of one Space. */
export function figmaMentions(events: readonly LedgerEvent[]): Map<Id, FigmaMentionView> {
  const mentions = new Map<Id, FigmaMentionView>();
  const attempts = new Map<Id, FigmaEventPayloads['figma_mention_answer_attempted']>();
  for (const original of events) {
    if (!isFigmaMentionEvent(original)) continue;
    const event = structuredClone(original);
    if (event.type === 'figma_mention_received') {
      if (!mentions.has(event.payload.mentionId)) mentions.set(event.payload.mentionId, { ...event.payload, status: 'received', seq: event.seq });
      continue;
    }
    const mention = mentions.get(event.payload.mentionId);
    if (!mention || mention.answer) continue;
    switch (event.type) {
      case 'figma_mention_answer_attempted':
        attempts.set(event.payload.attemptId, event.payload);
        mention.pendingAttempt = event.payload;
        mention.status = 'answering';
        break;
      case 'figma_mention_answer_failed':
        if (mention.pendingAttempt?.attemptId === event.payload.attemptId && !event.payload.ambiguous) delete mention.pendingAttempt;
        if (event.payload.ambiguous) mention.unconfirmedAttemptId = event.payload.attemptId;
        mention.problem = event.payload;
        mention.status = event.payload.ambiguous ? 'answer_unknown' : 'answer_failed';
        break;
      case 'figma_mention_answer_posted': {
        const attempt = attempts.get(event.payload.attemptId);
        delete mention.pendingAttempt;
        delete mention.unconfirmedAttemptId;
        delete mention.problem;
        mention.answer = { ...event.payload, message: attempt?.message ?? '', selection: attempt?.selection ?? 'fallback', citedItemIds: attempt?.citedItemIds ?? [] };
        mention.status = 'answered';
        break;
      }
    }
  }
  return mentions;
}

/**
 * Comment ids the PM posted, as recorded in the ledger: request comments and mention answers. This is the only
 * authorship test for comments (same-account premise: never the Figma user id).
 */
export function pmCommentIds(events: readonly LedgerEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.type === 'figma_comment_posted') ids.add((event.payload as FigmaEventPayloads['figma_comment_posted']).commentId);
    else if (event.type === 'figma_mention_answer_posted') ids.add((event.payload as FigmaEventPayloads['figma_mention_answer_posted']).commentId);
  }
  return ids;
}

/** What a member reading the Space sees for each `@ensemble` query: who asked what, and whether the PM answered. */
export interface FigmaMentionItem {
  mentionId: Id; fileKey: string; commentId: string; rootId: string; nodeId?: string; author: string; query: string;
  status: FigmaMentionStatus; answerCommentId?: string; citedItemIds: string[]; problem?: string;
}
export function figmaMentionItems(events: readonly LedgerEvent[]): FigmaMentionItem[] {
  return [...figmaMentions(events).values()].sort((a, b) => a.seq - b.seq).map(m => ({
    mentionId: m.mentionId, fileKey: m.fileKey, commentId: m.commentId, rootId: m.rootId, ...(m.nodeId ? { nodeId: m.nodeId } : {}),
    author: m.author.handle, query: m.query, status: m.status,
    ...(m.answer ? { answerCommentId: m.answer.commentId } : {}),
    citedItemIds: m.answer?.citedItemIds ?? m.pendingAttempt?.citedItemIds ?? [],
    ...(m.problem ? { problem: m.problem.detail } : {}),
  }));
}

export type FigmaChangeReport = FigmaEventPayloads['figma_change_reported'] & {
  /** Latest PM re-read; absent until rechecked. The report itself stays `claimed`. */
  recheck?: FigmaEventPayloads['figma_change_rechecked'];
  seq: number;
};
/** Change reports from members (designer Agents) and the PM's file re-reads, in ledger order. */
export function figmaChangeReports(events: readonly LedgerEvent[]): Map<Id, FigmaChangeReport> {
  const reports = new Map<Id, FigmaChangeReport>();
  for (const original of events) {
    if (!isFigmaChangeEvent(original)) continue;
    const event = structuredClone(original);
    if (event.type === 'figma_change_reported') { if (!reports.has(event.payload.reportId)) reports.set(event.payload.reportId, { ...event.payload, seq: event.seq }); }
    else { const report = reports.get(event.payload.reportId); if (report) report.recheck = event.payload; }
  }
  return reports;
}
