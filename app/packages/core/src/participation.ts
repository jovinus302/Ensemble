// Personal agents joining the Space (issue #81). A participant is a person's existing agent (Codex, Claude, …) working in the
// person's own folder. It is not a project member: the PM never plans work onto it. Three directions share these events:
//   personal agent → Space   participant_linked, space_context_read, space_post_recorded
//   PM → personal workspace  workspace_context_observed, personal_request_created/delivered/delivery_failed
//   personal agent → PM      personal_request_seen, personal_request_answered (with the reply's space_post_recorded)
// Every PM step on a post is recorded as liaison_considered, so silence and loop guards stay observable.
import type { Id, LedgerEvent } from "./ledger.ts";

export type ParticipantScope = "readSpace" | "post" | "receiveRequests" | "pmReadWorkspace";
export type ParticipantScopes = Record<ParticipantScope, boolean>;
export type SpacePostKind = "result" | "question" | "blocked" | "note";
export type DeliveryFailure = "unreachable" | "permission_denied" | "not_permitted" | "error";
/** The PM asks the personal agent at most this deep in one thread; deeper follow-ups wait for a person. */
export const MAX_REQUEST_DEPTH = 3;

export interface ParticipationPayloads {
  /** A person authorizes their existing agent and folder for this Space. Re-linking replaces the previous link. */
  participant_linked: {
    participantId: Id; displayName: string; tool: string;
    /** Absolute path of the person's existing folder; the only place the PM reads from or writes requests to. */
    workspaceRoot: string;
    /** Paths relative to workspaceRoot the PM may read. `.` is the whole folder. */
    allowedPaths: string[];
    scopes: ParticipantScopes;
    linkedBy: Id;
    /** Base URL the agent uses to reach the Space (written into delivered requests). */
    spaceUrl?: string;
  };
  /** The agent fetched its Space context. Evidence that Space content arrived, separate from posting. */
  space_context_read: { participantId: Id; readId: Id; format: "md" | "json"; requestIds: Id[] };
  space_post_recorded: {
    postId: Id; participantId: Id; kind: SpacePostKind; text: string;
    taskId?: Id;
    /** The personal request this post answers. */
    inReplyTo?: Id;
    /** The agent's own id for the post; a repeated share with the same id is one post. */
    clientPostId: string;
    source: { tool: string; workspaceRoot: string; via: "space_http" };
    /** When the server received it (the envelope's `at` is the ledger write time; they match for HTTP posts). */
    observedAt: string;
  };
  /** The PM read the person's folder itself. Metadata only: file contents stay out of the ledger. */
  workspace_context_observed: {
    observationId: Id; participantId: Id; source: "local_workspace";
    files: { path: string; sha256: string; bytes: number; mtime: string }[];
    /** Compared with this participant's previous observation. */
    changes: { added: string[]; modified: string[]; removed: string[] };
    truncated: boolean;
    rejected: { path: string; reason: string }[];
  };
  /** The PM's request to the personal agent. Stays pending until delivered; never retried by writing anywhere else. */
  personal_request_created: {
    requestId: Id; participantId: Id; text: string;
    /** The post that prompted it; absent for a request a person asked the PM to send. */
    triggerPostId?: Id;
    observationId?: Id;
    taskId?: Id;
    /** 1 for a request about a fresh post; a request about a reply to request N has depth N+1. */
    depth: number;
  };
  personal_request_delivered: { requestId: Id; participantId: Id; location: string; attempt: number };
  personal_request_delivery_failed: { requestId: Id; participantId: Id; reason: DeliveryFailure; detail: string; attempt: number };
  /** The agent's Space context listed this request: it has seen it in the Space (not necessarily acted). */
  personal_request_seen: { requestId: Id; participantId: Id; via: "space_context" };
  personal_request_answered: { requestId: Id; participantId: Id; postId: Id };
  /** What the PM did with one trigger post: asked, stayed silent, stopped for a person, or skipped it. */
  liaison_considered: {
    considerationId: Id; participantId: Id; triggerPostId: Id;
    outcome: "request" | "none" | "needs_human" | "skipped";
    reason: string; depth: number;
    observationId?: Id; requestId?: Id;
  };
}

export type ParticipationEventType = keyof ParticipationPayloads;
export type ParticipationEvent = { [K in ParticipationEventType]: LedgerEvent<K, ParticipationPayloads[K]> }[ParticipationEventType];

export type PersonalRequestStatus = "pending" | "delivered" | "seen" | "answered";
export interface PersonalRequestState {
  request: ParticipationPayloads["personal_request_created"];
  status: PersonalRequestStatus;
  createdAt: string;
  createdBy: LedgerEvent["actor"];
  attempts: number;
  delivered?: { location: string; at: string };
  lastFailure?: { reason: DeliveryFailure; detail: string; at: string };
  seenAt?: string;
  answer?: { postId: Id; at: string };
}
export type SpacePost = ParticipationPayloads["space_post_recorded"] & { at: string; actor: LedgerEvent["actor"] };
export interface ParticipantState {
  link: ParticipationPayloads["participant_linked"];
  linkedAt: string;
  lastReadAt?: string;
  lastObservation?: ParticipationPayloads["workspace_context_observed"] & { at: string };
}
export interface ParticipationState {
  participants: Map<Id, ParticipantState>;
  posts: Map<Id, SpacePost>;
  requests: Map<Id, PersonalRequestState>;
  considerations: Map<Id, ParticipationPayloads["liaison_considered"]>;
}

const TYPES = new Set<string>(["participant_linked", "space_context_read", "space_post_recorded", "workspace_context_observed", "personal_request_created",
  "personal_request_delivered", "personal_request_delivery_failed", "personal_request_seen", "personal_request_answered", "liaison_considered"]);
export function isParticipationEvent(event: LedgerEvent): event is ParticipationEvent { return TYPES.has(event.type); }

/** Replays the participation events of one project's ledger. Kept apart from `project()` so planning never sees participants. */
export function participation(events: readonly LedgerEvent[]): ParticipationState {
  const state: ParticipationState = { participants: new Map(), posts: new Map(), requests: new Map(), considerations: new Map() };
  for (const raw of events) {
    if (!isParticipationEvent(raw)) continue;
    const event = structuredClone(raw) as ParticipationEvent;
    switch (event.type) {
      case "participant_linked": {
        const previous = state.participants.get(event.payload.participantId);
        state.participants.set(event.payload.participantId, { ...previous, link: event.payload, linkedAt: event.at });
        break;
      }
      case "space_context_read": {
        const participant = state.participants.get(event.payload.participantId);
        if (participant) participant.lastReadAt = event.at;
        break;
      }
      case "space_post_recorded": state.posts.set(event.payload.postId, { ...event.payload, at: event.at, actor: event.actor }); break;
      case "workspace_context_observed": {
        const participant = state.participants.get(event.payload.participantId);
        if (participant) participant.lastObservation = { ...event.payload, at: event.at };
        break;
      }
      case "personal_request_created":
        if (!state.requests.has(event.payload.requestId)) state.requests.set(event.payload.requestId, { request: event.payload, status: "pending", createdAt: event.at, createdBy: event.actor, attempts: 0 });
        break;
      case "personal_request_delivery_failed": {
        const entry = state.requests.get(event.payload.requestId);
        if (entry) { entry.attempts = Math.max(entry.attempts, event.payload.attempt); entry.lastFailure = { reason: event.payload.reason, detail: event.payload.detail, at: event.at }; }
        break;
      }
      case "personal_request_delivered": {
        const entry = state.requests.get(event.payload.requestId);
        if (entry && !entry.delivered) {
          entry.attempts = Math.max(entry.attempts, event.payload.attempt);
          entry.delivered = { location: event.payload.location, at: event.at };
          if (entry.status === "pending") entry.status = "delivered";
        }
        break;
      }
      case "personal_request_seen": {
        const entry = state.requests.get(event.payload.requestId);
        if (entry && !entry.seenAt) { entry.seenAt = event.at; if (entry.status === "pending" || entry.status === "delivered") entry.status = "seen"; }
        break;
      }
      case "personal_request_answered": {
        const entry = state.requests.get(event.payload.requestId);
        if (entry && !entry.answer) { entry.answer = { postId: event.payload.postId, at: event.at }; entry.status = "answered"; }
        break;
      }
      case "liaison_considered": state.considerations.set(event.payload.triggerPostId, event.payload); break;
    }
  }
  return state;
}

/** Requests the agent still owes an answer to, oldest first. */
export function openRequests(state: ParticipationState, participantId: Id): PersonalRequestState[] {
  return [...state.requests.values()].filter(r => r.request.participantId === participantId && r.status !== "answered");
}

/** Depth of a request the PM would send about this post: a reply to request N leads to depth N+1. */
export function requestDepthFor(state: ParticipationState, post: Pick<SpacePost, "inReplyTo">): number {
  const parent = post.inReplyTo ? state.requests.get(post.inReplyTo) : undefined;
  return parent ? parent.request.depth + 1 : 1;
}
