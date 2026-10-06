import type { ProjectState } from "./projection.ts";
import type { PreviewDraft, WorkContextFacts, WorkContextTrigger } from "./work-context-ops.ts";
import { currentPreview } from "./work-context-projection.ts";

/** Facts for `update_work_context`, or undefined when the project has no Work Context. Pure; the same input for the fake and real PM. */
export function workContextFacts(state: ProjectState, trigger: WorkContextTrigger, options: { messageLimit?: number } = {}): WorkContextFacts | undefined {
  const wc = state.workContext;
  if (!wc) return undefined;
  const base = currentPreview(wc)?.preview;
  const basePreview: PreviewDraft | undefined = base && { previewId: base.previewId, source: base.source, label: base.label, ...(base.caption !== undefined ? { caption: base.caption } : {}), ...(base.refId !== undefined ? { refId: base.refId } : {}), spec: base.spec };
  return {
    trigger,
    decider: state.goal?.decider ?? "",
    context: { contextId: wc.session.contextId, code: wc.session.code, title: wc.session.title, version: wc.version },
    members: [...state.members.values()].map(m => ({ memberId: m.memberId, kind: m.kind, displayName: m.displayName, ...(m.role !== undefined ? { role: m.role } : {}), ...(m.source ? { source: m.source } : {}) })),
    messages: state.messages.slice(-(options.messageLimit ?? 40)).map(m => ({ messageId: m.messageId, authorId: m.authorId, text: m.text })),
    items: [...wc.items.values()],
    edges: [...wc.edges.values()],
    branches: [...wc.branches.values()].map(b => ({ itemId: b.itemId, question: b.question, options: b.options,
      ...(b.preview ? { previewOptionId: b.preview.optionId } : {}), ...(b.resolved ? { resolvedOptionId: b.resolved.optionId } : {}) })),
    pool: { candidates: [...wc.pool.candidates.values()], invitedCandidateIds: [...wc.pool.invited.keys()] },
    tools: [...wc.tools.values()].map(t => ({ toolId: t.toolId, name: t.name, ownerMemberId: t.ownerMemberId })),
    handoffs: [...wc.handoffs.values()].map(h => ({ handoffId: h.handoff.handoffId, toolId: h.handoff.toolId, title: h.handoff.title, round: h.handoff.round, status: h.status })),
    proposals: [...wc.proposals.values()].map(p => ({ proposalId: p.proposal.proposalId, version: p.proposal.version, status: p.status, expandedItemIds: p.expandedItemIds })),
    builds: [...wc.builds.values()].map(b => ({ buildId: b.buildId, version: b.version })),
    changeSets: [...wc.changeSets.values()].map(c => ({ changeSetId: c.change.changeSetId, toVersion: c.change.toVersion, status: c.status })),
    ...(basePreview ? { basePreview } : {}),
  };
}
