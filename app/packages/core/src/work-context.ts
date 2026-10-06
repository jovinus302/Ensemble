// Work Context contract (Pages v2.5, docs/pages-v25-runtime-demo.md §3).
// A channel's WORK CONTEXT is a graph of items the PM reads out of the conversation (intent → decision →
// feature → screen → metric), plus branches, a member pool, proposals, production-tool handoffs and app previews.
// Shared by every workstream: change a shape here only through the coordinator.
import type { Id } from "./ledger.ts";

/** Canvas columns, left to right. `contribution` is a member's (or pool expert's) part in the context. */
export type ContextLayer = "intent" | "decision" | "feature" | "screen" | "metric" | "contribution";
export const CONTEXT_LAYERS: readonly ContextLayer[] = ["intent", "decision", "feature", "screen", "metric", "contribution"];

/**
 * One status per item; the LOG keeps the history.
 * Detection (scene 03): conflict · violation · undecided · missing.
 * Alignment (04): filled (누락 보완) · merged (통합) · branch (분기) · confirmed (확정).
 * Expansion (05): verify_pending (검증 예정).
 * Change (06): kept (유지) · added (추가) · updated (갱신) · stale (낡음) · excluded (제외).
 */
export type ContextItemStatus =
  | "stated" | "conflict" | "violation" | "undecided" | "missing"
  | "filled" | "merged" | "branch" | "confirmed" | "verify_pending"
  | "kept" | "added" | "updated" | "stale" | "excluded";
/** Statuses that mean "the PM found a problem here" (canvas summary counts). */
export const CONTEXT_ISSUE_STATUSES: readonly ContextItemStatus[] = ["conflict", "violation", "undecided", "missing"];

export interface ContextItem {
  itemId: Id;
  /** Visible short key such as "I1", "D2", "F5", "S1", "V1". Optional for unnumbered detections. */
  key?: string;
  layer: ContextLayer;
  /** Korean, one line ("9시 자동(추천 1종) + 생성 버튼"). */
  title: string;
  status: ContextItemStatus;
  /** Short reason shown next to the status ("D1과 충돌", "비용 한도", "생성 버튼 위치"). */
  note?: string;
  /** Who the item came from; `pm` when the PM itself filled a gap. */
  sourceMemberId: Id;
  sourceMessageIds: Id[];
  /** Items this one merged (D1 ← I1 + I2) or was expanded from (F1 ← proposal). */
  derivedFrom?: Id[];
  /** Absorbed into that item when the PM organized the context: the canvas hides it, the LOG keeps it. */
  supersededBy?: Id;
}

/** supports: evidence/intent behind an item · conflicts: two premises at the same step · derives: expansion D→F→S→V · feeds: item → tool / build. */
export type ContextEdgeKind = "supports" | "conflicts" | "derives" | "feeds";
export interface ContextEdge { edgeId: Id; from: Id; to: Id; kind: ContextEdgeKind; stale?: boolean }

export interface BranchOption {
  /** "A" / "B". */
  optionId: Id;
  title: string;
  /** Gain and risk in one line each ("몰입 ↑", "feed 공유 시 제3자 개인정보 노출 위험"). */
  gains: string[];
  risks: string[];
}

export interface PoolCandidate {
  candidateId: Id;
  displayName: string;
  role: string;
  expertise: string[];
  availability: "available" | "busy";
  /** Why this person fits, one line ("유사 과제 3건"). */
  note: string;
}

export type ProductionToolId = "figma" | "prompt-studio" | "dev-tools";
export type ToolHandoffStatus = "delivered" | "in_progress" | "done";

/**
 * A rendered mobile app screen, re-implemented in React from this data (no images or embedded fonts).
 * The PM writes it as data; the web app draws it. Field names are generic, the values are the Pages app.
 */
export interface AppPreviewSpec {
  appName: string;
  /** "10월 2일 금요일". */
  dateLabel: string;
  /** Version chips shown in the app header, and which one is active. */
  versions: string[];
  activeVersion: string;
  hero: {
    /** "오늘의 Page · 21:00 도착". */
    kicker: string;
    format: string;
    badge?: { text: string; tone: "fiction" | "real" };
    title: string;
    meta: string;
    sources: string;
  };
  /** A banner such as "feed 공유 · 검수 대기 2건". */
  notice?: { text: string; tone: "warn" | "info" };
  primaryAction: string;
  formats: string[];
  formatAction: string;
  history: { date: string; title: string; format: string }[];
  tabs: string[];
  /** Callouts drawn beside the phone ("실명 그대로 · 공유 전 검수"). */
  annotations?: { text: string; tone: "warn" | "info" }[];
}
export type PreviewSource = "proposal" | "branch" | "design" | "build";

/** A card shown inside a chat message. It holds ids only; the view resolves the current state, so progress updates in place. */
export type ContextCard =
  | { kind: "branch_options"; itemId: Id }
  /** The PM's visible steps ("판단 중: 결정 근거 확인 → 멤버 역량 확인 → 가능 인력 검색"). */
  | { kind: "pm_steps"; label: string; steps: string[]; searchId?: Id; proposalId?: Id }
  | { kind: "pool_candidates"; searchId: Id }
  | { kind: "proposal"; proposalId: Id }
  | { kind: "branch_preview"; itemId: Id; optionId: Id }
  | { kind: "expansion"; proposalId: Id }
  | { kind: "tool_handoffs"; handoffIds: Id[] }
  | { kind: "build"; buildId: Id }
  | { kind: "change_set"; changeSetId: Id };

/** Ledger payloads added by the Work Context. `EventPayloads` extends this map. */
export interface WorkContextEventPayloads {
  /** Turns the Work Context on for the project (seeded by the Pages scenario). */
  context_session_started: { contextId: Id; code: string; title: string; channelName: string; version: string };
  /** The simulated member pool the PM may search (seed; no external service). */
  member_pool_listed: { candidates: PoolCandidate[] };
  /** A production tool a participant connected beforehand (seed). */
  production_tool_linked: { toolId: ProductionToolId; name: string; ownerMemberId: Id; accepts: ContextLayer[] };
  /** Full replace by `item.itemId`. */
  context_item_upserted: { item: ContextItem };
  /** Full replace by `edge.edgeId`. */
  context_edge_upserted: { edge: ContextEdge };
  context_branch_opened: { itemId: Id; question: string; options: BranchOption[]; sourceMessageIds: Id[] };
  /** "A로 가면?": the predicted path for an option that is not chosen. */
  context_branch_previewed: { itemId: Id; optionId: Id; effects: string[]; previewId?: Id; sourceMessageIds: Id[] };
  context_branch_preview_cleared: { itemId: Id; optionId: Id };
  /** decidedBy is always a human; evidence names the members whose input decided it. */
  context_branch_resolved: { itemId: Id; optionId: Id; decidedBy: Id; evidenceMemberIds: Id[]; sourceMessageIds: Id[] };
  pool_search_recorded: { searchId: Id; forItemId: Id; reason: string; steps: string[]; candidateIds: Id[] };
  /** Joining is a separate `member_joined` with `source: "pool"`. */
  pool_member_invited: { searchId: Id; candidateId: Id; memberId: Id };
  proposal_generated: {
    proposalId: Id; version: number; title: string;
    decisionItemIds: Id[]; filledItemIds: Id[]; inputItemIds: Id[];
    /** Screen names ("home", "생성 플로우", "feed 공유"). */
    screens: string[];
    previewId?: Id; sourceMessageIds: Id[];
  };
  proposal_confirmed: { proposalId: Id; contextVersion: string; confirmedBy: Id; sourceMessageIds: Id[] };
  /** Items are upserted separately; this records which items the proposal unfolded into (D → F → S → V). */
  proposal_expanded: { proposalId: Id; itemIds: Id[] };
  tool_handoff_sent: { handoffId: Id; toolId: ProductionToolId; itemIds: Id[]; title: string; round: number };
  /** Written by the simulated tool integration, never by the PM. */
  tool_progress_reported: { handoffId: Id; status: ToolHandoffStatus; note?: string };
  build_produced: { buildId: Id; version: string; handoffIds: Id[]; previewId?: Id };
  preview_rendered: { previewId: Id; source: PreviewSource; label: string; caption?: string; refId?: Id; spec: AppPreviewSpec };
  preview_withdrawn: { previewId: Id };
  context_change_proposed: {
    changeSetId: Id; fromVersion: string; toVersion: string;
    changes: { itemId: Id; change: "added" | "excluded" | "updated" }[];
    staleItemIds: Id[]; unaffectedItemIds: Id[]; sourceMessageIds: Id[];
  };
  context_change_resolved: { changeSetId: Id; outcome: "applied" | "reverted"; by: Id };
  /** Attaches a card to a chat message (`pm_spoke.messageId`). */
  context_card_posted: { messageId: Id; card: ContextCard };
}
export type WorkContextEventType = keyof WorkContextEventPayloads;
export const WORK_CONTEXT_EVENT_TYPES = [
  "context_session_started", "member_pool_listed", "production_tool_linked", "context_item_upserted", "context_edge_upserted",
  "context_branch_opened", "context_branch_previewed", "context_branch_preview_cleared", "context_branch_resolved",
  "pool_search_recorded", "pool_member_invited", "proposal_generated", "proposal_confirmed", "proposal_expanded",
  "tool_handoff_sent", "tool_progress_reported", "build_produced", "preview_rendered", "preview_withdrawn",
  "context_change_proposed", "context_change_resolved", "context_card_posted",
] as const satisfies readonly WorkContextEventType[];

export interface BranchState {
  itemId: Id; question: string; options: BranchOption[];
  /** The option previewed right now ("A로 가면?"), until cleared. */
  preview?: { optionId: Id; effects: string[]; previewId?: Id };
  resolved?: WorkContextEventPayloads["context_branch_resolved"];
}
export interface ProposalState {
  proposal: WorkContextEventPayloads["proposal_generated"];
  status: "generated" | "confirmed";
  confirmed?: WorkContextEventPayloads["proposal_confirmed"];
  expandedItemIds: Id[];
}
export interface ToolHandoffState { handoff: WorkContextEventPayloads["tool_handoff_sent"]; status: ToolHandoffStatus; note?: string }
export interface PreviewState { preview: WorkContextEventPayloads["preview_rendered"]; withdrawn: boolean; seq: number }
export interface ChangeSetState { change: WorkContextEventPayloads["context_change_proposed"]; status: "proposed" | "applied" | "reverted"; by?: Id }

/** Projection of the Work Context events. Maps keep first-seen order. */
export interface WorkContextState {
  session: WorkContextEventPayloads["context_session_started"];
  /** Current context version ("0.3" → "1.0" → "1.1"). */
  version: string;
  items: Map<Id, ContextItem>;
  edges: Map<Id, ContextEdge>;
  branches: Map<Id, BranchState>;
  pool: {
    candidates: Map<Id, PoolCandidate>;
    searches: Map<Id, WorkContextEventPayloads["pool_search_recorded"]>;
    /** candidateId → memberId. */
    invited: Map<Id, Id>;
  };
  tools: Map<ProductionToolId, WorkContextEventPayloads["production_tool_linked"]>;
  handoffs: Map<Id, ToolHandoffState>;
  proposals: Map<Id, ProposalState>;
  builds: Map<Id, WorkContextEventPayloads["build_produced"]>;
  previews: Map<Id, PreviewState>;
  changeSets: Map<Id, ChangeSetState>;
  /** messageId → card. */
  cards: Map<Id, ContextCard>;
}
