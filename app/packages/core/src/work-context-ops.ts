// What the PM may propose for the Work Context (tool `update_work_context`), and the facts it is given.
// The fake PM (ENSEMBLE_PM_RUNTIME=fake) and the real models fill the same shapes; code validates them and
// writes the ledger events of work-context.ts. Authority stays in code: a branch or a proposal is settled
// only by a human's own message, a pool candidate must come from the listed pool, a tool must be linked.
import type { Id } from "./ledger.ts";
import type { AppPreviewSpec, BranchOption, ContextCard, ContextEdge, ContextItem, PoolCandidate, PreviewSource, ProductionToolId, ToolHandoffStatus } from "./work-context.ts";

export const WORK_CONTEXT_TOOL = "update_work_context";

export interface PreviewDraft { previewId: Id; source: PreviewSource; label: string; caption?: string; refId?: Id; spec: AppPreviewSpec }

export type WorkContextOp =
  | { type: "upsert_item"; item: ContextItem }
  | { type: "upsert_edge"; edge: ContextEdge }
  | { type: "open_branch"; itemId: Id; question: string; options: BranchOption[]; sourceMessageIds: Id[] }
  | { type: "preview_branch"; itemId: Id; optionId: Id; effects: string[]; preview?: PreviewDraft; sourceMessageIds: Id[] }
  | { type: "clear_branch_preview"; itemId: Id; optionId: Id }
  /** decidedBy must be the human whose message in sourceMessageIds chose the option. */
  | { type: "resolve_branch"; itemId: Id; optionId: Id; decidedBy: Id; evidenceMemberIds: Id[]; sourceMessageIds: Id[] }
  /** Records the search and invites every candidate in candidateIds (the pool integration then joins them). */
  | { type: "search_pool"; searchId: Id; forItemId: Id; reason: string; steps: string[]; candidateIds: Id[] }
  | { type: "generate_proposal"; proposalId: Id; version: number; title: string; decisionItemIds: Id[]; filledItemIds: Id[]; inputItemIds: Id[]; screens: string[]; preview?: PreviewDraft; sourceMessageIds: Id[] }
  /** confirmedBy must be the goal decider, speaking in sourceMessageIds. */
  | { type: "confirm_proposal"; proposalId: Id; contextVersion: string; confirmedBy: Id; sourceMessageIds: Id[] }
  | { type: "expand_proposal"; proposalId: Id; items: ContextItem[]; edges: ContextEdge[] }
  | { type: "handoff_tools"; handoffs: { handoffId: Id; toolId: ProductionToolId; itemIds: Id[]; title: string; round: number }[]; preview?: PreviewDraft }
  | { type: "withdraw_preview"; previewId: Id }
  | { type: "propose_change"; changeSetId: Id; fromVersion: string; toVersion: string; changes: { itemId: Id; change: "added" | "excluded" | "updated" }[]; staleItemIds: Id[]; unaffectedItemIds: Id[]; sourceMessageIds: Id[] };
export type WorkContextOpType = WorkContextOp["type"];

/** One PM message; `card` is attached with `context_card_posted`. */
export interface WorkContextSpeech { text: string; kind: "fact" | "summary" | "ask" | "answer"; card?: ContextCard }

/** The `update_work_context` tool input. Empty ops and speech mean "stay silent". */
export interface WorkContextToolOutput {
  ops: WorkContextOp[];
  /** At most two messages per turn (scene 05 posts the expansion and the handoff back to back). */
  speech: WorkContextSpeech[];
  /** Why, in Korean; recorded on `pm_considered`. */
  reason: string;
}

/** What woke the PM: a channel message, or a non-message ledger event (a pool member joined, a build finished). */
export type WorkContextTrigger =
  | { kind: "message"; messageId: Id }
  | { kind: "event"; eventType: "member_joined" | "build_produced" | "tool_progress_reported" | "context_change_resolved"; refId: Id };

/** The facts the PM sees (JSON in the user message). Model-facing fields only; no ledger seq or internal state. */
export interface WorkContextFacts {
  trigger: WorkContextTrigger;
  decider: Id;
  context: { contextId: Id; code: string; title: string; version: string };
  members: { memberId: Id; kind: "human" | "agent"; displayName: string; role?: string; source?: "pool" }[];
  /** Channel messages, oldest first (PM speech included, authorId "pm"). */
  messages: { messageId: Id; authorId: Id; text: string }[];
  items: ContextItem[];
  edges: ContextEdge[];
  branches: { itemId: Id; question: string; options: BranchOption[]; previewOptionId?: Id; resolvedOptionId?: Id }[];
  pool: { candidates: PoolCandidate[]; invitedCandidateIds: Id[] };
  tools: { toolId: ProductionToolId; name: string; ownerMemberId: Id }[];
  handoffs: { handoffId: Id; toolId: ProductionToolId; title: string; round: number; status: ToolHandoffStatus }[];
  proposals: { proposalId: Id; version: number; status: "generated" | "confirmed"; expandedItemIds: Id[] }[];
  builds: { buildId: Id; version: string }[];
  changeSets: { changeSetId: Id; toVersion: string; status: "proposed" | "applied" | "reverted" }[];
  /** The newest preview spec, so a model edits it instead of inventing a screen. */
  basePreview?: PreviewDraft;
}
