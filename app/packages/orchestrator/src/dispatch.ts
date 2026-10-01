import { channelText, particle, taskName } from './channel-text.ts';
// Dispatcher (F3): judges each submitted result, records the verdict, and starts the next reserved
// task exactly once — agents through the session boundary, people through a channel sentence the
// caller posts. Relays agent questions to people and routes the answers back to the agent.
import {
  AUTOMATION_LIMIT, automationGate, createDecisionRequest, decisionRequestProblems, DEFAULT_DECISION_SETTINGS, isStaleResult, limitReachedEvent, MAX_DECISION_OPTIONS, pausedTaskIds, planStarts, project, resolveDecision,
  type AnyEvent, type DecisionSettings, type DecisionRequestInput, type EventContext, type EventPayloads, type EventType, type Id, type LedgerEvent, type NewLedgerEvent, type ProjectState,
} from '@ensemble/core';
import type { LedgerStore } from '@ensemble/store';
import type { LlmProvider } from '@ensemble/llm';
import type { SendUpdateResult, TaskInstructionsInput, UpdateInstructionsInput } from '@ensemble/agents';
import { handoffEvents, judgeHandoff, reviewKey, type CitationFailure, type HandoffReview, type ResultContent, type SubmittedResult } from './handoff.ts';
import { answerChangeId, answerUpdate, buildTaskContext, fileOwnerFor, humanizeRefs, MAX_REVISIONS, questionMessageId, relevantDecisions, revisionCount, revisionUpdate, startNotice, taskQuestions } from './context.ts';
import type { Delivery } from './session-runner.ts';

/** The part of a SessionConnector (or SessionRunner) the dispatcher drives. */
export interface TaskStarter {
  startTask(agentId: string, input: TaskInstructionsInput): Promise<string>;
  sendUpdate(agentId: string, input: UpdateInstructionsInput): Promise<SendUpdateResult>;
  /** Steers into the live turn or starts a new turn on the same thread (SessionRunner.deliver). */
  deliver?(agentId: string, taskId: Id, input: UpdateInstructionsInput): Promise<Delivery>;
}

export interface DispatcherOptions {
  store: LedgerStore;
  connector: TaskStarter;
  llm: LlmProvider;
  model: string;
  context: EventContext;
  /** Loads the result files named by artifactIds; a missing file maps to null. */
  readResult(result: SubmittedResult): Promise<ResultContent>;
  /** Ledger time for decision requests (their reminder is due 24 hours later). */
  clock?: () => Date;
  /** Q3: whether work held by an expired decision request stays paused (`pausedTaskIds`). */
  decisionSettings?: DecisionSettings;
}

/**
 * `planStarts` without the work a decision request holds (core `pausedTaskIds`: an open request, or under Q3's
 * default an expired one): that work waits for a person and is never started automatically.
 */
function unpausedStarts(state: ProjectState, trigger: Id, ctx: EventContext, settings: DecisionSettings): NewLedgerEvent[] {
  const paused = pausedTaskIds(state, settings);
  if (!paused.size) return planStarts(state, trigger, ctx);
  const tasks = new Map([...state.tasks].map(([id, task]) => [id, paused.has(id) && task.status === 'ready' ? { ...task, status: 'waiting' as const } : task]));
  return planStarts({ ...state, tasks }, trigger, ctx);
}

/** The decision request that carries an agent question to the person who answers it (B7). */
export const questionRequestId = (questionId: Id) => `missing-info:${questionId}`;

export interface StartedTask { taskId: Id; agentId: Id; turnId: Id }
export type ResultOutcome =
  | { kind: 'skipped'; reason: string }
  /**
   * The judge could not reach a verdict (a technical failure, not a content problem): the goal's
   * decider checks the result; nothing was recorded. `cause` names why in people's words (M12 W2);
   * `citationFailures` is the PM record of what could not be verified.
   */
  | { kind: 'error'; message: string; cause: string; citationFailures?: CitationFailure[] }
  /**
   * A predecessor is not checked yet: the submission stays recorded and unjudged, and is judged when
   * the predecessors are checked. `notice` (empty for agents) tells the submitter what it waits on.
   */
  | { kind: 'deferred'; waitingOn: Id[]; notice: string }
  /**
   * `delivery` says how an agent's revision request reached it: steered into its live turn, carried
   * by a new turn, left for deliverPendingChanges, or not sent because the task hit the revision cap
   * and is blocked for a person (`notice` is then addressed to the goal's decider).
   */
  | { kind: 'revision'; review: HandoffReview; notice: string; delivery?: 'steer' | 'next_turn' | 'pending' | 'blocked' }
  | { kind: 'checked'; review: HandoffReview; started: StartedTask[]; notices: string[]; failures: string[]; limitNotice?: string };

const pm = { kind: 'pm' as const, id: 'pm' };
const typed = (events: readonly LedgerEvent[]) => events as readonly AnyEvent[];

/** Give not-yet-appended events a position so they can be projected on top of the ledger. */
function withPending(events: readonly LedgerEvent[], pending: NewLedgerEvent[]): LedgerEvent[] {
  const last = events.at(-1)?.seq ?? 0;
  return [...events, ...pending.map((event, i) => ({ ...event, id: `pending-${i}`, seq: last + i + 1, at: event.at ?? '' }))];
}

/**
 * A person's requests on a checked result they reopened, not yet answered by a new check (M11 T3): the
 * resubmission is judged against them as well, so "보완본을 확인했어요" means the request was met.
 */
export function reopenRequests(events: readonly LedgerEvent[], taskId: Id): string[] {
  const all = typed(events);
  const checks = all.filter((e) => e.type === 'task_checked' && e.payload.taskId === taskId);
  const lastCheck = checks.at(-1)?.seq ?? 0;
  return all.flatMap((e) => e.type === 'revision_requested' && e.payload.taskId === taskId && e.actor.kind === 'human' && e.seq > lastCheck
    && checks.some((c) => c.type === 'task_checked' && c.payload.resultId === e.payload.resultId) ? e.payload.missing : []);
}

export class Dispatcher {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: DispatcherOptions) {}

  /** Operations run one at a time, so a duplicate trigger always sees the first one's writes. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private event<K extends EventType>(type: K, payload: EventPayloads[K], idempotencyKey: string, actor: NewLedgerEvent['actor'] = pm): NewLedgerEvent {
    return { ...this.options.context, type, actor, payload, idempotencyKey };
  }
  private async ledger(): Promise<{ events: LedgerEvent[]; state: ProjectState }> {
    const events = await this.options.store.read({ projectId: this.options.context.projectId });
    return { events, state: project(events) };
  }
  private name(state: ProjectState, id: Id): string { return state.members.get(id)?.displayName ?? id; }

  onResultSubmitted(taskId: Id, resultId: Id): Promise<ResultOutcome> {
    return this.enqueue(async () => {
      const { events, state } = await this.ledger();
      const result = typed(events).find((e): e is Extract<AnyEvent, { type: 'result_submitted' }> => e.type === 'result_submitted' && e.payload.resultId === resultId)?.payload;
      const task = state.tasks.get(taskId);
      if (!task || !result || result.taskId !== taskId) return { kind: 'skipped', reason: `Unknown result ${resultId} for task ${taskId}` };
      if (events.some((e) => e.idempotencyKey === reviewKey(resultId))) return { kind: 'skipped', reason: `Result ${resultId} was already reviewed` };
      if (task.status !== 'submitted' || task.results.at(-1)?.resultId !== resultId) return { kind: 'skipped', reason: `Result ${resultId} is not the task's pending submission` };
      // A result built before its inputs were accepted is kept but not judged yet: checking it now
      // would start the next task on top of unaccepted work.
      const waitingOn = task.spec.dependsOn.filter((id) => { const dep = state.tasks.get(id)?.status; return dep !== undefined && dep !== 'checked' && dep !== 'cancelled'; });
      if (waitingOn.length) return { kind: 'deferred', waitingOn, notice: this.waitNotice(state, events, taskId, resultId, waitingOn) };

      const judged = await judgeHandoff({ state, result, resultContent: await this.options.readResult(result),
        decisions: relevantDecisions(state, taskId), llm: this.options.llm, model: this.options.model, requests: reopenRequests(events, taskId) });
      if (!judged.ok) return { kind: 'error', message: judged.error, cause: judged.cause, ...(judged.citationFailures?.length ? { citationFailures: judged.citationFailures } : {}) };

      const { result: decided } = await this.options.store.transaction(this.options.context.projectId, (current) => {
        const now = project(current);
        if (current.some((e) => e.idempotencyKey === reviewKey(resultId)) || now.tasks.get(taskId)?.status !== 'submitted') return { append: [], result: null };
        const recorded = handoffEvents(now, judged.review, this.options.context);
        const review = recorded[0]!.payload as HandoffReview;
        if (review.verdict !== 'sufficient') return { append: recorded, result: { review, starts: [] as Id[], limited: false } };
        const starts = unpausedStarts(project(withPending(current, recorded)), resultId, this.options.context, this.options.decisionSettings ?? DEFAULT_DECISION_SETTINGS);
        const after = project(withPending(current, [...recorded, ...starts]));
        const withheld = !automationGate(after).allowed && [...after.tasks.values()].some((t) => t.status === 'ready');
        const limit = withheld ? limitReachedEvent(after, this.options.context) : null;
        return { append: [...recorded, ...starts, ...(limit ? [limit] : [])],
          result: { review, starts: starts.map((e) => (e.payload as EventPayloads['task_start_reserved']).taskId), limited: limit !== null } };
      });
      if (!decided) return { kind: 'skipped', reason: `Result ${resultId} was already reviewed` };
      const { review } = decided;
      if (review.verdict === 'insufficient') return this.requestRevision(taskId, resultId, review);

      const outcome: Extract<ResultOutcome, { kind: 'checked' }> = { kind: 'checked', review, started: [], notices: [], failures: [] };
      if (decided.limited) outcome.limitNotice = `PM 자동 행동이 상한(${AUTOMATION_LIMIT}회)에 닿아 다음 작업 시작을 멈췄습니다. 확인 후 재개해 주세요.`;
      for (const nextId of decided.starts) await this.start(nextId, outcome);
      return outcome;
    });
  }

  /**
   * The goal's decider accepts a stopped task's current result as it is (M11 T1 "이대로 확인"): the
   * task resumes if blocked, its latest result is resubmitted under the current plan when it is not the
   * pending, current submission, and it is checked with the decider's reason. Then the next tasks
   * start exactly as after a sufficient review. No handoff review is recorded: no judgement was made.
   */
  acceptResult(taskId: Id, by: Id, reason: string, key: string): Promise<Extract<ResultOutcome, { kind: 'checked' }>> {
    return this.enqueue(async () => {
      const actor = { kind: 'human' as const, id: by };
      const { result: decided } = await this.options.store.transaction(this.options.context.projectId, (current) => {
        const now = project(current);
        const task = now.tasks.get(taskId);
        const latest = task?.results.at(-1);
        if (!task || !latest || !now.plan || !['blocked', 'submitted', 'revising'].includes(task.status)) return { append: [], result: null };
        const append: NewLedgerEvent[] = [];
        if (task.status === 'blocked') append.push(this.event('task_resumed', { taskId }, `${key}:resume`, actor));
        const resumed = project(withPending(current, append)).tasks.get(taskId)!;
        let resultId = latest.resultId;
        if (resumed.status !== 'submitted' || isStaleResult(resumed, resultId)) {
          const previous = typed(current).findLast((e): e is Extract<AnyEvent, { type: 'result_submitted' }> => e.type === 'result_submitted' && e.payload.resultId === latest.resultId)!.payload;
          resultId = `result:${key}`;
          append.push(this.event('result_submitted', { taskId, resultId, planVersion: now.plan.version, summary: previous.summary, artifactIds: previous.artifactIds }, resultId, actor));
        }
        append.push(this.event('task_checked', { taskId, resultId, reason }, `checked:${resultId}`, actor));
        const starts = unpausedStarts(project(withPending(current, append)), resultId, this.options.context, this.options.decisionSettings ?? DEFAULT_DECISION_SETTINGS);
        const after = project(withPending(current, [...append, ...starts]));
        const withheld = !automationGate(after).allowed && [...after.tasks.values()].some((t) => t.status === 'ready');
        const limit = withheld ? limitReachedEvent(after, this.options.context) : null;
        return { append: [...append, ...starts, ...(limit ? [limit] : [])],
          result: { resultId, starts: starts.map((e) => (e.payload as EventPayloads['task_start_reserved']).taskId), limited: limit !== null } };
      });
      if (!decided) throw new Error('확인할 결과가 없어 작업을 확인하지 못했습니다.');
      const review: HandoffReview = { taskId, resultId: decided.resultId, verdict: 'sufficient', met: [], missing: [], evidence: [reason] };
      const outcome: Extract<ResultOutcome, { kind: 'checked' }> = { kind: 'checked', review, started: [], notices: [], failures: [] };
      if (decided.limited) outcome.limitNotice = `PM 자동 행동이 상한(${AUTOMATION_LIMIT}회)에 닿아 다음 작업 시작을 멈췄습니다. 확인 후 재개해 주세요.`;
      for (const nextId of decided.starts) await this.start(nextId, outcome);
      return outcome;
    });
  }

  /** A reserved task whose start failed (and was blocked) is started again after a person hands it back. */
  startReserved(taskId: Id): Promise<{ started: StartedTask[]; notices: string[]; failures: string[] }> {
    return this.enqueue(async () => {
      const outcome = { started: [] as StartedTask[], notices: [] as string[], failures: [] as string[] };
      if ((await this.ledger()).state.tasks.get(taskId)?.status === 'reserved') await this.start(taskId, outcome);
      return outcome;
    });
  }

  /** Initial approved plans use the same reservations, context and delivery as handoffs. */
  startReady(trigger: Id): Promise<{ started: StartedTask[]; notices: string[]; failures: string[] }> {
    return this.enqueue(async () => {
      const tx = await this.options.store.transaction(this.options.context.projectId, events => {
        const append = unpausedStarts(project(events), trigger, this.options.context, this.options.decisionSettings ?? DEFAULT_DECISION_SETTINGS);
        const after = project(withPending(events, append));
        const limit = !automationGate(after).allowed && [...after.tasks.values()].some(t => t.status === 'ready') ? limitReachedEvent(after, this.options.context) : null;
        return { append: [...append, ...(limit ? [limit] : [])], result: { ids: append.map(e => (e.payload as EventPayloads['task_start_reserved']).taskId), limited: !!limit } };
      });
      const outcome = { started: [] as StartedTask[], notices: [] as string[], failures: [] as string[] };
      if (tx.result.limited) outcome.notices.push(`PM 자동 행동이 상한(${AUTOMATION_LIMIT}회)에 닿아 다음 작업 시작을 멈췄습니다. 확인 후 재개해 주세요.`);
      for (const id of tx.result.ids) await this.start(id, outcome);
      return outcome;
    });
  }

  private async start(taskId: Id, outcome: { started: StartedTask[]; notices: string[]; failures: string[] }): Promise<void> {
    const { events, state } = await this.ledger();
    const task = state.tasks.get(taskId)!;
    const assignee = task.spec.assignee;
    const input = buildTaskContext(state, taskId, events);
    if (state.members.get(assignee)?.kind !== 'agent') {

      outcome.notices.push(startNotice(state, taskId) ?? `@${this.name(state, assignee)} ${task.spec.title}${particle(task.spec.title)} 시작할 수 있습니다.`);
      return;
    }
    try {
      const turnId = await this.options.connector.startTask(assignee, input);
      await this.options.store.append([this.event('task_started', { taskId, turnId }, `turn:${turnId}`, { kind: 'agent', id: assignee })]);
      outcome.started.push({ taskId, agentId: assignee, turnId });
    } catch (error) {
      // Keep the reservation: delivery may be ambiguous, so a person reconciles before any retry.
      const reason = `Agent 작업을 시작하지 못했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}. 상태를 확인한 뒤 다시 맡겨 주세요`;
      await this.options.store.append([this.event('task_blocked', { taskId, reason },
        `start-failed:${this.options.context.projectId}:${taskId}:v${input.planVersion}`, { kind: 'system', id: 'dispatcher' })]);
      outcome.failures.push(`${task.spec.title} 작업을 시작하지 못했습니다. 연결 상태를 확인해 주세요.`);
    }
  }

  /**
   * A person's revision request is the channel notice. An agent gets it the same way as answers and
   * changes: steered into its live turn, else a new turn on its thread; it acknowledges and resubmits.
   * Past MAX_AGENT_REVISIONS the task is blocked for the goal's decider instead of looping forever.
   */
  private async requestRevision(taskId: Id, resultId: Id, review: HandoffReview): Promise<ResultOutcome> {
    const { events, state } = await this.ledger();
    const agentId = state.tasks.get(taskId)!.spec.assignee;
    // People's tasks stop at the same cap (QA4 Z7): the decider accepts or hands back instead of an endless loop.
    if (revisionCount(events, taskId) > MAX_REVISIONS) {
      const reason = `보완을 ${MAX_REVISIONS}회 요청했지만 인계 조건을 채우지 못했습니다`;
      await this.options.store.transaction(this.options.context.projectId, (current) => project(current).tasks.get(taskId)?.status === 'revising'
        ? { append: [this.event('task_blocked', { taskId, reason, ...(state.goal ? { unblockBy: state.goal.decider } : {}) }, `revision-limit:${resultId}`, { kind: 'system', id: 'dispatcher' })], result: undefined }
        : { append: [], result: undefined });
      const decider = state.goal?.decider;
      const gap = review.missing[0] ? ` 남은 문제: ${humanizeRefs(review.missing[0], events)}` : '';
      const notice = `${decider ? `@${this.name(state, decider)} ` : ''}${this.name(state, agentId)}의 "${taskName(state, taskId)}" 결과가 보완 ${MAX_REVISIONS}회 뒤에도 인계 조건을 채우지 못해 작업을 멈췄습니다. 지금 결과를 '이대로 확인'하거나 요청을 적어 '다시 맡기기'로 다시 맡겨 주세요.${gap}`;
      return { kind: 'revision', review, notice, delivery: 'blocked' };
    }
    if (state.members.get(agentId)?.kind !== 'agent') return { kind: 'revision', review, notice: this.revisionNotice(state, events, taskId, review) };
    const update = revisionUpdate(events, state.plan!.version, taskId, resultId);
    let delivery: 'steer' | 'next_turn' | 'pending' = 'pending';
    if (update) {
      try {
        if (this.options.connector.deliver) {
          const sent = await this.options.connector.deliver(agentId, taskId, update);
          if (sent.sent) delivery = sent.via;
        } else if (state.activeTurn.get(agentId) === taskId && (await this.options.connector.sendUpdate(agentId, update)).sent) delivery = 'steer';
      } catch { /* Left for deliverPendingChanges; a failed turn start already blocked the task and told a person. */ }
    }
    return { kind: 'revision', review, notice: this.revisionNotice(state, events, taskId, review, delivery !== 'pending'), delivery };
  }

  private revisionNotice(state: ProjectState, events: readonly LedgerEvent[], taskId: Id, review: HandoffReview, handedBack = false): string {
    const assignee = state.tasks.get(taskId)!.spec.assignee;
    const mention = state.members.get(assignee)?.kind === 'human' ? `@${this.name(state, assignee)} ` : '';
    const lead = handedBack ? `${taskName(state, taskId)} 결과에 보완이 필요해 ${this.name(state, assignee)}에게 다시 맡겼습니다.` : `${taskName(state, taskId)} 결과에 보완이 필요합니다.`;
    return [`${mention}${lead}`, ...review.missing.slice(0, 3).map((item) => `- ${channelText(humanizeRefs(item, events), state, 1)}`)].join('\n');
  }

  /** One line for a person whose result waits on predecessors; agents are not told (they cannot act on it). */
  private waitNotice(state: ProjectState, events: readonly LedgerEvent[], taskId: Id, resultId: Id, waitingOn: Id[]): string {
    const submitter = typed(events).findLast((e) => e.type === 'result_submitted' && e.payload.resultId === resultId)?.actor.id;
    if (!submitter || state.members.get(submitter)?.kind !== 'human') return '';
    const label: Partial<Record<string, string>> = { revising: '보완 중', running: '진행 중', reserved: '진행 중', submitted: '검토 중', blocked: '멈춰 있어', waiting: '시작 전', ready: '시작 전' };
    const first = state.tasks.get(waitingOn[0]!)!;
    const names = waitingOn.map((id) => `"${taskName(state, id)}"`).join(', ');
    const status = label[first.status] ?? '확인 전';
    return `@${this.name(state, submitter)} "${taskName(state, taskId)}" 결과는 받아 두었어요 — 선행 작업 ${names}${particle(names, '이/가')} 아직 ${status}${status.endsWith('어') ? '서' : '이라'} 확인되면 이어서 검토합니다.`;
  }

  /**
   * Records an agent's question and returns the sentence to post for the person who answers it:
   * `to`, else whoever uploaded the input file the question is about, else the goal's decider.
   * `routeKey` makes a repeated relay of the same agent report a no-op.
   */
  onQuestion(taskId: Id, question: string, options: { choices?: string[]; to?: Id; routeKey?: string } = {}): Promise<{ questionId: Id; to: Id; text: string }> {
    return this.enqueue(async () => {
      const { events, state } = await this.ledger();
      const task = state.tasks.get(taskId);
      if (!task) throw new Error(`Unknown task ${taskId}`);
      if (options.routeKey) {
        const relayed = typed(events).find((e): e is Extract<AnyEvent, { type: 'pm_considered' }> => e.type === 'pm_considered' && e.idempotencyKey === options.routeKey);
        const spoken = relayed && typed(events).find((e): e is Extract<AnyEvent, { type: 'pm_spoke' }> => e.type === 'pm_spoke' && e.payload.considerationId === relayed.payload.considerationId);
        if (relayed && spoken) return { questionId: spoken.payload.messageId, to: relayed.payload.whoseAction ?? '', text: spoken.payload.text };
      }
      const to = options.to ?? fileOwnerFor(state, events, taskId, question) ?? state.goal?.decider;
      if (!to) throw new Error('No person to ask: set a goal decider or pass `to`');
      const questionId = questionMessageId(taskId, taskQuestions(events, taskId).length + 1);
      const agent = this.name(state, task.spec.assignee);
      const title = task.spec.title;
      const offered = [...new Set((options.choices ?? []).map((choice) => humanizeRefs(choice, events).trim()).filter(Boolean))].slice(0, MAX_DECISION_OPTIONS - 1);
      const choices = offered.length ? ` 선택지: ${offered.join(' / ')}` : '';
      const lead = `@${this.name(state, to)} "${title}" 작업을 맡은 ${agent}${particle(agent, '이/가')} 묻습니다.`;
      const text = channelText(`${lead} ${humanizeRefs(question, events)}${choices}`, state, 12);
      // B7: the same question as a missing_info decision request, so the work shows as waiting on this person: the
      // agent's own choices are the card's options, each answering with its words, and the PM recommends one.
      const recommended = offered.length ? await this.recommendAnswer(state, taskId, humanizeRefs(question, events), offered, questionId) : undefined;
      const request = this.questionRequest(state, taskId, questionId, to, humanizeRefs(question, events), offered, recommended);
      await this.options.store.append([
        this.event('pm_considered', { considerationId: `consider:${questionId}`, triggerId: questionId, whoseAction: to, alreadyKnows: 'no',
          evidence: [`"${title}" 담당 ${agent}${particle(agent, '이/가')} 질문하고 멈춤`], decision: 'speak', reason: '답이 있어야 작업이 이어진다', openTopics: [...state.openTopics] }, options.routeKey ?? `consider:${questionId}`),
        ...(request ? [request] : []),
        this.event('pm_spoke', { considerationId: `consider:${questionId}`, messageId: questionId, text, kind: 'ask', taskIds: [taskId],
          ...(request ? { requestId: questionRequestId(questionId) } : {}) }, `spoke:${questionId}`),
      ]);
      return { questionId, to, text };
    });
  }

  /**
   * The PM's pick among an agent's offered answers, with its reason (§2.7: every request carries a recommendation).
   * The model reads the goal, the work's conditions and scope, and the confirmed decisions; an invalid or failed
   * answer falls back to the agent's first choice, saying the records gave no ground to prefer another.
   */
  private async recommendAnswer(state: ProjectState, taskId: Id, question: string, offered: readonly string[], questionId: Id): Promise<{ index: number; rationale: string; evidence: Id[] }> {
    const task = state.tasks.get(taskId)!;
    const decisions = relevantDecisions(state, taskId);
    const tool = { name: 'recommend_answer', description: 'Agent 질문의 선택지 중 PM이 추천할 하나와 근거', inputSchema: { type: 'object', additionalProperties: false, required: ['optionIndex', 'rationale'], properties: {
      optionIndex: { type: 'integer', minimum: 0, maximum: offered.length - 1, description: 'options 배열의 0부터 시작하는 번호' },
      rationale: { type: 'string', minLength: 1, description: '사람이 읽는 한국어 한 문장. 목표·작업 조건·범위·확정 결정에서만 근거를 든다' },
      decisionIds: { type: 'array', items: { type: 'string', enum: decisions.map((d) => d.decisionId) }, description: '근거로 쓴 확정 결정 ID(없으면 [])' },
    } } };
    const facts = { goal: state.goal?.text, deadline: state.goal?.deadline, task: { title: task.spec.title, handoffConditions: task.spec.handoffConditions, exclusions: task.spec.exclusions ?? [], limits: task.spec.limits ?? [] },
      decisions: decisions.map((d) => ({ decisionId: d.decisionId, summary: d.summary })), question, options: offered };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.options.llm.complete({ model: this.options.model, forceTool: tool.name, tools: [tool], messages: [{ role: 'user', content: JSON.stringify({ facts, attempt }) }],
          system: '당신은 팀의 PM입니다. 작업 중인 Agent가 사람에게 묻는 질문의 선택지 중 하나를 추천하세요. 목표, 작업의 인계 조건과 제외·한정 범위, 확정된 결정에 가장 맞는 선택지를 고르고, 근거가 부족하면 범위가 작고 나중에 넓히기 쉬운 쪽을 고르세요. 근거는 한국어 한 문장으로, 제공된 사실만 쓰고 내부 ID는 쓰지 마세요. 사람이 다른 답을 직접 적을 수 있으니 단정하지 마세요.' });
        const input = response.toolCalls.find((call) => call.name === tool.name)?.input as Record<string, unknown> | undefined;
        const index = input?.optionIndex;
        if (typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < offered.length && typeof input?.rationale === 'string' && input.rationale.trim()) {
          const cited = Array.isArray(input.decisionIds) ? input.decisionIds.filter((id): id is string => typeof id === 'string' && decisions.some((d) => d.decisionId === id)) : [];
          return { index, rationale: input.rationale.trim(), evidence: [questionId, ...cited] };
        }
      } catch { /* Retry once, then the fallback below. */ }
    }
    return { index: 0, rationale: '기록된 목표와 결정만으로는 어느 쪽이 나은지 가릴 근거가 없어, Agent가 먼저 제시한 안을 추천해요.', evidence: [questionId] };
  }

  /**
   * A `missing_info` request for an agent question. With the agent's own choices, each is an option that answers
   * with its words (forwarded verbatim) and the PM recommends one; without them the person answers in words.
   * Either way a typed answer still goes through, and the person may hold. Undefined when it cannot be opened — the
   * person is not a human member, or the task already waits on an open request (one per task); the channel
   * question still goes out either way.
   */
  private questionRequest(state: ProjectState, taskId: Id, questionId: Id, to: Id, question: string, offered: readonly string[] = [], recommended?: { index: number; rationale: string; evidence: Id[] }): NewLedgerEvent | undefined {
    const task = state.tasks.get(taskId);
    if (!task || state.members.get(to)?.kind !== 'human') return undefined;
    const agent = this.name(state, task.spec.assignee);
    const answer = { type: 'answer' as const, taskId, questionId };
    const hold = { optionId: 'hold', label: '보류', effects: [{ type: 'none' as const }], tradeoff: '답이 올 때까지 이 작업은 멈춰 있습니다.' };
    const choices = offered.map((label, i) => ({ optionId: `choice-${i + 1}`, label, answerText: label, effects: [answer], tradeoff: `"${label}"${particle(label, '으로/로')} 답해 Agent가 바로 이어서 진행합니다.` }));
    const pick = recommended && choices[recommended.index] ? recommended : undefined;
    const input: DecisionRequestInput = {
      requestId: questionRequestId(questionId), kind: 'missing_info', targetMemberId: to,
      question: `${agent}${particle(agent, '이/가')} "${task.spec.title}" 작업에서 묻습니다: ${question}`,
      options: choices.length && pick ? [...choices, hold]
        : [{ optionId: 'answer', label: '답하기', effects: [answer], tradeoff: '답을 그대로 전달해 Agent가 바로 이어서 진행합니다.' }, hold],
      recommendation: choices.length && pick ? { optionId: choices[pick.index]!.optionId, rationale: pick.rationale, evidence: pick.evidence }
        : { optionId: 'answer', rationale: '답이 있어야 작업이 이어집니다.', evidence: [questionId] },
      impact: { taskIds: [taskId], blockedTaskIds: [taskId] }, sourceMessageIds: [],
    };
    if (decisionRequestProblems(state, input).length) return undefined;
    return createDecisionRequest(state, input, this.options.context, (this.options.clock ?? (() => new Date()))());
  }

  /**
   * The open missing_info request for a task's question closes once its answer went out by another way (the
   * channel, a coordinator-read answer): answered when the person it asked replied, otherwise withdrawn by the PM.
   * The next unanswered question of the task, if any, gets its own request.
   */
  private questionFollowUp(events: readonly LedgerEvent[], taskId: Id, by: Id | undefined, answerText: string): NewLedgerEvent[] {
    const state = project(events);
    const append: NewLedgerEvent[] = [];
    for (const entry of state.decisionRequests.values()) {
      if (entry.status !== 'open' || entry.request.kind !== 'missing_info' || !entry.request.impact.blockedTaskIds.includes(taskId)) continue;
      const answered = by === entry.request.targetMemberId && state.members.get(by)?.kind === 'human' && !!answerText.trim();
      try { append.push(...resolveDecision(state, entry.request.requestId, answered ? { by: by!, action: 'answer', text: answerText } : { by: 'pm', action: 'withdraw', note: '다른 경로로 답이 전달됐습니다' }, this.options.context).events); }
      catch { /* A request the rules no longer let close stays as it is. */ }
    }
    const next = taskQuestions(events, taskId).find((q) => !q.answer);
    if (!next) return append;
    const after = project(withPending(events, append));
    const considered = typed(events).find((e): e is Extract<AnyEvent, { type: 'pm_considered' }> => e.type === 'pm_considered' && e.payload.considerationId === `consider:${next.questionId}`);
    const asked = considered?.payload.whoseAction;
    const request = asked ? this.questionRequest(after, taskId, next.questionId, asked, next.text.replace(/^@[^\n]*?묻습니다\.\s*/, '')) : undefined;
    return request ? [...append, request] : append;
  }

  /**
   * Delivers a person's answer to the oldest open question of the task: steered into the running
   * turn when the agent is on this task; when its turn already ended, a new turn on the same thread
   * carries the answer and the task resumes (`resumed`). Without that capability the answer waits
   * for the task's next turn input.
   */
  onAnswer(taskId: Id, answerText: string, options: { by?: Id } = {}): Promise<{ via: 'steer' | 'next_turn'; questionId?: Id; resumed?: true }> {
    return this.enqueue(async () => {
      const { events, state } = await this.ledger();
      const task = state.tasks.get(taskId);
      if (!task || !state.plan) throw new Error(`Unknown task ${taskId}`);
      const agentId = task.spec.assignee;
      const open = taskQuestions(events, taskId).find((q) => !q.answer);
      const changeId = answerChangeId(open?.questionId ?? `${questionMessageId(taskId, 0)}-${state.lastSeq}`);
      const update = answerUpdate(changeId, state.plan.version, open, answerText);
      let via: 'steer' | 'next_turn' = 'next_turn';
      let resumed = false;
      if (this.options.connector.deliver) {
        const delivery = await this.options.connector.deliver(agentId, taskId, update);
        if (delivery.sent && delivery.via === 'steer') via = 'steer';
        else resumed = delivery.sent;
      } else if (state.activeTurn.get(agentId) === taskId) {
        const sent = await this.options.connector.sendUpdate(agentId, update);
        if (sent.sent) via = 'steer';
      }
      await this.options.store.append([this.event('change_notified', { changeId, planVersion: state.plan.version, recipientId: agentId, text: answerText, via },
        `notify:${changeId}:${agentId}`)]);
      const followUp = this.questionFollowUp(await this.options.store.read({ projectId: this.options.context.projectId }), taskId, options.by, answerText);
      if (followUp.length) await this.options.store.append(followUp);
      return { via, ...(open ? { questionId: open.questionId } : {}), ...(resumed ? { resumed: true as const } : {}) };
    });
  }
}
