// Sweep (B8, "report, don't fix"): what core's `stuckFindings` finds is turned into decision requests,
// one reminder, an expiry or a one-line check — never an automatic restart or reassignment. A timer
// (the web runtime, MD2) calls `ProjectManager.sweep(now)`; every write is keyed so a second call in
// the same day changes nothing.
import {
  createDecisionRequest, decisionReminderKey, decisionRequestProblems, formatKstDate, HUMAN_ASSIGNMENT_NEEDS_ACCEPTANCE, opAuthority, planOpsProblems, project, routeTask, stuckFindings,
  type AnyEvent, type DecisionAnswer, type DecisionOption, type DecisionRequestInput, type DecisionRequestState, type EventContext, type Id, type LedgerEvent, type NewLedgerEvent, type PlanOp, type ProjectState, type StuckFinding,
} from '@ensemble/core';
import type { LedgerStore } from '@ensemble/store';
import { channelText, particle } from './channel-text.ts';
import type { CoordinationResult } from './coordination.ts';
import { opsApplicable } from './op-validation.ts';
import type { DecideExtra } from './decision-flow.ts';

type PmPost = CoordinationResult['posts'][number];
const HOUR = 3_600_000;
const pm = { kind: 'pm' as const, id: 'pm' };
const system = { kind: 'system' as const, id: 'pm' };

export interface SweepOptions {
  store: LedgerStore;
  context: EventContext;
  /** Closes a request through the decision flow (the PM's expiry or withdrawal). */
  decide(requestId: Id, answer: DecisionAnswer, extra: DecideExtra): Promise<PmPost[]>;
  /**
   * Q2: work going to a person goes through that person's acceptance card (`assignment` request to them).
   * When false the decider is asked instead. Default `HUMAN_ASSIGNMENT_NEEDS_ACCEPTANCE` (true).
   */
  humanAssignmentNeedsAcceptance?: boolean;
}

const name = (state: ProjectState, id: Id) => state.members.get(id)?.displayName ?? id;
const hold = (tradeoff: string): DecisionOption => ({ optionId: 'hold', label: '보류', effects: [{ type: 'none' }], tradeoff });

/** Another agent the routing rules would give a stuck agent's work to (same role), if any. */
function otherCapableAgent(state: ProjectState, assignee: Id): Id | undefined {
  const member = state.members.get(assignee);
  if (member?.kind !== 'agent') return undefined;
  const members = new Map([...state.members].filter(([id]) => id !== assignee));
  const route = routeTask({ ...state, members }, { executor: 'agent', reason: 'agent_capable', note: '', role: member.role || assignee });
  return route.ok && route.routing.executor === 'agent' ? route.assignee : undefined;
}

/** `stuck_work` for work blocked 4 hours or more: the recommendation follows the block reason. */
function stuckRequest(state: ProjectState, events: readonly AnyEvent[], finding: StuckFinding, decider: Id, now: Date): { input: DecisionRequestInput; text: string } | undefined {
  const task = state.tasks.get(finding.taskId!);
  if (!task) return undefined;
  const taskId = task.spec.id, title = task.spec.title, assignee = name(state, task.spec.assignee);
  const hours = Math.max(1, Math.floor((now.getTime() - Date.parse(finding.since ?? now.toISOString())) / HOUR));
  const cancelOps: PlanOp[] = [{ type: 'cancel_task', taskId, reason: '오래 멈춘 작업을 결정권자가 취소', sourceMessageIds: [] }];
  const other = otherCapableAgent(state, task.spec.assignee);
  const reassignOps: PlanOp[] = other ? [{ type: 'reassign', taskId, assignee: other, sourceMessageIds: [] }] : [];
  const options: DecisionOption[] = [
    { optionId: 'retry', label: '다시 맡기기', effects: [{ type: 'resolve_task', taskId, action: 'retry' }], tradeoff: `${assignee}에게 멈춘 지점부터 다시 맡깁니다. 같은 이유로 다시 멈출 수 있어요.` },
    ...(other && opsApplicable(state, reassignOps, decider) ? [{ optionId: 'reassign', label: `${name(state, other)}에게 맡기기`, effects: [{ type: 'plan_ops' as const, ops: reassignOps }], tradeoff: `같은 일을 할 수 있는 다른 Agent가 이어 맡습니다. ${assignee}의 진행 맥락은 이어지지 않을 수 있어요.` }] : []),
    ...(task.results.length ? [{ optionId: 'accept', label: '지금 결과로 확인', effects: [{ type: 'resolve_task' as const, taskId, action: 'accept' as const }], tradeoff: '인계 조건을 다 채우지 못한 결과로 다음 작업이 이어집니다.' }] : []),
    ...(opsApplicable(state, cancelOps, decider) ? [{ optionId: 'cancel', label: '작업 취소', effects: [{ type: 'plan_ops' as const, ops: cancelOps }], tradeoff: '이 작업에 기대는 다음 작업도 다시 정해야 합니다.' }] : []),
    hold('작업은 멈춘 채로 둡니다.'),
  ];
  // A result already checked against twice (the revision cap) is better judged by a person than retried again.
  const capped = task.results.length > 0 && task.blocked?.prevStatus === 'revising';
  const recommended = capped ? 'accept' : 'retry';
  const rationale = capped ? '보완을 거듭해도 인계 조건을 채우지 못해 멈춘 결과라, 지금 결과를 직접 보고 확인하는 편이 빠릅니다.'
    : '작업 내용이 아니라 실행이 멈춘 경우라 같은 담당에게 다시 맡기면 이어서 진행할 수 있습니다.';
  const blockedEvent = events.findLast(e => e.type === 'task_blocked' && e.payload.taskId === taskId);
  const label = options.find(o => o.optionId === recommended)!.label;
  return {
    input: { requestId: finding.idempotencyKey, kind: 'stuck_work', targetMemberId: decider,
      question: `"${title}" 작업이 ${hours}시간 넘게 멈춰 있어요. 어떻게 할까요?`, options,
      recommendation: { optionId: recommended, rationale, evidence: blockedEvent ? [blockedEvent.id] : [] },
      impact: { taskIds: [taskId], blockedTaskIds: [taskId] }, sourceMessageIds: [] },
    text: `@${name(state, decider)} "${title}" 작업이 ${hours}시간 넘게 멈춰 있어요(${(finding.reason ?? '').replace(/[.。]\s*$/, '') || '사유 없음'}). 추천은 '${label}'입니다 — 결정 카드에서 골라 주세요.`,
  };
}

/**
 * `assignment` for todo work whose assignee left the team. The routing rules pick the recommendation: a capable
 * agent, else a person. Under Q2 (default) work recommended for a person is asked of that person (acceptance card).
 */
function assignmentRequest(state: ProjectState, finding: StuckFinding, decider: Id, needsAcceptance: boolean): { input: DecisionRequestInput; text: string } | undefined {
  const task = state.tasks.get(finding.taskId!);
  if (!task) return undefined;
  const taskId = task.spec.id, title = task.spec.title;
  const route = routeTask(state, { executor: 'agent', reason: 'agent_capable', note: '', role: task.spec.assignee }, { needsAcceptance });
  const agent = route.ok && route.routing.executor === 'agent' ? route.assignee : undefined;
  const person = route.ok && route.routing.executor === 'human' ? route.assignee ?? decider : decider;
  const target = !agent && route.ok && 'needsAcceptance' in route && route.needsAcceptance ? person : decider;
  const reassign = (assignee: Id): PlanOp[] => [{ type: 'reassign', taskId, assignee, sourceMessageIds: [] }];
  const options: DecisionOption[] = [
    ...(agent && opsApplicable(state, reassign(agent), target) ? [{ optionId: 'agent', label: `${name(state, agent)}에게 맡기기`, effects: [{ type: 'plan_ops' as const, ops: reassign(agent) }], tradeoff: 'Agent가 바로 시작할 수 있습니다.' }] : []),
    ...(opsApplicable(state, reassign(person), target) ? [{ optionId: 'person', label: person === target ? '제가 맡기' : `${name(state, person)}님이 맡기`, effects: [{ type: 'plan_ops' as const, ops: reassign(person) }], tradeoff: '사람의 일정에 이 작업이 더해집니다.' }] : []),
    hold('담당이 정해질 때까지 이 작업은 시작하지 않습니다.'),
  ];
  if (options.length < 2) return undefined;
  const recommended = options[0]!;
  return {
    input: { requestId: finding.idempotencyKey, kind: 'assignment', targetMemberId: target,
      question: `"${title}" 작업을 맡을 담당이 팀에 없어요. 누구에게 맡길까요?`, options,
      recommendation: { optionId: recommended.optionId, rationale: agent ? 'Agent가 할 수 있는 일이라 바로 맡길 수 있습니다.' : '이 일을 할 수 있는 Agent가 없어 사람이 맡아야 합니다.', evidence: [] },
      impact: { taskIds: [taskId], blockedTaskIds: [taskId] }, sourceMessageIds: [] },
    text: `@${name(state, target)} "${title}" 작업을 맡을 담당이 팀에 없어 새 담당을 정해야 해요. 추천은 '${recommended.label}'입니다 — 결정 카드에서 골라 주세요.`,
  };
}

/** An open request that no longer means anything: every existing task it names is done, or stuck work that moved on. */
function staleReason(state: ProjectState, entry: DecisionRequestState): string | undefined {
  const { impact, kind } = entry.request;
  const tasks = [...new Set([...impact.taskIds, ...impact.blockedTaskIds])].flatMap(id => state.tasks.get(id) ?? []);
  if (tasks.length && tasks.every(t => t.status === 'checked' || t.status === 'cancelled')) return '관련 작업이 이미 끝났거나 취소됐습니다';
  if (kind === 'stuck_work' && impact.blockedTaskIds.length && impact.blockedTaskIds.every(id => state.tasks.get(id)?.status !== 'blocked')) return '멈춘 작업이 이미 다시 진행 중입니다';
  return undefined;
}

/**
 * One sweep pass at `now` (§3 B8). In order: requests that lost their meaning are withdrawn; then each finding:
 * - blocked ≥ 4h without a request → `stuck_work` request to the decider with a channel line;
 * - todo work without a member assignee → `assignment` request;
 * - a person's work past its forecast finish while the deadline is at risk → a one-line check to that person;
 * - a request past `remindAt` → one reminder (its `pm_spoke` carries `decisionReminderKey`);
 * - a reminded request past its expiry → expired through the decision flow (Q3: work stays paused).
 * Nothing restarts or moves work. Each finding's key is written once, so repeated calls the same day add nothing.
 */
export async function runSweep(options: SweepOptions, now: Date): Promise<PmPost[]> {
  const { store, context } = options;
  const at = now.toISOString();
  const read = async () => { const events = await store.read({ projectId: context.projectId }) as AnyEvent[]; return { events, state: project(events) }; };
  const posts: PmPost[] = [];
  let { events, state } = await read();
  for (const entry of [...state.decisionRequests.values()]) {
    const reason = entry.status === 'open' ? staleReason(state, entry) : undefined;
    if (reason) posts.push(...await options.decide(entry.request.requestId, { by: 'pm', action: 'withdraw', note: reason }, { at }));
  }
  ({ events, state } = await read());
  const make = (type: NewLedgerEvent['type'], payload: unknown, idempotencyKey: string, actor: NewLedgerEvent['actor'] = system): NewLedgerEvent => ({ ...context, type, actor, payload, idempotencyKey, at });
  /** pm_considered + pm_spoke, plus whatever they present; written only if the key is still new. */
  const speak = async (key: string, finding: StuckFinding, whoseAction: Id, reason: string, post: PmPost, extra: { taskIds?: Id[]; requestId?: Id; spokeKey?: string; before?: NewLedgerEvent[] } = {}) => {
    const considerationId = key;
    const append: NewLedgerEvent[] = [
      ...(extra.before ?? []),
      make('pm_considered', { considerationId, triggerId: finding.idempotencyKey, whoseAction, alreadyKnows: 'no', evidence: [finding.idempotencyKey], decision: 'speak', reason, openTopics: state.openTopics }, extra.spokeKey ? `${key}:considered` : key),
      make('pm_spoke', { considerationId, messageId: `${considerationId}:0`, ...post, ...(extra.taskIds?.length ? { taskIds: extra.taskIds } : {}), ...(extra.requestId ? { requestId: extra.requestId } : {}) }, extra.spokeKey ?? `${key}:0`, pm),
    ];
    const tx = await store.transaction(context.projectId, (current: readonly LedgerEvent[]) => current.some(e => e.idempotencyKey === finding.idempotencyKey)
      ? { append: [], result: false } : { append, result: true });
    if (tx.result) posts.push(post);
  };
  for (const finding of stuckFindings(state, events, now)) {
    ({ events, state } = await read());
    if (events.some(e => e.idempotencyKey === finding.idempotencyKey)) continue;
    const task = finding.taskId ? state.tasks.get(finding.taskId) : undefined;
    switch (finding.rule) {
      case 'blocked': case 'unassigned': {
        if (!finding.memberId) break;
        const built = finding.rule === 'blocked' ? stuckRequest(state, events, finding, finding.memberId, now)
          : assignmentRequest(state, finding, finding.memberId, options.humanAssignmentNeedsAcceptance ?? HUMAN_ASSIGNMENT_NEEDS_ACCEPTANCE);
        if (!built || decisionRequestProblems(state, built.input).length) break;
        // The request carries the finding's key: the same finding never opens a second request that day.
        const request = { ...createDecisionRequest(state, built.input, context, now), idempotencyKey: finding.idempotencyKey };
        await speak(`${finding.idempotencyKey}:notice`, finding, built.input.targetMemberId, finding.rule === 'blocked' ? '오래 멈춘 작업을 어떻게 할지 결정권자가 정해야 한다' : '담당이 없는 작업의 새 담당을 정해야 한다',
          { kind: 'ask', text: channelText(built.text, state, 4) }, { taskIds: built.input.impact.taskIds, requestId: built.input.requestId, before: [request] });
        break;
      }
      case 'human_overdue': {
        if (!task || !finding.memberId) break;
        const finish = finding.since ? formatKstDate(finding.since) : '';
        const text = `@${name(state, finding.memberId)} "${task.spec.title}"${particle(task.spec.title, '이/가')} 예상한 완료 시점(${finish})을 넘겼어요. 언제쯤 끝날지 알려 주시겠어요?`;
        await speak(finding.idempotencyKey, finding, finding.memberId, '사람이 맡은 작업이 예상 완료를 넘겨 기한에 영향이 있다', { kind: 'ask', text }, { taskIds: [task.spec.id] });
        break;
      }
      case 'decision_remind': {
        const entry = finding.requestId ? state.decisionRequests.get(finding.requestId) : undefined;
        if (!entry || entry.status !== 'open') break;
        const target = entry.request.targetMemberId;
        const text = `@${name(state, target)} 아직 답을 기다리는 결정이 있어요: ${entry.request.question}`;
        const taskIds = entry.request.impact.taskIds.filter(id => state.tasks.has(id));
        await speak(decisionReminderKey(entry.request.requestId), finding, target, '답이 없는 결정 요청을 한 번만 다시 알린다', { kind: 'ask', text },
          { taskIds, requestId: entry.request.requestId, spokeKey: decisionReminderKey(entry.request.requestId) });
        break;
      }
      case 'decision_expire': {
        if (!finding.requestId) break;
        posts.push(...await options.decide(finding.requestId, { by: 'pm', action: 'expire', note: '리마인드 뒤에도 답이 없어 만료' }, { idempotencyKey: finding.idempotencyKey, at }));
        break;
      }
    }
  }
  return posts;
}
