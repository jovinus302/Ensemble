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
import { handoffEvents, judgeHandoff, reviewKey, type HandoffReview, type ResultContent, type SubmittedResult } from './handoff.ts';
import { answerChangeId, buildTaskContext, questionMessageId, relevantDecisions, taskQuestions } from './context.ts';

/** The part of a SessionConnector (or SessionRunner) the dispatcher drives. */
export interface TaskStarter {
  startTask(agentId: string, input: TaskInstructionsInput): Promise<string>;
  sendUpdate(agentId: string, input: UpdateInstructionsInput): Promise<SendUpdateResult>;
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
  /** The judge could not reach a verdict; tell a person, nothing was recorded. */
  | { kind: 'error'; message: string }
  | { kind: 'revision'; review: HandoffReview; notice: string }
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

      const judged = await judgeHandoff({ state, result, resultContent: await this.options.readResult(result),
        decisions: relevantDecisions(state, taskId), llm: this.options.llm, model: this.options.model });
      if (!judged.ok) return { kind: 'error', message: judged.error };

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
      if (review.verdict === 'insufficient') return { kind: 'revision', review, notice: this.revisionNotice(state, taskId, review) };

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

      outcome.notices.push(`@${this.name(state, assignee)} ${task.spec.title}${particle(task.spec.title)} 시작할 수 있습니다.`);
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

  private revisionNotice(state: ProjectState, taskId: Id, review: HandoffReview): string {
    const assignee = state.tasks.get(taskId)!.spec.assignee;
    const mention = state.members.get(assignee)?.kind === 'human' ? `@${this.name(state, assignee)} ` : '';
    return [`${mention}${taskName(state, taskId)} 결과에 보완이 필요합니다.`, ...review.missing.slice(0, 3).map((item) => `- ${channelText(item.replace(/^인계 조건 "([^"]+)"(?:이|가) 충족되지 않았습니다\.\s*(.*)/s, '$1: $2'), state, 1)}`)].join('\n');
  }

  /**
   * Records an agent's question and returns the sentence to post for the person who answers it:
   * `to`, or else the goal's decider.
   */
  onQuestion(taskId: Id, question: string, options: { choices?: string[]; to?: Id } = {}): Promise<{ questionId: Id; to: Id; text: string }> {
    return this.enqueue(async () => {
      const { events, state } = await this.ledger();
      const task = state.tasks.get(taskId);
      if (!task) throw new Error(`Unknown task ${taskId}`);
      const to = options.to ?? state.goal?.decider;
      if (!to) throw new Error('No person to ask: set a goal decider or pass `to`');
      const questionId = questionMessageId(taskId, taskQuestions(events, taskId).length + 1);
      const choices = options.choices?.length ? ` (선택지: ${options.choices.join(' / ')})` : '';
      const text = channelText(`@${this.name(state, to)} "${task.spec.title}" 담당 ${this.name(state, task.spec.assignee)}의 질문입니다: ${question}${choices}`, state);
      await this.options.store.append([
        this.event('pm_considered', { considerationId: `consider:${questionId}`, triggerId: questionId, whoseAction: to, alreadyKnows: 'no',
          evidence: [`${taskId} 담당 에이전트가 질문하고 멈춤`], decision: 'speak', reason: '답이 있어야 작업이 이어진다', openTopics: [...state.openTopics] }, `consider:${questionId}`),
        this.event('pm_spoke', { considerationId: `consider:${questionId}`, messageId: questionId, text, kind: 'ask' }, `spoke:${questionId}`),
      ]);
      return { questionId, to, text };
    });
  }

  /**
   * Delivers a person's answer to the oldest open question of the task: steered into the running
   * turn when the agent is on this task, otherwise carried into the task's next turn input.
   */
  onAnswer(taskId: Id, answerText: string): Promise<{ via: 'steer' | 'next_turn'; questionId?: Id }> {
    return this.enqueue(async () => {
      const { events, state } = await this.ledger();
      const task = state.tasks.get(taskId);
      if (!task || !state.plan) throw new Error(`Unknown task ${taskId}`);
      const agentId = task.spec.assignee;
      const open = taskQuestions(events, taskId).find((q) => !q.answer);
      const changeId = answerChangeId(open?.questionId ?? `${questionMessageId(taskId, 0)}-${state.lastSeq}`);
      let via: 'steer' | 'next_turn' = 'next_turn';
      if (state.activeTurn.get(agentId) === taskId) {
        const version = state.plan.version;
        const sent = await this.options.connector.sendUpdate(agentId, { updateId: changeId, fromVersion: version, toVersion: version, keep: [],
          change: [open ? `질문 "${open.text}"에 대한 답: ${answerText}` : `담당자 메시지: ${answerText}`], drop: [], reason: '담당자가 질문에 답했습니다' });
        if (sent.sent) via = 'steer';
      }
      await this.options.store.append([this.event('change_notified', { changeId, planVersion: state.plan.version, recipientId: agentId, text: answerText, via },
        `notify:${changeId}:${agentId}`)]);
      return { via, ...(open ? { questionId: open.questionId } : {}) };
    });
  }
}
