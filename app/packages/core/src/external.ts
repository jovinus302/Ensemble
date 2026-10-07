// External conversation records (issue #79, EXPERIMENT): messages the PM observed or sent in an external
// tool such as Slack, the requests it is waiting on there, and delivery failures. The ledger keeps the
// original reference (workspace/channel/ts/thread), the author kind and the time, so a decision, a
// proposal and an unanswered request stay distinguishable. A Slack "decision" here is the conversation's
// own classification; it never stands in for `decision_recorded`, which needs Space authority.
import type { Id, LedgerEvent } from "./ledger.ts";

export type ExternalProvider = "slack";

/** Where an external message lives. For Slack: team id, channel id, message ts and thread root ts. */
export interface ExternalSourceRef {
  provider: ExternalProvider;
  workspaceId: string;
  channelId: string;
  messageTs: string;
  /** Thread root ts; absent for a root message. */
  threadTs?: string;
  permalink?: string;
}

/** Who wrote it: a person, a personal agent (a mapped bot), or this PM Agent. */
export interface ExternalAuthor {
  kind: "human" | "agent" | "pm";
  /** Slack user id or bot id. */
  externalUserId: string;
  /** The Space member, when the external account is mapped to one. */
  memberId?: Id;
}

/**
 * decision: a mapped person confirmed something; proposal: a suggestion or an unmapped person's "decision";
 * request: asks someone to act or answer; answer: replies to a request without deciding; other: none of these.
 */
export type ExternalMessageKind = "decision" | "proposal" | "request" | "answer" | "other" | "unclassified";
export type ExternalRequestReason = "thread_question" | "agent_result" | "agent_blocker" | "decision_followup";
export type ExternalFailureStage = "read" | "compose" | "send";

export interface ExternalEventPayloads {
  /** A message seen (or, for author kind `pm`, posted) in the external tool. `postedAt` is the tool's time, the event's `at` the observation time. */
  external_message_observed: {
    messageId: Id;
    source: ExternalSourceRef;
    author: ExternalAuthor;
    text: string;
    postedAt: string;
    kind: ExternalMessageKind;
    /** What the message settled and what is left, as the PM read it. */
    confirmed?: string[];
    remaining?: string[];
    /** The external request this message answers. */
    requestId?: Id;
    /** The message this one replies to (a PM reply to a mention). */
    inReplyTo?: Id;
    taskIds?: Id[];
    /** How a PM message was written: by the PM model or by the fixed fallback template. */
    composedBy?: "llm" | "template";
  };
  /** The PM asked someone in the external tool and waits for the answer there. */
  external_request_sent: {
    requestId: Id;
    source: ExternalSourceRef;
    target: ExternalAuthor;
    text: string;
    reason: ExternalRequestReason;
    /** The ledger event (agent result, blocker, decision) or external message that made the request necessary. */
    triggerId: Id;
    taskIds: Id[];
    /** After this time without an answer the request counts as no response. */
    dueAt: string;
    composedBy: "llm" | "template";
  };
  external_request_resolved: {
    requestId: Id;
    outcome: "answered" | "no_response";
    replyMessageId?: Id;
    by?: ExternalAuthor;
  };
  /** Reading the thread, writing the reply, or posting failed. `error` is the tool's error code, never a credential. */
  external_delivery_failed: {
    failureId: Id;
    stage: ExternalFailureStage;
    operation: string;
    triggerId: Id;
    error: string;
    attempt: number;
    requestId?: Id;
    channelId?: string;
    threadTs?: string;
  };
}

type External<K extends keyof ExternalEventPayloads> = LedgerEvent<K, ExternalEventPayloads[K]>;
export type ExternalEvent = { [K in keyof ExternalEventPayloads]: External<K> }[keyof ExternalEventPayloads];

export type ExternalRequestStatus = "awaiting_response" | "answered" | "no_response";
export interface ExternalRequestState {
  request: ExternalEventPayloads["external_request_sent"];
  status: ExternalRequestStatus;
  sentAt: string;
  resolution?: ExternalEventPayloads["external_request_resolved"];
  reply?: ExternalEventPayloads["external_message_observed"];
}
export interface ExternalConversationState {
  messages: (ExternalEventPayloads["external_message_observed"] & { observedAt: string })[];
  requests: Map<Id, ExternalRequestState>;
  failures: (ExternalEventPayloads["external_delivery_failed"] & { at: string })[];
}

const EXTERNAL_TYPES = new Set<string>(["external_message_observed", "external_request_sent", "external_request_resolved", "external_delivery_failed"]);
export function isExternalEvent(event: LedgerEvent): event is ExternalEvent {
  return EXTERNAL_TYPES.has(event.type);
}

/** Replays external records in ledger order. The first resolution of a request wins. */
export function externalConversation(events: readonly LedgerEvent[]): ExternalConversationState {
  const state: ExternalConversationState = { messages: [], requests: new Map(), failures: [] };
  for (const event of events) {
    if (!isExternalEvent(event)) continue;
    switch (event.type) {
      case "external_message_observed": state.messages.push({ ...event.payload, observedAt: event.at }); break;
      case "external_request_sent":
        if (!state.requests.has(event.payload.requestId)) state.requests.set(event.payload.requestId, { request: event.payload, status: "awaiting_response", sentAt: event.at });
        break;
      case "external_request_resolved": {
        const request = state.requests.get(event.payload.requestId);
        if (!request || request.status !== "awaiting_response") break;
        request.status = event.payload.outcome;
        request.resolution = event.payload;
        request.reply = state.messages.find((m) => m.messageId === event.payload.replyMessageId);
        break;
      }
      case "external_delivery_failed": state.failures.push({ ...event.payload, at: event.at }); break;
    }
  }
  return state;
}

/** External requests still awaiting an answer whose due time has passed. */
export function overdueExternalRequests(state: ExternalConversationState, now: Date): ExternalRequestState[] {
  return [...state.requests.values()].filter((r) => r.status === "awaiting_response" && Date.parse(r.request.dueAt) <= now.getTime());
}

/**
 * What happened outside the Space about one task: the PM's requests with their status and the answers.
 * A personal agent entering the Space (#81) reads its follow-up decision here.
 */
export function externalFollowUps(state: ExternalConversationState, taskId: Id): ExternalRequestState[] {
  return [...state.requests.values()].filter((r) => r.request.taskIds.includes(taskId));
}
