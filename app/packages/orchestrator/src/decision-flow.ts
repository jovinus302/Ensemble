// Decision flow (MC2): a person's answer to a PM decision request is applied through the paths that
// already exist — plan changes through `Coordinator.onConfirmedOperations`, stopped work through the
// PM's task resolution, and a missing_info answer through the dispatcher's answer relay. The rules
// (who may answer, what each answer does) are core's `resolveDecision`; this module only executes.
import {
  DEFAULT_DECISION_SETTINGS, opAuthority, planOpsProblems, project, resolveDecision,
  type AnyEvent, type DecisionAnswer, type DecisionEffect, type DecisionSettings, type EventContext, type Id, type NewLedgerEvent, type PlanOp, type ProjectState,
} from '@ensemble/core';
import type { LedgerStore } from '@ensemble/store';
import { validOp, type Coordinator, type CoordinationResult } from './coordination.ts';
import type { Dispatcher } from './dispatch.ts';

type PmPost = CoordinationResult['posts'][number];
const RESOLVABLE = ['blocked', 'submitted', 'revising'];

/** A decision answer the PM refuses, in words the person reads (Korean). `status` is the HTTP status that fits it. */
export class DecisionRequestError extends Error {
  readonly status: number;
  constructor(readonly code: 'not_found' | 'forbidden' | 'invalid_state' | 'invalid_input', message: string) {
    super(message);
    this.name = 'DecisionRequestError';
    this.status = code === 'not_found' ? 404 : code === 'forbidden' ? 403 : code === 'invalid_input' ? 400 : 409;
  }
}

export interface DecisionFlowOptions {
  store: LedgerStore;
  context: EventContext;
  coordinator: Pick<Coordinator, 'onConfirmedOperations'>;
  dispatcher: Pick<Dispatcher, 'onAnswer'>;
  /** The PM's own task resolution (accept / retry / recheck) under the same checks as the buttons. */
  resolveTask(taskId: Id, input: { action: 'accept' | 'retry' | 'recheck'; by: Id; note?: string }, trigger: string): Promise<PmPost[]>;
  /** Starts the work the applied plan ops reserved (`CoordinationResult.starts`); returns what people hear. */
  startReserved(taskIds: Id[], trigger: string, by: Id): Promise<PmPost[]>;
  /** Q3: what an unanswered request does once it expires. Default: expire and keep the work paused. */
  settings?: DecisionSettings;
}
export interface DecideExtra {
  /** Overrides the resolution's idempotency key (the sweep's finding key for an expiry). */
  idempotencyKey?: string;
  /** Ledger time of the resolution (the sweep's logical clock). */
  at?: string;
}

/** The trigger message an answer with plan changes is recorded as: the coordinator needs a person's message as authority. */
export const decisionAnswerMessageId = (requestId: Id) => `decision-answer:${requestId}`;

function answerLabel(answer: DecisionAnswer, state: ProjectState, requestId: Id): string {
  const request = state.decisionRequests.get(requestId)!.request;
  const option = (id: Id | undefined) => request.options.find(o => o.optionId === id)?.label;
  switch (answer.action) {
    case 'approve': return `추천대로 진행(${option(request.recommendation.optionId) ?? '추천안'})`;
    case 'choose': return `다른 안 선택(${option(answer.optionId) ?? '선택지'})`;
    case 'edit': return `고쳐서 승인(${option(answer.optionId ?? request.recommendation.optionId) ?? '추천안'})`;
    case 'expire': return `응답 없이 기한이 지나 설정에 따라 추천안 적용(${option(request.recommendation.optionId) ?? '추천안'})`;
    default: return '답변';
  }
}

/** Why the plan ops of an answer cannot be applied now, in Korean; undefined when they can. */
function opsProblem(state: ProjectState, ops: PlanOp[]): string | undefined {
  if (!state.plan || !state.goal) return '계획을 확정한 뒤에 이 결정을 반영할 수 있어요.';
  if (planOpsProblems(state, ops).length || !ops.every(op => validOp(op, state))) return '이 선택은 지금 계획과 맞지 않아 그대로 반영할 수 없어요. 다른 선택지를 고르거나 다시 고쳐 주세요.';
  const missing = ops.map(op => opAuthority(state, op)).find(a => !a.allowed);
  if (missing) {
    const name = missing.personId ? state.members.get(missing.personId)?.displayName ?? '담당자' : '결정권자';
    return `이 변경은 ${name}님의 승인이 필요해 이 답으로는 반영할 수 없어요.`;
  }
  return undefined;
}

/**
 * Applies a person's answer to an open decision request (§2.7):
 * 1. core `resolveDecision` decides the outcome and the effects (approve / other option / edit / reject / answer;
 *    the PM's withdraw / expire);
 * 2. plan ops — re-validated here, since an edit changes them — must be valid and authorized by the answering
 *    person before anything is recorded; resolve_task effects need the task to still be stopped;
 * 3. plan ops apply through `onConfirmedOperations` (a refusal there leaves the request open); then the resolution
 *    is recorded (closing the request releases the work waiting on it) and the remaining effects run through the
 *    existing paths: the PM's task resolution, the answer relay.
 * An already-closed request is a no-op (a repeated click). Refusals throw `DecisionRequestError`.
 */
export async function decideRequest(options: DecisionFlowOptions, requestId: Id, answer: DecisionAnswer, extra: DecideExtra = {}): Promise<PmPost[]> {
  const { store, context } = options;
  const events = await store.read({ projectId: context.projectId }) as AnyEvent[];
  const state = project(events);
  const entry = state.decisionRequests.get(requestId);
  if (!entry) throw new DecisionRequestError('not_found', '결정 요청을 찾지 못했습니다.');
  if (entry.status !== 'open') return [];
  const { request } = entry;
  const closing = answer.action === 'withdraw' || answer.action === 'expire';
  if (!closing && answer.by !== request.targetMemberId) throw new DecisionRequestError('forbidden', '결정을 요청받은 사람만 답할 수 있어요.');
  let resolved: ReturnType<typeof resolveDecision>;
  try { resolved = resolveDecision(state, requestId, answer, context, options.settings ?? DEFAULT_DECISION_SETTINGS); }
  catch (error) { throw new DecisionRequestError('invalid_input', error instanceof Error ? error.message : '답을 처리할 수 없어요.'); }
  const effects: DecisionEffect[] = resolved.effects;
  // Whose authority the effects carry: the person who answered; an expiry that applies the recommendation
  // (only under the non-default Q3 setting) acts on the target's standing consent given by that setting.
  const authority = closing ? request.targetMemberId : answer.by;
  const messageId = decisionAnswerMessageId(requestId);
  const ops = effects.flatMap(effect => effect.type === 'plan_ops' ? effect.ops : []).map(op => ({ ...op, sourceMessageIds: [messageId] }) as PlanOp);
  const message: NewLedgerEvent | undefined = ops.length ? { ...context, actor: closing ? { kind: 'system', id: 'pm' } : { kind: 'human', id: authority },
    type: 'message_recorded', idempotencyKey: `${messageId}:message`, ...(extra.at ? { at: extra.at } : {}),
    payload: { messageId, authorId: authority, text: `${answerLabel(answer, state, requestId)}: ${request.question}`, attachmentIds: [] } } : undefined;
  if (ops.length) {
    const withAnswer = structuredClone(state);
    withAnswer.messages.push({ messageId, authorId: authority, text: request.question, seq: state.lastSeq + 1 });
    const problem = opsProblem(withAnswer, ops);
    if (problem) throw new DecisionRequestError('invalid_input', problem);
  }
  for (const effect of effects) {
    if (effect.type !== 'resolve_task') continue;
    const task = state.tasks.get(effect.taskId);
    if (!task || !RESOLVABLE.includes(task.status)) throw new DecisionRequestError('invalid_state', `"${task?.spec.title ?? '작업'}" 작업은 이미 멈춘 상태가 아니라 이 결정을 반영할 수 없어요.`);
  }
  const posts: PmPost[] = [];
  let starts: Id[] = [];
  if (message) {
    // Plan changes go first: if the coordinator refuses them (a changed ledger, the automation cap), the request
    // stays open and nothing claims they were applied. One trigger message carries every op of the answer (the
    // coordinator considers a message once); it is idempotent, so a retried answer reuses it. The coordinator
    // checks the message author is the request target and records new work's origin with this request.
    await store.append([message]);
    const applied = await options.coordinator.onConfirmedOperations(messageId, ops, requestId);
    posts.push(...applied.posts);
    starts = applied.starts ?? [];
  }
  const recorded = resolved.events.map((event, i) => ({ ...event, ...(i === 0 && extra.idempotencyKey ? { idempotencyKey: extra.idempotencyKey } : {}), ...(extra.at ? { at: extra.at } : {}) }));
  const tx = await store.transaction(context.projectId, current => project(current).decisionRequests.get(requestId)?.status === 'open'
    ? { append: recorded, result: true }
    : { append: [], result: false });
  // New work the ops reserved starts once the request is closed, so it no longer reads as waiting on the person.
  if (starts.length) posts.push(...await options.startReserved(starts, messageId, authority));
  if (!tx.result) return posts;
  for (const [index, effect] of effects.entries()) {
    if (effect.type === 'resolve_task') {
      posts.push(...await options.resolveTask(effect.taskId, { action: effect.action, by: authority, ...(effect.note ? { note: effect.note } : {}) }, `${messageId}:${index}`));
    } else if (effect.type === 'answer' && answer.action === 'answer') {
      // The person's words, verbatim, through the existing relay (steer into the live turn or a new turn).
      await options.dispatcher.onAnswer(effect.taskId, answer.text, { by: answer.by });
    }
  }
  return posts;
}
