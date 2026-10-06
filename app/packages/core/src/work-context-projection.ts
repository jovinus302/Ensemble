import type { AnyEvent } from "./events.ts";
import type { ProjectState } from "./projection.ts";
import { CONTEXT_ISSUE_STATUSES, WORK_CONTEXT_EVENT_TYPES, type ContextItemStatus, type PreviewSource, type PreviewState, type WorkContextEventType, type WorkContextState } from "./work-context.ts";

export type WorkContextEvent = Extract<AnyEvent, { type: WorkContextEventType }>;
const TYPES = new Set<string>(WORK_CONTEXT_EVENT_TYPES);
export function isWorkContextEvent(event: AnyEvent): event is WorkContextEvent { return TYPES.has(event.type); }

export function emptyWorkContext(session: WorkContextState["session"]): WorkContextState {
  return {
    session, version: session.version, items: new Map(), edges: new Map(), branches: new Map(),
    pool: { candidates: new Map(), searches: new Map(), invited: new Map() },
    tools: new Map(), handoffs: new Map(), proposals: new Map(), builds: new Map(), previews: new Map(), changeSets: new Map(), cards: new Map(),
  };
}

/** Folds one Work Context event. Events before `context_session_started` are ignored; references to unknown ids are dropped. */
export function applyWorkContextEvent(state: ProjectState, event: WorkContextEvent): void {
  if (event.type === "context_session_started") {
    if (!state.workContext) state.workContext = emptyWorkContext(event.payload);
    return;
  }
  const wc = state.workContext;
  if (!wc) return;
  switch (event.type) {
    case "member_pool_listed": for (const c of event.payload.candidates) wc.pool.candidates.set(c.candidateId, c); break;
    case "production_tool_linked": wc.tools.set(event.payload.toolId, event.payload); break;
    case "context_item_upserted": wc.items.set(event.payload.item.itemId, event.payload.item); break;
    case "context_edge_upserted": wc.edges.set(event.payload.edge.edgeId, event.payload.edge); break;
    case "context_branch_opened": {
      const { itemId, question, options } = event.payload;
      if (wc.items.has(itemId)) wc.branches.set(itemId, { itemId, question, options });
      break;
    }
    case "context_branch_previewed": {
      const branch = wc.branches.get(event.payload.itemId);
      const { optionId, effects, previewId } = event.payload;
      if (branch?.options.some(o => o.optionId === optionId)) branch.preview = { optionId, effects, ...(previewId !== undefined ? { previewId } : {}) };
      break;
    }
    case "context_branch_preview_cleared": {
      const branch = wc.branches.get(event.payload.itemId);
      if (branch?.preview?.optionId === event.payload.optionId) delete branch.preview;
      break;
    }
    case "context_branch_resolved": {
      const branch = wc.branches.get(event.payload.itemId);
      if (branch?.options.some(o => o.optionId === event.payload.optionId) && state.members.get(event.payload.decidedBy)?.kind === "human") branch.resolved = event.payload;
      break;
    }
    case "pool_search_recorded": wc.pool.searches.set(event.payload.searchId, event.payload); break;
    case "pool_member_invited":
      if (wc.pool.candidates.has(event.payload.candidateId)) wc.pool.invited.set(event.payload.candidateId, event.payload.memberId);
      break;
    case "proposal_generated": wc.proposals.set(event.payload.proposalId, { proposal: event.payload, status: "generated", expandedItemIds: [] }); break;
    case "proposal_confirmed": {
      const proposal = wc.proposals.get(event.payload.proposalId);
      if (!proposal || state.members.get(event.payload.confirmedBy)?.kind !== "human") break;
      proposal.status = "confirmed"; proposal.confirmed = event.payload; wc.version = event.payload.contextVersion;
      break;
    }
    case "proposal_expanded": {
      const proposal = wc.proposals.get(event.payload.proposalId);
      if (proposal) proposal.expandedItemIds = event.payload.itemIds.filter(id => wc.items.has(id));
      break;
    }
    case "tool_handoff_sent": if (wc.tools.has(event.payload.toolId)) wc.handoffs.set(event.payload.handoffId, { handoff: event.payload, status: "delivered" }); break;
    case "tool_progress_reported": {
      const handoff = wc.handoffs.get(event.payload.handoffId);
      if (handoff) { handoff.status = event.payload.status; if (event.payload.note !== undefined) handoff.note = event.payload.note; else delete handoff.note; }
      break;
    }
    case "build_produced": wc.builds.set(event.payload.buildId, event.payload); break;
    case "preview_rendered": wc.previews.set(event.payload.previewId, { preview: event.payload, withdrawn: false, seq: event.seq }); break;
    case "preview_withdrawn": { const preview = wc.previews.get(event.payload.previewId); if (preview) preview.withdrawn = true; break; }
    case "context_change_proposed": wc.changeSets.set(event.payload.changeSetId, { change: event.payload, status: "proposed" }); break;
    case "context_change_resolved": {
      const set = wc.changeSets.get(event.payload.changeSetId);
      if (!set || set.status !== "proposed" || state.members.get(event.payload.by)?.kind !== "human") break;
      set.status = event.payload.outcome; set.by = event.payload.by;
      if (event.payload.outcome === "applied") wc.version = set.change.toVersion;
      break;
    }
    case "context_card_posted": wc.cards.set(event.payload.messageId, event.payload.card); break;
  }
}

/** Items per status, for the canvas header ("충돌 1 · 위반 1 · 미정 1 · 누락 4"). */
export function contextStatusCounts(wc: WorkContextState): Map<ContextItemStatus, number> {
  const counts = new Map<ContextItemStatus, number>();
  for (const item of wc.items.values()) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  return counts;
}
export function contextIssueCount(wc: WorkContextState): number {
  let n = 0;
  for (const item of wc.items.values()) if (CONTEXT_ISSUE_STATUSES.includes(item.status)) n++;
  return n;
}
/** The newest preview not withdrawn, optionally of one source. */
export function currentPreview(wc: WorkContextState, source?: PreviewSource): PreviewState | undefined {
  let best: PreviewState | undefined;
  for (const entry of wc.previews.values()) if (!entry.withdrawn && (!source || entry.preview.source === source) && (!best || entry.seq > best.seq)) best = entry;
  return best;
}
