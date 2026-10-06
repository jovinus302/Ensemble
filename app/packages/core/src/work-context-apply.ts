// Turns one `update_work_context` answer into ledger events (docs/pages-v25-runtime-demo.md §3.4).
// The PM (fake or model) only proposes; this code checks shape, references and authority against the
// projection, keeps the ops that pass, and records why the others were dropped. Pure: no store, no clock.
import type { Actor, Id, LedgerEvent, NewLedgerEvent } from "./ledger.ts";
import type { EventContext, EventPayloads } from "./events.ts";
import { project, type ProjectState } from "./projection.ts";
import { CONTEXT_LAYERS, type ContextCard, type ContextEdge, type ContextItem, type ContextItemStatus, type WorkContextState } from "./work-context.ts";
import type { PreviewDraft, WorkContextOp, WorkContextSpeech, WorkContextToolOutput, WorkContextTrigger } from "./work-context-ops.ts";

const STATUSES: readonly ContextItemStatus[] = ["stated", "conflict", "violation", "undecided", "missing", "filled", "merged", "branch", "confirmed", "verify_pending", "kept", "added", "updated", "stale", "excluded"];
const EDGE_KINDS = ["supports", "conflicts", "derives", "feeds"];
const SPEECH_KINDS = ["fact", "summary", "ask", "answer"];
const TOOLS = ["figma", "prompt-studio", "dev-tools"];
const PREVIEW_SOURCES = ["proposal", "branch", "design", "build"];
const PM: Actor = { kind: "pm", id: "pm" };

const str = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every(str);
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The member a pool candidate joins as (`pool-jiwoo` → `jiwoo`). */
export const poolMemberId = (candidateId: Id) => candidateId.replace(/^pool-/, "");
/** Id of the PM message for speech `index` of one consideration. */
export const workContextMessageId = (considerationId: Id, index: number) => `${considerationId}:say:${index}`;
export function workContextTriggerId(trigger: WorkContextTrigger): Id {
  return trigger.kind === "message" ? trigger.messageId : `${trigger.eventType}:${trigger.refId}`;
}

export interface WorkContextApplyInput {
  context: EventContext;
  trigger: WorkContextTrigger;
  /** Unique per turn; also the idempotency key prefix. */
  considerationId: Id;
  at?: string;
}
export interface WorkContextApplyResult {
  append: NewLedgerEvent[];
  /** Korean reasons for each dropped op or speech; empty when everything applied. */
  problems: string[];
  spoken: WorkContextSpeech[];
}

/** Validates `output` against `events` and returns the events to append in one transaction (always ends with `pm_considered`). */
export function applyWorkContextOutput(events: readonly LedgerEvent[], output: unknown, input: WorkContextApplyInput): WorkContextApplyResult {
  const append: NewLedgerEvent[] = [];
  const problems: string[] = [];
  const base = { ...input.context, ...(input.at ? { at: input.at } : {}) };
  let state = project(events);
  if (!state.workContext) return { append: [], problems: ["WORK CONTEXT가 없는 프로젝트입니다."], spoken: [] };
  // Each op sees the effect of the ops before it in the same answer.
  const pending: NewLedgerEvent[] = [];
  const reproject = () => {
    state = project([...events, ...pending.map((e, i) => ({ ...e, id: `pending-${i}`, seq: (events.at(-1)?.seq ?? 0) + i + 1, at: e.at ?? new Date(0).toISOString() }) as LedgerEvent)]);
  };
  const emit = <K extends keyof EventPayloads>(type: K, payload: EventPayloads[K], actor: Actor = PM) => { pending.push({ ...base, actor, type, payload }); };
  const wc = () => state.workContext as WorkContextState;
  const raw = obj(output) ? output : {};
  const ops = Array.isArray(raw.ops) ? raw.ops : [];
  for (const [i, op] of ops.entries()) {
    const before = pending.length;
    const problem = obj(op) ? applyOp(op as WorkContextOp, state, wc(), emit) : "op 형식이 올바르지 않습니다.";
    if (problem) { pending.length = before; problems.push(`op ${i + 1}(${obj(op) ? String(op.type) : "?"}): ${problem}`); continue; }
    reproject();
  }
  const speech = Array.isArray(raw.speech) ? raw.speech.slice(0, 2) : [];
  if (Array.isArray(raw.speech) && raw.speech.length > 2) problems.push("한 번에 두 번까지만 말합니다.");
  const spoken: WorkContextSpeech[] = [];
  for (const s of speech) {
    if (!obj(s) || !str(s.text) || !SPEECH_KINDS.includes(s.kind as string)) { problems.push("발언 형식이 올바르지 않습니다."); continue; }
    const card = s.card === undefined ? undefined : cardProblem(s.card, wc()) ? undefined : s.card as ContextCard;
    if (s.card !== undefined && !card) problems.push(`카드: ${cardProblem(s.card, wc())}`);
    spoken.push({ text: s.text, kind: s.kind as WorkContextSpeech["kind"], ...(card ? { card } : {}) });
  }
  append.push(...pending);
  const triggerId = workContextTriggerId(input.trigger);
  const reason = [str(raw.reason) ? raw.reason : spoken.length ? "WORK CONTEXT를 갱신하고 알린다" : "말할 필요가 없다", ...problems].join(" · ");
  const decider = state.goal?.decider ?? null;
  append.push({ ...base, actor: PM, type: "pm_considered", idempotencyKey: `wc:${input.considerationId}`, payload: { considerationId: input.considerationId, triggerId, whoseAction: spoken.length ? decider : null,
    alreadyKnows: spoken.length ? "no" : "unknown", evidence: [triggerId], decision: spoken.length ? "speak" : "silent", reason, openTopics: state.openTopics } });
  spoken.forEach((s, i) => {
    const messageId = workContextMessageId(input.considerationId, i);
    append.push({ ...base, actor: PM, type: "pm_spoke", idempotencyKey: `wc:${input.considerationId}:say:${i}`, payload: { considerationId: input.considerationId, messageId, text: s.text, kind: s.kind } });
    if (s.card) append.push({ ...base, actor: PM, type: "context_card_posted", payload: { messageId, card: s.card } });
  });
  return { append, problems, spoken };
}

type Emit = <K extends keyof EventPayloads>(type: K, payload: EventPayloads[K], actor?: Actor) => void;

function itemProblem(item: unknown, state: ProjectState, wc: WorkContextState): string | undefined {
  if (!obj(item)) return "항목 형식이 올바르지 않습니다.";
  const i = item as Partial<ContextItem>;
  if (!str(i.itemId) || !str(i.title)) return "항목 id나 제목이 비었습니다.";
  if (!CONTEXT_LAYERS.includes(i.layer as ContextItem["layer"])) return `알 수 없는 레이어 ${String(i.layer)}입니다.`;
  if (!STATUSES.includes(i.status as ContextItemStatus)) return `알 수 없는 상태 ${String(i.status)}입니다.`;
  if (i.sourceMemberId !== "pm" && !state.members.has(i.sourceMemberId ?? "")) return "출처 멤버를 찾지 못했습니다.";
  if (!Array.isArray(i.sourceMessageIds) || !i.sourceMessageIds.every(id => state.messages.some(m => m.messageId === id))) return "출처 메시지를 찾지 못했습니다.";
  for (const ref of [...(i.derivedFrom ?? []), ...(i.supersededBy ? [i.supersededBy] : [])]) if (ref !== i.itemId && !wc.items.has(ref)) return `없는 항목 ${ref}을 가리킵니다.`;
  return undefined;
}
function edgeProblem(edge: unknown, wc: WorkContextState): string | undefined {
  if (!obj(edge)) return "연결 형식이 올바르지 않습니다.";
  const e = edge as Partial<ContextEdge>;
  if (!str(e.edgeId) || !EDGE_KINDS.includes(e.kind as string)) return "연결 id나 종류가 올바르지 않습니다.";
  for (const end of [e.from, e.to]) {
    const tool = typeof end === "string" && end.startsWith("tool:") ? end.slice(5) : undefined;
    if (tool ? !wc.tools.has(tool as never) : !wc.items.has(end ?? "")) return `연결 끝 ${String(end)}을 찾지 못했습니다.`;
  }
  return undefined;
}
function previewProblem(preview: unknown, wc: WorkContextState): string | undefined {
  if (!obj(preview)) return "미리보기 형식이 올바르지 않습니다.";
  const p = preview as Partial<PreviewDraft>;
  if (!str(p.previewId) || !str(p.label) || !PREVIEW_SOURCES.includes(p.source as string) || !obj(p.spec)) return "미리보기 id·이름·출처·화면이 필요합니다.";
  if (wc.previews.has(p.previewId)) return `이미 있는 미리보기 ${p.previewId}입니다.`;
  const spec = p.spec as Record<string, unknown>;
  if (!str(spec.appName) || !obj(spec.hero) || !Array.isArray(spec.formats) || !Array.isArray(spec.tabs) || !Array.isArray(spec.history)) return "미리보기 화면 데이터가 모자랍니다.";
  return undefined;
}
const emitPreview = (emit: Emit, p: PreviewDraft) => emit("preview_rendered", { previewId: p.previewId, source: p.source, label: p.label, ...(p.caption ? { caption: p.caption } : {}), ...(p.refId ? { refId: p.refId } : {}), spec: p.spec });
/** A human's own message among `sourceMessageIds`. */
const saidBy = (state: ProjectState, memberId: Id, sourceMessageIds: unknown) =>
  state.members.get(memberId)?.kind === "human" && strs(sourceMessageIds) && sourceMessageIds.some(id => state.messages.some(m => m.messageId === id && m.authorId === memberId));

function applyOp(op: WorkContextOp, state: ProjectState, wc: WorkContextState, emit: Emit): string | undefined {
  switch (op.type) {
    case "upsert_item": { const p = itemProblem(op.item, state, wc); if (p) return p; emit("context_item_upserted", { item: op.item }); return; }
    case "upsert_edge": { const p = edgeProblem(op.edge, wc); if (p) return p; emit("context_edge_upserted", { edge: op.edge }); return; }
    case "open_branch": {
      if (!wc.items.has(op.itemId)) return "분기할 항목이 없습니다.";
      if (wc.branches.has(op.itemId)) return "이미 열린 분기입니다.";
      const options = Array.isArray(op.options) ? op.options : [];
      if (options.length < 2 || new Set(options.map(o => o?.optionId)).size !== options.length || !options.every(o => obj(o) && str(o.optionId) && str(o.title) && Array.isArray(o.gains) && Array.isArray(o.risks))) return "선택지는 서로 다른 2개 이상이어야 합니다.";
      if (!str(op.question)) return "분기 질문이 비었습니다.";
      emit("context_branch_opened", { itemId: op.itemId, question: op.question, options, sourceMessageIds: strs(op.sourceMessageIds) ? op.sourceMessageIds : [] });
      return;
    }
    case "preview_branch": {
      const branch = wc.branches.get(op.itemId);
      if (!branch?.options.some(o => o.optionId === op.optionId)) return "미리 볼 선택지가 분기에 없습니다.";
      if (branch.resolved?.optionId === op.optionId) return "이미 고른 선택지는 예상 경로가 아닙니다.";
      if (!strs(op.effects)) return "예상 변화가 비었습니다.";
      if (op.preview) { const p = previewProblem(op.preview, wc); if (p) return p; emitPreview(emit, op.preview); }
      emit("context_branch_previewed", { itemId: op.itemId, optionId: op.optionId, effects: op.effects, ...(op.preview ? { previewId: op.preview.previewId } : {}), sourceMessageIds: strs(op.sourceMessageIds) ? op.sourceMessageIds : [] });
      return;
    }
    case "clear_branch_preview":
      if (wc.branches.get(op.itemId)?.preview?.optionId !== op.optionId) return "걷을 예상 경로가 없습니다.";
      emit("context_branch_preview_cleared", { itemId: op.itemId, optionId: op.optionId });
      return;
    case "resolve_branch": {
      const branch = wc.branches.get(op.itemId);
      if (!branch?.options.some(o => o.optionId === op.optionId)) return "고를 선택지가 분기에 없습니다.";
      if (branch.resolved) return "이미 정해진 분기입니다.";
      if (!saidBy(state, op.decidedBy, op.sourceMessageIds)) return "분기는 그 사람이 직접 말한 메시지로만 정합니다.";
      if (!strs(op.evidenceMemberIds ?? []) || !op.evidenceMemberIds.every(id => state.members.has(id))) return "근거 멤버를 찾지 못했습니다.";
      emit("context_branch_resolved", { itemId: op.itemId, optionId: op.optionId, decidedBy: op.decidedBy, evidenceMemberIds: op.evidenceMemberIds, sourceMessageIds: op.sourceMessageIds });
      return;
    }
    case "search_pool": {
      if (!str(op.searchId) || wc.pool.searches.has(op.searchId)) return "검색 id가 없거나 겹칩니다.";
      if (!wc.items.has(op.forItemId)) return "검색 대상 항목이 없습니다.";
      if (!strs(op.candidateIds) || !op.candidateIds.length) return "초대할 후보가 없습니다.";
      for (const id of op.candidateIds) {
        const c = wc.pool.candidates.get(id);
        if (!c) return `pool에 없는 후보 ${id}입니다.`;
        if (c.availability !== "available") return `${c.displayName}님은 지금 참여할 수 없습니다.`;
        if (wc.pool.invited.has(id)) return `${c.displayName}님은 이미 초대했습니다.`;
      }
      if (!str(op.reason) || !strs(op.steps)) return "검색 이유와 단계가 필요합니다.";
      emit("pool_search_recorded", { searchId: op.searchId, forItemId: op.forItemId, reason: op.reason, steps: op.steps, candidateIds: op.candidateIds });
      for (const candidateId of op.candidateIds) emit("pool_member_invited", { searchId: op.searchId, candidateId, memberId: poolMemberId(candidateId) });
      return;
    }
    case "generate_proposal": {
      if (!str(op.proposalId) || wc.proposals.has(op.proposalId) || !str(op.title) || !Number.isInteger(op.version)) return "Proposal id·제목·버전이 올바르지 않습니다.";
      if ([...wc.branches.values()].some(b => !b.resolved)) return "정해지지 않은 분기가 남아 있어 제안할 수 없습니다.";
      for (const id of [...(op.decisionItemIds ?? []), ...(op.filledItemIds ?? []), ...(op.inputItemIds ?? [])]) if (!wc.items.has(id)) return `없는 항목 ${id}입니다.`;
      if (!strs(op.screens)) return "화면 목록이 비었습니다.";
      if (op.preview) { const p = previewProblem(op.preview, wc); if (p) return p; emitPreview(emit, op.preview); }
      emit("proposal_generated", { proposalId: op.proposalId, version: op.version, title: op.title, decisionItemIds: op.decisionItemIds, filledItemIds: op.filledItemIds, inputItemIds: op.inputItemIds, screens: op.screens,
        ...(op.preview ? { previewId: op.preview.previewId } : {}), sourceMessageIds: strs(op.sourceMessageIds) ? op.sourceMessageIds : [] });
      return;
    }
    case "confirm_proposal": {
      if (wc.proposals.get(op.proposalId)?.status !== "generated") return "확정할 Proposal이 없습니다.";
      if (op.confirmedBy !== state.goal?.decider || !saidBy(state, op.confirmedBy, op.sourceMessageIds)) return "Proposal은 결정권자가 직접 말한 메시지로만 확정합니다.";
      if (!str(op.contextVersion)) return "맥락 버전이 비었습니다.";
      emit("proposal_confirmed", { proposalId: op.proposalId, contextVersion: op.contextVersion, confirmedBy: op.confirmedBy, sourceMessageIds: op.sourceMessageIds });
      return;
    }
    case "expand_proposal": {
      if (wc.proposals.get(op.proposalId)?.status !== "confirmed") return "확정된 Proposal만 펼칩니다.";
      const items = Array.isArray(op.items) ? op.items : [], edges = Array.isArray(op.edges) ? op.edges : [];
      // Items may refer to each other in order; check each against what is already there plus the ones before it.
      const known = new Map(wc.items);
      for (const item of items) {
        const p = itemProblem(item, state, { ...wc, items: known });
        if (p) return p;
        known.set(item.itemId, item);
      }
      for (const edge of edges) { const p = edgeProblem(edge, { ...wc, items: known }); if (p) return p; }
      for (const item of items) emit("context_item_upserted", { item });
      for (const edge of edges) emit("context_edge_upserted", { edge });
      emit("proposal_expanded", { proposalId: op.proposalId, itemIds: items.map(i => i.itemId) });
      return;
    }
    case "handoff_tools": {
      const handoffs = Array.isArray(op.handoffs) ? op.handoffs : [];
      if (!handoffs.length) return "넘길 도구가 없습니다.";
      for (const h of handoffs) {
        if (!obj(h) || !str(h.handoffId) || wc.handoffs.has(h.handoffId) || !str(h.title) || !Number.isInteger(h.round)) return "전달 id·제목·회차가 올바르지 않습니다.";
        if (!TOOLS.includes(h.toolId) || !wc.tools.has(h.toolId)) return `연결되지 않은 도구 ${String(h.toolId)}입니다.`;
        if ([...wc.handoffs.values()].some(x => x.handoff.toolId === h.toolId && x.handoff.round === h.round) || handoffs.filter(x => x.toolId === h.toolId && x.round === h.round).length > 1) return `${h.toolId}에는 ${h.round}회차를 이미 넘겼습니다.`;
        if (!strs(h.itemIds) || !h.itemIds.every(id => wc.items.has(id))) return "넘길 항목을 찾지 못했습니다.";
      }
      if (op.preview) { const p = previewProblem(op.preview, wc); if (p) return p; emitPreview(emit, op.preview); }
      for (const h of handoffs) emit("tool_handoff_sent", { handoffId: h.handoffId, toolId: h.toolId, itemIds: h.itemIds, title: h.title, round: h.round });
      return;
    }
    case "withdraw_preview":
      if (!wc.previews.has(op.previewId) || wc.previews.get(op.previewId)!.withdrawn) return "걷을 미리보기가 없습니다.";
      emit("preview_withdrawn", { previewId: op.previewId });
      return;
    case "propose_change": {
      if (!str(op.changeSetId) || wc.changeSets.has(op.changeSetId)) return "변경 묶음 id가 없거나 겹칩니다.";
      if ([...wc.changeSets.values()].some(c => c.status === "proposed")) return "아직 닫히지 않은 변경 묶음이 있습니다.";
      if (op.fromVersion !== wc.version || !str(op.toVersion)) return `현재 맥락 버전은 v${wc.version}입니다.`;
      const changes = Array.isArray(op.changes) ? op.changes : [];
      if (!changes.length || !changes.every(c => obj(c) && wc.items.has(c.itemId) && ["added", "excluded", "updated"].includes(c.change))) return "바뀌는 항목을 찾지 못했습니다.";
      if (![...(op.staleItemIds ?? []), ...(op.unaffectedItemIds ?? [])].every(id => wc.items.has(id))) return "영향 항목을 찾지 못했습니다.";
      emit("context_change_proposed", { changeSetId: op.changeSetId, fromVersion: op.fromVersion, toVersion: op.toVersion, changes, staleItemIds: op.staleItemIds, unaffectedItemIds: op.unaffectedItemIds, sourceMessageIds: strs(op.sourceMessageIds) ? op.sourceMessageIds : [] });
      return;
    }
    default: return `알 수 없는 op ${String((op as { type?: unknown }).type)}입니다.`;
  }
}

function cardProblem(card: unknown, wc: WorkContextState): string | undefined {
  if (!obj(card)) return "카드 형식이 올바르지 않습니다.";
  const c = card as ContextCard;
  switch (c.kind) {
    case "branch_options": return wc.branches.has(c.itemId) ? undefined : "카드의 분기가 없습니다.";
    case "branch_preview": return wc.branches.get(c.itemId)?.options.some(o => o.optionId === c.optionId) ? undefined : "카드의 선택지가 없습니다.";
    case "pm_steps": return !str(c.label) || !strs(c.steps) ? "단계 카드에 이름과 단계가 필요합니다." : c.searchId && !wc.pool.searches.has(c.searchId) ? "카드의 검색이 없습니다." : c.proposalId && !wc.proposals.has(c.proposalId) ? "카드의 Proposal이 없습니다." : undefined;
    case "pool_candidates": return wc.pool.searches.has(c.searchId) ? undefined : "카드의 검색이 없습니다.";
    case "proposal": case "expansion": return wc.proposals.has(c.proposalId) ? undefined : "카드의 Proposal이 없습니다.";
    case "tool_handoffs": return strs(c.handoffIds) && c.handoffIds.every(id => wc.handoffs.has(id)) ? undefined : "카드의 전달을 찾지 못했습니다.";
    case "build": return wc.builds.has(c.buildId) ? undefined : "카드의 빌드가 없습니다.";
    case "change_set": return wc.changeSets.has(c.changeSetId) ? undefined : "카드의 변경 묶음이 없습니다.";
    default: return "알 수 없는 카드입니다.";
  }
}

/** A person's 변경 적용 / 되돌리기 on a change card: the decider only, once. */
export function resolveContextChangeEvent(events: readonly LedgerEvent[], context: EventContext, changeSetId: Id, by: Id, outcome: "applied" | "reverted"): { event?: NewLedgerEvent; problem?: { code: "not_found" | "forbidden" | "invalid_state"; message: string } } {
  const state = project(events);
  const set = state.workContext?.changeSets.get(changeSetId);
  if (!set) return { problem: { code: "not_found", message: "변경 묶음을 찾지 못했습니다." } };
  if (state.goal?.decider !== by || state.members.get(by)?.kind !== "human") return { problem: { code: "forbidden", message: "변경은 결정권자만 적용하거나 되돌릴 수 있습니다." } };
  if (set.status !== "proposed") return { problem: { code: "invalid_state", message: "이미 처리한 변경입니다." } };
  return { event: { ...context, actor: { kind: "human", id: by }, type: "context_change_resolved", idempotencyKey: `change:${changeSetId}`, payload: { changeSetId, outcome, by } } };
}
