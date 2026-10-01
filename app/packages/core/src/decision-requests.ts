import type { Actor, Id, LedgerEvent, NewLedgerEvent } from "./ledger.ts";
import type { AnyEvent, DecisionEditableField, DecisionEffect, DecisionOption, DecisionOutcome, DecisionRequestKind, EventContext, EventPayloads, Priority } from "./events.ts";
import type { ProjectState } from "./projection.ts";

export type DecisionRequestStatus = "open" | DecisionOutcome;
export interface DecisionRequestState {
  request: EventPayloads["decision_requested"];
  status: DecisionRequestStatus;
  /** Ledger seq of the `decision_requested` event. */
  requestedSeq: number;
  /** Ledger time of the `decision_requested` event. Optional only so hand-built states stay valid. */
  requestedAt?: string;
  resolution?: EventPayloads["decision_resolved"];
}
export type DecisionEvent = Extract<AnyEvent, { type: "decision_requested" | "decision_resolved" }>;
type RequestPayload = EventPayloads["decision_requested"];
type ResolvedPayload = EventPayloads["decision_resolved"];

export const MIN_DECISION_OPTIONS = 2;
export const MAX_DECISION_OPTIONS = 4;
/** Default `remindAt` offset from the request. */
export const DECISION_REMIND_HOURS = 24;
/** After the single reminder, how long the request may stay unanswered before it is due to expire. */
export const DECISION_EXPIRE_HOURS_AFTER_REMIND = 24;
/** A person sees at most this many separate cards; newer requests join the most recent card. */
export const DECISION_BUNDLE_LIMIT = 3;
const EDITABLE_FIELDS: readonly DecisionEditableField[] = ["assignee", "title", "priority", "include"];
const PRIORITIES: readonly Priority[] = ["high", "normal", "low"];
const HOUR = 3_600_000;

/**
 * Q3: what happens to a request still unanswered after its one reminder.
 * `expire` (default) closes it as expired and leaves the related work paused; `apply_recommendation` applies the recommendation.
 */
export interface DecisionSettings { unanswered: "expire" | "apply_recommendation" }
export const DEFAULT_DECISION_SETTINGS: DecisionSettings = { unanswered: "expire" };

/** A "do nothing / hold" option: no effect other than `none`. */
export function isHoldOption(option: DecisionOption): boolean {
  return option.effects.every((effect) => effect.type === "none");
}

/** The open request that already covers one of these tasks (at most one open request per task). */
export function openRequestForTask(state: ProjectState, taskId: Id): DecisionRequestState | undefined {
  for (const entry of state.decisionRequests.values()) {
    if (entry.status === "open" && (entry.request.impact.taskIds.includes(taskId) || entry.request.impact.blockedTaskIds.includes(taskId))) return entry;
  }
  return undefined;
}

/** Rule violations of §2.7 for a new request against the current state; empty when the request may be recorded. */
export function decisionRequestProblems(state: ProjectState, request: RequestPayload): string[] {
  const problems: string[] = [];
  if (typeof request.requestId !== "string" || !request.requestId) problems.push("requestId가 없습니다.");
  else if (state.decisionRequests.has(request.requestId)) problems.push(`이미 있는 요청 ${request.requestId}입니다.`);
  if (state.members.get(request.targetMemberId)?.kind !== "human") problems.push("대상은 사람 멤버여야 합니다.");
  if (typeof request.question !== "string" || !request.question.trim()) problems.push("질문이 비었습니다.");
  const options = Array.isArray(request.options) ? request.options : [];
  if (options.length < MIN_DECISION_OPTIONS || options.length > MAX_DECISION_OPTIONS) problems.push(`선택지는 ${MIN_DECISION_OPTIONS}~${MAX_DECISION_OPTIONS}개여야 합니다.`);
  if (new Set(options.map((option) => option.optionId)).size !== options.length) problems.push("선택지 id가 겹칩니다.");
  if (options.length && !options.some(isHoldOption)) problems.push("하지 않음/보류 선택지가 필요합니다.");
  for (const option of options) {
    if (option.answerText === undefined) continue;
    if (typeof option.answerText !== "string" || !option.answerText.trim()) problems.push("선택지의 답이 비었습니다.");
    else if (!option.effects.some((effect) => effect.type === "answer")) problems.push("답을 담은 선택지는 답 전달 효과가 있어야 합니다.");
  }
  const recommendation = request.recommendation;
  if (!recommendation || !options.some((option) => option.optionId === recommendation.optionId)) problems.push("추천안은 선택지 중 하나여야 합니다.");
  else if (!recommendation.rationale?.trim()) problems.push("추천 근거가 비었습니다.");
  else if (!Array.isArray(recommendation.evidence) || !recommendation.evidence.every((id) => typeof id === "string" && id.length > 0)) problems.push("근거는 원장 ID여야 합니다.");
  if ((request.editable ?? []).some((field) => !EDITABLE_FIELDS.includes(field))) problems.push("편집할 수 없는 필드가 있습니다.");
  const impact = request.impact;
  if (!impact || !Array.isArray(impact.taskIds) || !Array.isArray(impact.blockedTaskIds)) problems.push("영향 작업 목록이 없습니다.");
  else {
    for (const taskId of impact.blockedTaskIds) if (!state.tasks.has(taskId)) problems.push(`없는 작업 ${taskId}을 기다리게 할 수 없습니다.`);
    for (const taskId of new Set([...impact.taskIds, ...impact.blockedTaskIds])) {
      const open = openRequestForTask(state, taskId);
      if (open) problems.push(`작업 ${taskId}에는 이미 열린 요청 ${open.request.requestId}이 있습니다.`);
    }
  }
  return problems;
}

export interface DecisionRequestInput extends Omit<RequestPayload, "remindAt"> { remindAt?: string }

/** Builds a valid `decision_requested` event or throws. `remindAt` defaults to 24 hours after `now`. */
export function createDecisionRequest(state: ProjectState, input: DecisionRequestInput, ctx: EventContext, now: Date): NewLedgerEvent {
  const payload: RequestPayload = { ...input, remindAt: input.remindAt ?? new Date(now.getTime() + DECISION_REMIND_HOURS * HOUR).toISOString() };
  const problems = decisionRequestProblems(state, payload);
  if (problems.length) throw new Error(`결정 요청이 규칙에 맞지 않습니다: ${problems.join(" ")}`);
  return { ...ctx, type: "decision_requested", actor: { kind: "pm", id: "pm" }, idempotencyKey: `decision:${payload.requestId}`, at: now.toISOString(), payload };
}

/** Why a resolution may not close its request; undefined when it may. PM/system close with withdrawn/expired only. */
function resolutionProblem(state: ProjectState, payload: ResolvedPayload, actor: Actor): string | undefined {
  const entry = state.decisionRequests.get(payload.requestId);
  if (!entry) return "없는 요청입니다.";
  if (entry.status !== "open") return "이미 닫힌 요청입니다.";
  if (payload.outcome === "withdrawn" || payload.outcome === "expired") return actor.kind === "pm" || actor.kind === "system" ? undefined : "PM만 철회하거나 만료할 수 있습니다.";
  if (payload.by !== entry.request.targetMemberId || state.members.get(payload.by)?.kind !== "human") return "요청 대상자만 답할 수 있습니다.";
  if (payload.outcome === "chose_other" && !entry.request.options.some((option) => option.optionId === payload.optionId)) return "없는 선택지입니다.";
  if (payload.outcome === "edited" && editProblem(entry.request, payload.edits)) return editProblem(entry.request, payload.edits);
  if (payload.outcome === "answered" && !payload.answerText?.trim()) return "답변이 비었습니다.";
  return undefined;
}

/**
 * Decision-request reducer for `state.decisionRequests`. `project()` calls it for both events.
 * Requests that break §2.7 rules and resolutions from anyone but the target person are ignored.
 */
export function applyDecisionEvent(state: ProjectState, event: DecisionEvent): void {
  if (event.type === "decision_requested") {
    if (decisionRequestProblems(state, event.payload).length) return;
    state.decisionRequests.set(event.payload.requestId, { request: event.payload, status: "open", requestedSeq: event.seq, requestedAt: event.at });
    return;
  }
  if (resolutionProblem(state, event.payload, event.actor)) return;
  const entry = state.decisionRequests.get(event.payload.requestId)!;
  entry.status = event.payload.outcome;
  entry.resolution = event.payload;
}

/**
 * True when the target person answered their own open request (anything but rejected/withdrawn/expired).
 * `project()` evaluates it before the reducer runs and resets the automation counter like an approved card.
 */
export function decisionApproved(state: ProjectState, event: AnyEvent): boolean {
  if (event.type !== "decision_resolved" || ["rejected", "withdrawn", "expired"].includes(event.payload.outcome)) return false;
  return resolutionProblem(state, event.payload, event.actor) === undefined;
}

/** One thing a person is asked to decide, in the `decision_requested` shape whatever event opened it. */
export interface OpenDecision {
  source: "decision_requested" | "plan_proposed" | "authority_requested";
  requestId: Id;
  kind: DecisionRequestKind;
  targetMemberId: Id;
  question: string;
  options: DecisionOption[];
  recommendation: RequestPayload["recommendation"];
  impact: RequestPayload["impact"];
  editable?: DecisionEditableField[];
  sourceMessageIds: Id[];
  remindAt?: string;
  /** Ledger seq of the request; legacy cards have none. */
  requestedSeq?: number;
}

/**
 * Open requests plus legacy `plan_proposed`/`authority_requested` cards, in the same shape.
 * Legacy cards keep answering through the existing card API; their options carry no effects.
 */
export function openDecisions(state: ProjectState): OpenDecision[] {
  const requests = [...state.decisionRequests.values()].filter((entry) => entry.status === "open").sort((a, b) => a.requestedSeq - b.requestedSeq)
    .map(({ request, requestedSeq }): OpenDecision => ({ source: "decision_requested", ...request, requestedSeq }));
  const plans = [...state.pendingPlans.values()].map((plan): OpenDecision => ({
    source: "plan_proposed", requestId: plan.proposalId, kind: "plan_change", targetMemberId: plan.forMemberId,
    question: `계획 ${plan.version}판을 승인할까요?`,
    options: [
      { optionId: "approve", label: "승인", effects: [{ type: "none" }], tradeoff: "" },
      { optionId: "reject", label: "거절", effects: [{ type: "none" }], tradeoff: "" },
    ],
    recommendation: { optionId: "approve", rationale: plan.reason, evidence: [] },
    impact: { taskIds: plan.tasks.map((task) => task.id), blockedTaskIds: [] }, sourceMessageIds: [],
  }));
  const authority = [...state.pendingAuthority.values()].map((request): OpenDecision => ({
    source: "authority_requested", requestId: request.requestId, kind: "plan_change", targetMemberId: request.personId, question: request.text,
    options: [
      { optionId: "grant", label: "허락", effects: [{ type: "none" }], tradeoff: "" },
      { optionId: "deny", label: "거절", effects: [{ type: "none" }], tradeoff: "" },
    ],
    recommendation: { optionId: "grant", rationale: request.text, evidence: request.decisionId ? [request.decisionId] : [] },
    impact: { taskIds: [], blockedTaskIds: [] }, sourceMessageIds: [],
  }));
  return [...requests, ...plans, ...authority];
}

/**
 * View-layer bundling: per person, in request order, the first three requests are their own card and every later one
 * joins the most recent card, so nobody sees more than `DECISION_BUNDLE_LIMIT` cards.
 */
export function bundleDecisions(decisions: readonly OpenDecision[]): OpenDecision[][] {
  const byPerson = new Map<Id, OpenDecision[][]>();
  for (const decision of decisions) {
    const cards = byPerson.get(decision.targetMemberId) ?? [];
    if (cards.length < DECISION_BUNDLE_LIMIT) cards.push([decision]); else cards.at(-1)!.push(decision);
    byPerson.set(decision.targetMemberId, cards);
  }
  return [...byPerson.values()].flat();
}

/** Tasks paused on a person: the latest request naming them in `blockedTaskIds` is open, or expired under the default Q3 setting. */
export function pausedTaskIds(state: ProjectState, settings: DecisionSettings = DEFAULT_DECISION_SETTINGS): Set<Id> {
  const latest = new Map<Id, DecisionRequestState>();
  for (const entry of [...state.decisionRequests.values()].sort((a, b) => a.requestedSeq - b.requestedSeq)) {
    for (const taskId of entry.request.impact.blockedTaskIds) latest.set(taskId, entry);
  }
  const paused = new Set<Id>();
  for (const [taskId, entry] of latest) {
    const task = state.tasks.get(taskId);
    if (task?.status === "checked" || task?.status === "cancelled") continue;
    if (entry.status === "open" || (entry.status === "expired" && settings.unanswered === "expire")) paused.add(taskId);
  }
  return paused;
}

/** A person's answer (`DecisionAnswer` on the web), or the PM closing the request. */
export type DecisionAnswer =
  | { by: Id; action: "approve" | "reject"; note?: string }
  | { by: Id; action: "choose"; optionId: Id; note?: string }
  | { by: Id; action: "edit"; optionId?: Id; edits: Record<string, unknown>; note?: string }
  | { by: Id; action: "answer"; text: string; note?: string }
  | { by: Id; action: "withdraw" | "expire"; note?: string };

function editProblem(request: RequestPayload, edits: Record<string, unknown> | undefined): string | undefined {
  if (!edits || !Object.keys(edits).length) return "편집 내용이 없습니다.";
  for (const [field, value] of Object.entries(edits)) {
    if (!(request.editable ?? []).includes(field as DecisionEditableField)) return `${field}은 편집할 수 없습니다.`;
    if ((field === "assignee" || field === "title") && (typeof value !== "string" || !value.trim())) return `${field} 값이 올바르지 않습니다.`;
    if (field === "priority" && !PRIORITIES.includes(value as Priority)) return "priority 값이 올바르지 않습니다.";
    if (field === "include" && (!Array.isArray(value) || !value.every((id) => typeof id === "string"))) return "include는 작업 id 목록이어야 합니다.";
  }
  return undefined;
}

type Op = Record<string, unknown>;
const opTaskId = (op: Op): unknown => op.taskId ?? (op.task as Op | undefined)?.id;

/** Applies only `editable` fields to an option's effects. The caller re-validates ops (`validOp` + `opAuthority`). */
function editEffects(effects: readonly DecisionEffect[], edits: Record<string, unknown>): DecisionEffect[] {
  const include = Array.isArray(edits.include) ? new Set(edits.include as string[]) : undefined;
  const set = (op: Op, key: string): Op => key in edits ? (key in op ? { ...op, [key]: edits[key] } : op) : op;
  const editOp = (op: Op): Op => {
    let next = set(set(set(op, "assignee"), "title"), "priority");
    if (next.task && typeof next.task === "object") next = { ...next, task: set(set(next.task as Op, "assignee"), "title") };
    return next;
  };
  return effects.flatMap((effect): DecisionEffect[] => {
    if (effect.type === "plan_ops") {
      const ops = effect.ops.filter((op) => !include || !opTaskId(op as unknown as Op) || include.has(opTaskId(op as unknown as Op) as string))
        .map((op) => editOp(op as unknown as Op) as unknown as typeof op);
      return ops.length ? [{ type: "plan_ops", ops }] : [];
    }
    if ((effect.type === "resolve_task" || effect.type === "answer") && include && !include.has(effect.taskId)) return [];
    return [effect];
  });
}

/**
 * Computes what an answer does: the effects to apply through the existing paths (`onConfirmedOperations`/`resolveTask`/answer delivery)
 * and the events to record. Throws on an answer the rules reject. Under `apply_recommendation`, expiring applies the recommendation.
 */
export function resolveDecision(state: ProjectState, requestId: Id, answer: DecisionAnswer, ctx: EventContext, settings: DecisionSettings = DEFAULT_DECISION_SETTINGS): { effects: DecisionEffect[]; events: NewLedgerEvent[] } {
  const entry = state.decisionRequests.get(requestId);
  if (!entry) throw new Error(`없는 결정 요청입니다: ${requestId}`);
  const { request } = entry;
  const option = (optionId: Id) => {
    const found = request.options.find((item) => item.optionId === optionId);
    if (!found) throw new Error(`없는 선택지입니다: ${optionId}`);
    return found;
  };
  const recommended = option(request.recommendation.optionId);
  let outcome!: DecisionOutcome; let effects: DecisionEffect[] = []; const extra: Partial<ResolvedPayload> = {};
  const metaEvents: NewLedgerEvent[] = [];
  // An option that carries its own answer (an agent's offered choice) answers the question with that text, verbatim.
  const answering = (chosen: DecisionOption): boolean => {
    if (chosen.answerText === undefined || !chosen.answerText.trim()) return false;
    outcome = "answered"; extra.optionId = chosen.optionId; extra.answerText = chosen.answerText;
    effects = chosen.effects.filter((effect) => effect.type === "answer");
    return true;
  };
  switch (answer.action) {
    case "approve":
      if (answering(recommended)) break;
      outcome = "approved"; effects = recommended.effects; extra.optionId = recommended.optionId; break;
    case "choose": {
      const chosen = option(answer.optionId);
      if (answering(chosen)) break;
      outcome = chosen.optionId === recommended.optionId ? "approved" : "chose_other"; effects = chosen.effects; extra.optionId = chosen.optionId; break;
    }
    case "edit": {
      const problem = editProblem(request, answer.edits);
      if (problem) throw new Error(problem);
      const base = answer.optionId === undefined ? recommended : option(answer.optionId);
      outcome = "edited"; effects = editEffects(base.effects, answer.edits); extra.optionId = base.optionId; extra.edits = answer.edits;
      if (typeof answer.edits.priority === "string") {
        for (const taskId of request.impact.taskIds) if (state.tasks.has(taskId)) {
          metaEvents.push({ ...ctx, type: "task_meta_set", actor: { kind: "human", id: answer.by }, idempotencyKey: `decision:${requestId}:priority:${taskId}`, payload: { taskId, priority: answer.edits.priority } });
        }
      }
      break;
    }
    case "answer": {
      outcome = "answered"; extra.answerText = answer.text;
      const carrier = [recommended, ...request.options].find((item) => item.effects.some((effect) => effect.type === "answer"));
      effects = carrier?.effects.filter((effect) => effect.type === "answer") ?? [];
      break;
    }
    case "reject": outcome = "rejected"; break;
    case "withdraw": outcome = "withdrawn"; break;
    case "expire":
      outcome = "expired";
      if (settings.unanswered === "apply_recommendation") { effects = recommended.effects; extra.optionId = recommended.optionId; }
      break;
  }
  const closing = answer.action === "withdraw" || answer.action === "expire";
  const actor: Actor = closing ? { kind: "pm", id: "pm" } : { kind: "human", id: answer.by };
  const payload: ResolvedPayload = { requestId, by: answer.by, outcome, ...extra, ...(answer.note !== undefined ? { note: answer.note } : {}) };
  const problem = resolutionProblem(state, payload, actor);
  if (problem) throw new Error(problem);
  const resolved: NewLedgerEvent = { ...ctx, type: "decision_resolved", actor, idempotencyKey: `decision:${requestId}:resolved`, payload };
  return { effects: structuredClone(effects), events: [resolved, ...metaEvents] };
}

/** Idempotency key the single reminder for a request is recorded with (e.g. on its `pm_spoke`). */
export function decisionReminderKey(requestId: Id): string { return `decision:${requestId}:remind`; }

export interface DecisionDue { requestId: Id; targetMemberId: Id; action: "remind" | "expire" }

/**
 * Open requests that need the sweep now: one reminder at `remindAt` (default request + 24h), then expiry
 * `DECISION_EXPIRE_HOURS_AFTER_REMIND` after that reminder. What expiry does is `resolveDecision(..., { action: "expire" })` + settings.
 */
export function decisionsDue(state: ProjectState, events: readonly LedgerEvent[], now: Date): DecisionDue[] {
  const reminded = new Map(events.filter((event) => event.idempotencyKey !== undefined).map((event) => [event.idempotencyKey!, event.at]));
  const due: DecisionDue[] = [];
  for (const entry of [...state.decisionRequests.values()].sort((a, b) => a.requestedSeq - b.requestedSeq)) {
    if (entry.status !== "open") continue;
    const { requestId, targetMemberId } = entry.request;
    const remindedAt = reminded.get(decisionReminderKey(requestId));
    if (remindedAt !== undefined) {
      if (now.getTime() >= Date.parse(remindedAt) + DECISION_EXPIRE_HOURS_AFTER_REMIND * HOUR) due.push({ requestId, targetMemberId, action: "expire" });
      continue;
    }
    const remindAt = entry.request.remindAt !== undefined ? Date.parse(entry.request.remindAt)
      : entry.requestedAt !== undefined ? Date.parse(entry.requestedAt) + DECISION_REMIND_HOURS * HOUR : undefined;
    if (remindAt !== undefined && now.getTime() >= remindAt) due.push({ requestId, targetMemberId, action: "remind" });
  }
  return due;
}
