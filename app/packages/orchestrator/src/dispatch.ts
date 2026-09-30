import { channelText, particle, taskName } from './channel-text.ts';
// Dispatcher (F3): judges each submitted result, records the verdict, and starts the next reserved
// task exactly once — agents through the session boundary, people through a channel sentence the
// caller posts. Relays agent questions to people and routes the answers back to the agent.
import {
  AUTOMATION_LIMIT, automationGate, limitReachedEvent, planStarts, project,
  type AnyEvent, type EventContext, type EventPayloads, type EventType, type Id, type LedgerEvent, type NewLedgerEvent, type ProjectState,
} from '@ensemble/core';
import type { LedgerStore } from '@ensemble/store';
import type { LlmProvider } from '@ensemble/llm';
import type { SendUpdateResult, TaskInstructionsInput, UpdateInstructionsInput } from '@ensemble/agents';
import { handoffEvents, judgeHandoff, reviewKey, type CitationFailure, type HandoffReview, type ResultContent, type SubmittedResult } from './handoff.ts';
import { answerChangeId, answerUpdate, buildTaskContext, fileOwnerFor, humanizeRefs, MAX_AGENT_REVISIONS, questionMessageId, relevantDecisions, revisionCount, revisionUpdate, startNotice, taskQuestions } from './context.ts';
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
}

export interface StartedTask { taskId: Id; agentId: Id; turnId: Id }
export type ResultOutcome =
  | { kind: 'skipped'; reason: string }
  /**
   * The judge could not reach a verdict (a technical failure, not a content problem): the goal's
   * decider checks the result; nothing was recorded. `citationFailures` is the PM record of what
   * could not be verified.
   */
  | { kind: 'error'; message: string; citationFailures?: CitationFailure[] }
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
        decisions: relevantDecisions(state, taskId), llm: this.options.llm, model: this.options.model });
      if (!judged.ok) return { kind: 'error', message: judged.error, ...(judged.citationFailures?.length ? { citationFailures: judged.citationFailures } : {}) };

      const { result: decided } = await this.options.store.transaction(this.options.context.projectId, (current) => {
        const now = project(current);
        if (current.some((e) => e.idempotencyKey === reviewKey(resultId)) || now.tasks.get(taskId)?.status !== 'submitted') return { append: [], result: null };
        const recorded = handoffEvents(now, judged.review, this.options.context);
        const review = recorded[0]!.payload as HandoffReview;
        if (review.verdict !== 'sufficient') return { append: recorded, result: { review, starts: [] as Id[], limited: false } };
        const starts = planStarts(project(withPending(current, recorded)), resultId, this.options.context);
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

  /** Initial approved plans use the same reservations, context and delivery as handoffs. */
  startReady(trigger: Id): Promise<{ started: StartedTask[]; notices: string[]; failures: string[] }> {
    return this.enqueue(async () => {
      const tx = await this.options.store.transaction(this.options.context.projectId, events => {
        const append = planStarts(project(events), trigger, this.options.context);
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
      const reason = `Session start failed; reconcile before retry: ${error instanceof Error ? error.message : 'unknown error'}`;
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
    if (state.members.get(agentId)?.kind !== 'agent') return { kind: 'revision', review, notice: this.revisionNotice(state, events, taskId, review) };
    if (revisionCount(events, taskId) > MAX_AGENT_REVISIONS) {
      const reason = `보완을 ${MAX_AGENT_REVISIONS}회 요청했지만 인계 조건을 채우지 못했습니다`;
      await this.options.store.transaction(this.options.context.projectId, (current) => project(current).tasks.get(taskId)?.status === 'revising'
        ? { append: [this.event('task_blocked', { taskId, reason, ...(state.goal ? { unblockBy: state.goal.decider } : {}) }, `revision-limit:${resultId}`, { kind: 'system', id: 'dispatcher' })], result: undefined }
        : { append: [], result: undefined });
      const decider = state.goal?.decider;
      const gap = review.missing[0] ? ` 남은 문제: ${humanizeRefs(review.missing[0], events)}` : '';
      const notice = `${decider ? `@${this.name(state, decider)} ` : ''}${this.name(state, agentId)}의 "${taskName(state, taskId)}" 결과가 보완 ${MAX_AGENT_REVISIONS}회 뒤에도 인계 조건을 채우지 못해 작업을 멈췄습니다. 결과를 직접 확인하거나 다시 맡겨 주세요.${gap}`;
      return { kind: 'revision', review, notice, delivery: 'blocked' };
    }
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
      const choices = options.choices?.length ? ` 선택지: ${options.choices.map((choice) => humanizeRefs(choice, events)).join(' / ')}` : '';
      const lead = `@${this.name(state, to)} "${title}" 작업을 맡은 ${agent}${particle(agent, '이/가')} 묻습니다.`;
      const text = channelText(`${lead} ${humanizeRefs(question, events)}${choices}`, state, 12);
      await this.options.store.append([
        this.event('pm_considered', { considerationId: `consider:${questionId}`, triggerId: questionId, whoseAction: to, alreadyKnows: 'no',
          evidence: [`"${title}" 담당 ${agent}${particle(agent, '이/가')} 질문하고 멈춤`], decision: 'speak', reason: '답이 있어야 작업이 이어진다', openTopics: [...state.openTopics] }, options.routeKey ?? `consider:${questionId}`),
        this.event('pm_spoke', { considerationId: `consider:${questionId}`, messageId: questionId, text, kind: 'ask' }, `spoke:${questionId}`),
      ]);
      return { questionId, to, text };
    });
  }

  /**
   * Delivers a person's answer to the oldest open question of the task: steered into the running
   * turn when the agent is on this task; when its turn already ended, a new turn on the same thread
   * carries the answer and the task resumes (`resumed`). Without that capability the answer waits
   * for the task's next turn input.
   */
  onAnswer(taskId: Id, answerText: string): Promise<{ via: 'steer' | 'next_turn'; questionId?: Id; resumed?: true }> {
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
      return { via, ...(open ? { questionId: open.questionId } : {}), ...(resumed ? { resumed: true as const } : {}) };
    });
  }
}
