import { channelText, particle } from './channel-text.ts';
import { randomUUID } from 'node:crypto';
import { automationGate, project, taskThreadId, type AnyEvent, type DecisionAnswer, type DecisionSettings, type DigestSettings, type EventContext, type NewLedgerEvent, type ProjectState, type TaskState } from '@ensemble/core';
import type { UpdateInstructionsInput } from '@ensemble/agents';
import type { SessionConnector, SessionEvent } from '@ensemble/agents';
import type { LlmProvider } from '@ensemble/llm';
import type { LedgerStore } from '@ensemble/store';
import { Coordinator, type CoordinationResult } from './coordination.ts';
import { Dispatcher, type ResultOutcome } from './dispatch.ts';
import { MAX_REVISIONS, pendingChangeUpdate, REFUSAL, retryKey, revisionCount, revisionUpdate, STATUS_LABEL, taskQuestions } from './context.ts';
import type { ResultContent, SubmittedResult } from './handoff.ts';
import { SessionRunner, type BlockedTurn } from './session-runner.ts';
import { startFreeProject, decidePlan } from './planning.ts';
import { decideAuthority } from './authority-flow.ts';
import { decideRequest, type DecideExtra, type DecisionFlowOptions } from './decision-flow.ts';
import { runSweep } from './sweep.ts';
import { runDigest } from './digest.ts';

export interface MessageAttachment { name: string; mimeType: string; content: string; contentBase64?: string; taskId?: string }
export interface ProjectManagerOptions extends EventContext {
  store: LedgerStore;
  llm: LlmProvider;
  connector: SessionConnector;
  model: string;
  clock?: () => Date;
  readResult?: (result: SubmittedResult) => Promise<ResultContent>;
  /** Agent turns running longer than this are interrupted and their task blocked. */
  turnTimeoutMs?: number;
  /** Q3: an unanswered request expires after its one reminder and its work stays paused (default), or applies the recommendation. */
  decisionSettings?: DecisionSettings;
  /** Q4: the daily digest hour (Asia/Seoul) and on/off. Default 09:00, on. */
  digestSettings?: DigestSettings;
  /** Q2: work for a person goes through that person's acceptance card. Default true (`HUMAN_ASSIGNMENT_NEEDS_ACCEPTANCE`). */
  humanAssignmentNeedsAcceptance?: boolean;
}
export type PmPost = CoordinationResult['posts'][number];

/** How a person resolves a stopped task (M11 T1): accept the current result, hand it back, or re-run its review. */
export type ResolveAction = 'accept' | 'retry' | 'recheck';
export interface ResolveTaskInput { action: ResolveAction; by: string; note?: string }
/** A request the PM refuses, in words the person reads (Korean). `status` is the HTTP status that fits it. */
export class TaskResolutionError extends Error {
  readonly status: number;
  constructor(readonly code: 'not_found' | 'forbidden' | 'invalid_state' | 'invalid_input', message: string) {
    super(message);
    this.name = 'TaskResolutionError';
    this.status = code === 'not_found' ? 404 : code === 'forbidden' ? 403 : code === 'invalid_input' ? 400 : 409;
  }
}
/** What the coordinator (coordination.ts) reads out of a person's message for the PM to carry out. */
type Resolution = { taskId: string; action: ResolveAction; note?: string };
type Reopen = { taskId: string; reason: string; announcement?: string };
/** The recorded reason of a review that could not finish; the web recognizes the stuck result by it. */
export const JUDGE_FAILURE_REASON = '결과 내용이 아니라 판단 과정의 문제라 사람이 결과를 확인해야 한다';
/** A result left in "submitted" after its handoff review failed technically (QA4 C1): nothing will judge it on its own. */
function reviewFailed(events: readonly AnyEvent[], task: TaskState): boolean {
  const resultId = task.results.at(-1)?.resultId;
  return task.status === 'submitted' && !!resultId && !events.some(e => e.idempotencyKey === `handoff:${resultId}`)
    && events.some(e => e.type === 'pm_considered' && e.idempotencyKey === `handoff-notice:${resultId}` && e.payload.reason === JUDGE_FAILURE_REASON);
}
/** A person's note ends as a sentence when the PM quotes it before its own next sentence. */
const sentence = (text: string) => (/[.!?。…~]$/.test(text) ? text : `${text}.`);

/** COMMITTED CHANGE, SOUND: one ledger-first entrypoint, identical scene/free-input routing.
 * pm-scenes.test.ts verifies handoff, acknowledgement barriers and conversational decisions.
 * SessionRunner remains the sole validator of execution-agent reports.
 */
export class ProjectManager {
  readonly sessions: SessionRunner;
  private readonly coordinator: Coordinator;
  private readonly dispatcher: Dispatcher;
  private queue: Promise<unknown> = Promise.resolve();
  private background: PmPost[] = [];
  private queued = 0;
  get isProcessing(): boolean { return this.queued > 0; }
  private failures: unknown[] = [];
  private unsubscribe: () => void;
  private context: EventContext;

  constructor(private options: ProjectManagerOptions) {
    this.context = { projectId: options.projectId, targetProductId: options.targetProductId };
    this.sessions = new SessionRunner(options.connector, options.store, this.context, { turnTimeoutMs: options.turnTimeoutMs,
      onBlocked: blocked => { void this.enqueue(() => this.blockedNotice(blocked)).then(posts => { this.background.push(...posts); }).catch(error => this.failures.push(error)); } });
    this.dispatcher = new Dispatcher({ store: options.store, llm: options.llm, model: options.model, context: this.context, clock: options.clock,
      connector: { startTask: async (agentId, input) => {
        await this.sessions.startSession(agentId);
        return this.sessions.startTask(agentId, input);
      }, sendUpdate: (agentId, input) => this.sessions.sendUpdate(agentId, input),
      deliver: (agentId, taskId, input) => this.sessions.deliver(agentId, taskId, input) }, readResult: result => this.readResult(result) });
    this.coordinator = new Coordinator(options.store, options.llm, this.sessions, { ...this.context, model: options.model, clock: options.clock });
    // Runner subscribes first. flush below ensures its asynchronous validation finished.
    this.unsubscribe = options.connector.onEvent(event => {
      void this.onSessionEvent(event).then(posts => { this.background.push(...posts); }).catch(error => this.failures.push(error));
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    this.queued++;
    const next = this.queue.then(operation).finally(() => { this.queued--; });
    this.queue = next.catch(() => undefined);
    return next;
  }
  private read() { return this.options.store.read({ projectId: this.context.projectId }); }
  startFreeProject(goal: string, deadline?: string) {
    return this.enqueue(() => startFreeProject({ ...this.options, context: this.context }, goal, deadline));
  }
  decidePlan(proposalId: string, memberId: string, approve: boolean): Promise<PmPost[]> {
    return this.enqueue(() => this.thenDeliver(decidePlan({ store: this.options.store, context: this.context, dispatcher: this.dispatcher }, proposalId, memberId, approve)));
  }
  decideAuthority(requestId: string, memberId: string, granted: boolean): Promise<PmPost[]> {
    return this.enqueue(() => this.thenDeliver(this.authorityAnswer(requestId, memberId, granted)));
  }
  /** A legacy authority card answer; work its approved ops reserved starts right after. */
  private async authorityAnswer(requestId: string, memberId: string, granted: boolean): Promise<PmPost[]> {
    const before = (await this.read()).at(-1)?.seq ?? 0;
    const posts = await decideAuthority({ store: this.options.store, context: this.context, coordinator: this.coordinator }, requestId, memberId, granted);
    const reserved = (await this.read() as AnyEvent[]).flatMap(e => e.seq > before && e.type === 'task_start_reserved' ? [e.payload.taskId] : []);
    return [...posts, ...await this.startNew(reserved, `authority-answer:${requestId}`, memberId)];
  }
  /**
   * Starts work the coordinator reserved while applying a change (new or split work routed to an agent):
   * agents through the session boundary, people through a channel line, recorded under one consideration.
   */
  private async startNew(taskIds: readonly string[], trigger: string, whoseAction: string | null): Promise<PmPost[]> {
    const lines: string[] = [];
    for (const taskId of new Set(taskIds)) {
      const started = await this.dispatcher.startReserved(taskId);
      lines.push(...started.notices, ...started.failures);
    }
    const state = project(await this.read());
    return this.speak(`start:${trigger}`, trigger, whoseAction, '변경으로 생긴 작업을 시작했다', lines.map(text => ({ kind: 'ask' as const, text: channelText(text, state, 3) })));
  }
  decideCard(cardId: string, memberId: string, approve: boolean): Promise<PmPost[]> {
    return this.enqueue(async () => {
      const events = await this.read() as AnyEvent[];
      // Decision requests share the card API: approve = the recommendation, otherwise reject.
      if (project(events).decisionRequests.has(cardId)) return this.thenDeliver(decideRequest(this.decisionFlow(), cardId, { by: memberId, action: approve ? 'approve' : 'reject' }));
      if (events.some(e => e.type === 'plan_proposed' && e.payload.proposalId === cardId)) return this.thenDeliver(decidePlan({ store: this.options.store, context: this.context, dispatcher: this.dispatcher }, cardId, memberId, approve));
      return this.thenDeliver(this.authorityAnswer(cardId, memberId, approve));
    });
  }
  /**
   * A person's answer to a decision request (approve / choose / edit / reject / answer): the effects run through
   * the existing paths and the request closes. Refusals throw `DecisionRequestError` (Korean, with an HTTP status).
   */
  decideRequest(requestId: string, answer: DecisionAnswer): Promise<PmPost[]> {
    return this.enqueue(() => this.thenDeliver(decideRequest(this.decisionFlow(), requestId, answer)));
  }
  private decisionFlow(): DecisionFlowOptions {
    return { store: this.options.store, context: this.context, coordinator: this.coordinator, dispatcher: this.dispatcher, settings: this.options.decisionSettings,
      // Already inside the PM queue: the private resolution, with a refusal said in the channel instead of failing the answer.
      resolveTask: (taskId, input, trigger) => this.fromChat(trigger, () => this.resolve(taskId, input, trigger)),
      startReserved: (taskIds, trigger, by) => this.startNew(taskIds, trigger, by) };
  }
  private now(): Date { return (this.options.clock ?? (() => new Date()))(); }

  /**
   * One stuck-work sweep (B8) at `now`: decision requests for long-blocked or unassigned work, one reminder,
   * expiry, a check on a person's overdue work. Never restarts or reassigns anything. Safe to call repeatedly.
   */
  sweep(now: Date = this.now()): Promise<PmPost[]> {
    return this.enqueue(() => this.thenDeliver(runSweep({ store: this.options.store, context: this.context,
      humanAssignmentNeedsAcceptance: this.options.humanAssignmentNeedsAcceptance,
      decide: (requestId: string, answer: DecisionAnswer, extra: DecideExtra) => decideRequest(this.decisionFlow(), requestId, answer, extra) }, now)));
  }
  /** The daily digest (B9) when it is due at `now`: at most once a day, and only when something changed. */
  digest(now: Date = this.now()): Promise<PmPost[]> {
    return this.enqueue(() => runDigest({ store: this.options.store, context: this.context, settings: this.options.digestSettings }, now));
  }

  private async thenDeliver<T>(operation: Promise<T>): Promise<T> {
    const result = await operation;
    await this.deliverPending();
    return result;
  }

  /**
   * Changes and answers recorded as `next_turn` for an agent whose task is still running but whose
   * turn already ended reach it now: a new turn on the same thread (or a steer into a live one).
   * Records made before the task's current start are already in its instructions. Idempotent: an
   * update that was sent or refused once is never sent again, across retries and restarts.
   */
  /**
   * Answers to agent questions the coordinator found in a message, even when it stayed silent in the
   * channel. Each goes out only while it is still the task's oldest open question (so an answer the
   * message routing already delivered is never sent twice) and within the automation cap.
   */
  private async deliverAgentAnswers(answers: NonNullable<CoordinationResult['agentAnswers']>, by?: string): Promise<void> {
    for (const answer of answers) {
      const events = await this.read();
      if (!automationGate(project(events)).allowed) return;
      const oldest = taskQuestions(events, answer.taskId).find(q => !q.answer);
      if (oldest?.questionId !== answer.questionId || !answer.text.trim()) continue;
      await this.dispatcher.onAnswer(answer.taskId, answer.text, { by });
    }
  }

  /**
   * B6: a person's comment on an agent's work item reaches that agent verbatim — steered into its live turn or
   * carried by a new turn — and is recorded as `change_notified`. Comments on a person's work are not forwarded
   * (the person reads the thread). Idempotent per message; the coordinator still considers the comment afterwards.
   */
  private async forwardComment(message: { messageId: string; authorId: string; text: string; threadId?: string }, state: ProjectState): Promise<void> {
    const taskId = message.threadId?.startsWith('task:') ? message.threadId.slice('task:'.length) : undefined;
    const task = taskId ? state.tasks.get(taskId) : undefined;
    if (!task || !state.plan || task.status === 'checked' || task.status === 'cancelled') return;
    const agentId = task.spec.assignee;
    if (state.members.get(agentId)?.kind !== 'agent' || !message.text.trim()) return;
    const changeId = `comment:${message.messageId}`;
    if ((await this.read() as AnyEvent[]).some(e => e.type === 'change_notified' && e.payload.changeId === changeId)) return;
    const version = state.plan.version;
    const author = state.members.get(message.authorId)?.displayName ?? message.authorId;
    // Same id and content deliverPendingChanges rebuilds from the record (a JSON update), so it never goes out twice.
    const update: UpdateInstructionsInput = { updateId: `${changeId}:${agentId}:turn`, fromVersion: version, toVersion: version, keep: [], drop: [],
      change: [`${author}의 댓글: ${message.text}`], reason: `${author}${particle(author, '이/가')} 맡은 작업에 댓글을 남겼습니다. 반영할 것이 있으면 반영하고 이어서 진행하세요` };
    let via: 'steer' | 'next_turn' = 'next_turn';
    try { const sent = await this.sessions.deliver(agentId, task.spec.id, update); if (sent.sent) via = sent.via; } catch (error) { this.failures.push(error); }
    await this.options.store.append([{ ...this.context, actor: { kind: 'pm', id: 'pm' }, type: 'change_notified', idempotencyKey: `notify:${changeId}:${agentId}`,
      payload: { changeId, planVersion: version, recipientId: agentId, text: JSON.stringify(update), via } }]);
  }

  deliverPendingChanges(): Promise<void> { return this.enqueue(() => this.deliverPending()); }
  private async deliverPending(): Promise<void> {
    const events = await this.read() as AnyEvent[];
    const state = project(events);
    const handled = new Set(events.flatMap(e => e.type === 'update_sent' || e.type === 'update_rejected' || e.type === 'update_acknowledged' ? [e.payload.updateId] : []));
    for (const event of events) {
      if (event.type !== 'change_notified' || event.payload.via !== 'next_turn') continue;
      const agentId = event.payload.recipientId;
      if (state.members.get(agentId)?.kind !== 'agent') continue;
      const running = [...state.tasks.values()].filter(t => t.spec.assignee === agentId && t.status === 'running');
      if (running.length !== 1) continue;
      const taskId = running[0]!.spec.id;
      const startedAt = events.findLast(e => e.type === 'task_start_reserved' && e.payload.taskId === taskId)?.seq ?? 0;
      if (event.seq <= startedAt) continue;
      const update = pendingChangeUpdate(events, event.payload, taskId);
      if (handled.has(update.updateId)) continue;
      handled.add(update.updateId);
      // A delivery problem never undoes the operation that recorded the change.
      try { await this.sessions.deliver(agentId, taskId, update); } catch (error) { this.failures.push(error); }
    }
    await this.deliverRevisions(events, handled);
  }

  /**
   * PM revision requests an agent has not received yet — its turn could not take one when the review
   * ended, or the server restarted in between — go out now, within the revision cap. The update is
   * rebuilt from the ledger under the same ID, so nothing is sent twice.
   */
  private async deliverRevisions(events?: AnyEvent[], handled?: Set<string>): Promise<void> {
    events ??= await this.read() as AnyEvent[];
    handled ??= new Set(events.flatMap(e => e.type === 'update_sent' || e.type === 'update_rejected' || e.type === 'update_acknowledged' ? [e.payload.updateId] : []));
    const state = project(events);
    for (const task of state.tasks.values()) {
      const agentId = task.spec.assignee;
      const resultId = task.results.at(-1)?.resultId;
      if (task.status !== 'revising' || !resultId || !state.plan || state.members.get(agentId)?.kind !== 'agent') continue;
      const requested = events.findLast(e => e.type === 'revision_requested' && e.payload.taskId === task.spec.id);
      if (requested?.type !== 'revision_requested' || requested.payload.resultId !== resultId) continue;
      if (revisionCount(events, task.spec.id) > MAX_REVISIONS) continue;
      const update = revisionUpdate(events, state.plan.version, task.spec.id, resultId);
      if (!update || handled.has(update.updateId)) continue;
      handled.add(update.updateId);
      try { await this.sessions.deliver(agentId, task.spec.id, update); } catch (error) { this.failures.push(error); }
    }
  }
  setAvailability(memberId: string, weeklyHours: number): Promise<void> {
    return this.enqueue(async () => {
      if (project(await this.read()).members.get(memberId)?.kind !== 'human') throw new Error('가용 시간은 사람 멤버만 입력할 수 있습니다');
      if (!Number.isFinite(weeklyHours) || weeklyHours < 0) throw new Error('주간 가용 시간은 0 이상의 숫자여야 합니다');
      await this.options.store.append([{ ...this.context, actor: { kind: 'human', id: memberId }, type: 'availability_updated', payload: { memberId, weeklyHours } }]);
    });
  }
  private async readResult(result: SubmittedResult): Promise<ResultContent> {
    const contents = this.options.readResult ? await this.options.readResult(result) : {};
    for (const event of await this.read() as AnyEvent[]) {
      if (event.type !== 'attachment_recorded' || !result.artifactIds.includes(event.payload.attachmentId)) continue;
      const match = /^data:[^,]*;base64,(.*)$/s.exec(event.payload.uri);
      if (match) contents[event.payload.attachmentId] = Buffer.from(match[1]!, 'base64').toString('utf8');
    }
    return contents;
  }

  /** A person's comment on a work item: a thread message (`task:<id>`), then the usual message handling (B6). */
  async postComment(taskId: string, authorId: string, text: string): Promise<PmPost[]> {
    const state = project(await this.read());
    if (!state.tasks.has(taskId)) throw new TaskResolutionError('not_found', '작업을 찾지 못했습니다.');
    if (!text.trim()) throw new TaskResolutionError('invalid_input', '댓글 내용이 비었습니다.');
    const { messageId } = await this.recordMessage(authorId, text, [], taskThreadId(taskId));
    return this.processRecordedMessage(messageId);
  }

  async recordMessage(authorId: string, text: string, attachments: MessageAttachment[] = [], threadId?: string): Promise<{ messageId: string }> {
      const before = await this.read();
      const state = project(before);
      if (state.members.get(authorId)?.kind !== 'human') throw new Error('메시지를 보낸 사람을 이 프로젝트 멤버에서 찾지 못했습니다');
      const messageId = randomUUID();
      const attachmentIds = attachments.map(() => randomUUID());
      const actor = { kind: 'human' as const, id: authorId };
      const recorded: NewLedgerEvent[] = attachments.map((a, i) => ({ ...this.context, actor, type: 'attachment_recorded', payload: { attachmentId: attachmentIds[i]!, name: a.name, mimeType: a.mimeType, uri: `data:${a.mimeType};base64,${a.contentBase64 ?? Buffer.from(a.content).toString('base64')}`, ...(a.taskId ? { taskId: a.taskId } : {}) } }));
      recorded.push({ ...this.context, actor, type: 'message_recorded', payload: { messageId, authorId, text, ...(threadId ? { threadId } : {}), attachmentIds } });
      await this.options.store.append(recorded);
      return { messageId };
  }

  async postMessage(authorId: string, text: string, attachments: MessageAttachment[] = []): Promise<PmPost[]> {
    const { messageId } = await this.recordMessage(authorId, text, attachments);
    return this.processRecordedMessage(messageId);
  }

  processRecordedMessage(messageId: string): Promise<PmPost[]> {
    return this.enqueue(async () => {
      const before = await this.read();
      if ((before as AnyEvent[]).some(e => (e.type === 'pm_considered' && e.payload.triggerId === messageId) || e.idempotencyKey === `processed:${messageId}`)) return [];
      const state = project(before);
      const message = (before as AnyEvent[]).find((e): e is Extract<AnyEvent, { type: 'message_recorded' }> => e.type === 'message_recorded' && e.payload.messageId === messageId);
      if (!message) throw new Error('기록된 사람 메시지를 찾을 수 없습니다');
      const { authorId, text, attachmentIds } = message.payload;
      await this.forwardComment(message.payload, state);
      const actor = { kind: 'human' as const, id: authorId };
      const attachments: MessageAttachment[] = (before as AnyEvent[]).flatMap(e => {
        if (e.type !== 'attachment_recorded' || !attachmentIds.includes(e.payload.attachmentId)) return [];
        const a = e.payload, match = /^data:[^,]*;base64,(.*)$/s.exec(a.uri);
        return [{ name: a.name, mimeType: a.mimeType, taskId: a.taskId, content: match ? Buffer.from(match[1]!, 'base64').toString('utf8') : '' }];
      });
      const markProcessed = async () => { await this.options.store.append([{ ...this.context, actor: { kind: 'system', id: 'pm' }, type: 'pm_considered', idempotencyKey: `processed:${messageId}`, payload: { considerationId: `processed:${messageId}`, triggerId: messageId, whoseAction: null, alreadyKnows: 'unknown', evidence: [messageId], decision: 'silent', reason: '메시지를 인계 또는 질문 답변으로 처리했다', openTopics: state.openTopics } }]); };
      // Questions put to this person, and those of an agent the message addresses by @name.
      const addressed = (agentId: string) => { const name = state.members.get(agentId)?.displayName; return !!name && text.includes(`@${name}`); };
      const pending = [...state.tasks.values()].flatMap(t => taskQuestions(before, t.spec.id).filter(q => !q.answer).map(q => ({ ...q, taskId: t.spec.id }))).filter(q =>
        (before as AnyEvent[]).some(e => e.type === 'pm_considered' && e.payload.triggerId === q.questionId && e.payload.whoseAction === authorId)
        || addressed(state.tasks.get(q.taskId)!.spec.assignee));
      // Structural metadata can identify a submission; text interpretation is model-owned.
      const declaredTasks = [...new Set(attachments.map(a => a.taskId).filter((id): id is string => !!id))];
      // Results a person may send back for another handoff review by re-attaching them: an agent's result
      // the agent is not working on now (S3), and any result stuck after a review that could not finish
      // (QA4 C1). A re-check asked for in words, "이대로 확인" or "다시 맡길게요" are the coordinator's to
      // read (resolve_task) and never land here: routing only looks at re-attached files.
      const recheckable = [...state.tasks.values()].filter(t => (state.members.get(t.spec.assignee)?.kind === 'agent' && t.results.length > 0
        && (t.status === 'revising' || (t.status === 'blocked' && t.blocked?.prevStatus === 'revising')) && state.activeTurn.get(t.spec.assignee) !== t.spec.id)
        || reviewFailed(before as AnyEvent[], t));
      const canRecheck = (taskId: unknown) => typeof taskId === 'string' && recheckable.some(t => t.spec.id === taskId);
      // A file from the person who has to resubmit a task under revision or stopped — its assignee, or the
      // goal's decider on its behalf — is that resubmission, whatever the sentence says (M12 W4): "보완본을
      // 다시 올립니다. 확인해 주세요" is not a request to resolve the task. Only one such task makes it certain.
      const resubmittable = [...state.tasks.values()].filter(t => {
        if (t.status !== 'revising' && t.status !== 'blocked') return false;
        if (t.spec.assignee === authorId) return true;
        if (state.goal?.decider !== authorId) return false;
        return state.members.get(t.spec.assignee)?.kind === 'agent' ? canRecheck(t.spec.id) : t.results.length > 0;
      });
      let route: { kind: 'chat' | 'result' | 'answer' | 'recheck'; taskId?: string; questionId?: string } = { kind: 'chat' };
      if (attachments.length && declaredTasks.length === 1 && attachments.every(a => a.taskId === declaredTasks[0])) {
        const own = state.tasks.get(declaredTasks[0]!)?.spec.assignee === authorId;
        // Someone else's task with nothing to re-check: the file is part of the conversation, never an error.
        if (own || canRecheck(declaredTasks[0])) route = { kind: own ? 'result' : 'recheck', taskId: declaredTasks[0] };
      } else if (attachments.length && !declaredTasks.length && !pending.length && resubmittable.length === 1) {
        const task = resubmittable[0]!;
        route = { kind: task.spec.assignee === authorId ? 'result' : 'recheck', taskId: task.spec.id };
      } else if (attachments.length || pending.length) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const response = await this.options.llm.complete({ model: this.options.model,
              system: '메시지를 결과 제출, 미해결 질문에 대한 답, 결과 재첨부, 일반 대화로 분류하세요. 단어 규칙 없이 의미를 해석하세요. 확실하지 않으면 chat으로 두세요. 결과는 첨부가 있는 본인 담당 작업만, 답은 제공된 미해결 질문만 선택하세요. recheck는 사람이 recheckable에 있는 작업의 결과 파일을 다시 첨부해 확인을 요청할 때만 그 taskId로 고르세요.',
              forceTool: 'route_message', tools: [{ name: 'route_message', description: '인계 또는 대화 경로 선택', inputSchema: { type: 'object', required: ['kind'], properties: { kind: { enum: ['chat', 'result', 'answer', 'recheck'] }, taskId: { type: 'string' }, questionId: { type: 'string' } } } }],
              messages: [{ role: 'user', content: JSON.stringify({ messageId, planVersion: state.plan?.version, attempt, authorId, text, attachments, tasks: [...state.tasks.values()].filter(t => t.spec.assignee === authorId).map(t => t.spec), pending,
                recheckable: recheckable.map(t => ({ taskId: t.spec.id, title: t.spec.title, assignee: state.members.get(t.spec.assignee)?.displayName, status: t.status })) }) }] });
            const input = response.toolCalls.find(c => c.name === 'route_message')?.input;
            if (input?.kind === 'chat') break;
            if (input?.kind === 'recheck' && attachments.length && canRecheck(input.taskId)) { route = { kind: 'recheck', taskId: input.taskId as string }; break; }
            if (input?.kind === 'result' && attachments.length && typeof input.taskId === 'string' && state.tasks.get(input.taskId)?.spec.assignee === authorId) { route = { kind: 'result', taskId: input.taskId }; break; }
            if (input?.kind === 'answer' && typeof input.questionId === 'string') {
              const question = pending.find(q => q.questionId === input.questionId && q.taskId === input.taskId);
              if (question) { route = { kind: 'answer', taskId: question.taskId, questionId: question.questionId }; break; }
            }
          } catch { /* Retry once, then retain ordinary conversational handling. */ }
        }
      }
      if (route.kind === 'recheck' && route.taskId) {
        const posts = await this.recheck(route.taskId, messageId, authorId, text, attachmentIds); await markProcessed(); return posts;
      }
      if (route.kind === 'result' && route.taskId) {
        const task = state.tasks.get(route.taskId);
        if (!task || task.spec.assignee !== authorId || task.status === 'cancelled') throw new Error('결과는 본인이 맡은 진행 중인 작업에만 제출할 수 있어요.');
        const resultId = `result:${messageId}`;
        // A person's own new result on a stopped task is judged again (a stale blocked state never lingers).
        await this.options.store.append([
          ...(task.status === 'blocked' ? [{ ...this.context, actor, type: 'task_resumed' as const, idempotencyKey: `resume:${resultId}`, payload: { taskId: route.taskId } }] : []),
          { ...this.context, actor, type: 'result_submitted', idempotencyKey: resultId, payload: { taskId: route.taskId, resultId, planVersion: state.plan!.version, summary: text, artifactIds: attachmentIds } }]);
        const posts = await this.review(route.taskId, resultId); await markProcessed(); return posts;
      }
      if (route.kind === 'answer' && route.taskId) {
        // Dispatcher answers the oldest open question; never silently route to another one.
        const oldest = taskQuestions(before, route.taskId).find(q => !q.answer);
        if (oldest?.questionId === route.questionId) { await this.dispatcher.onAnswer(route.taskId, text, { by: authorId }); await markProcessed(); await this.deliverPending(); return []; }
      }
      const coordinated = await this.coordinator.onMessage(messageId) as CoordinationResult & { resolutions?: Resolution[]; reopens?: Reopen[] };
      await this.deliverAgentAnswers(coordinated.agentAnswers ?? [], authorId);
      const posts = [...coordinated.posts, ...await this.startNew(coordinated.starts ?? [], messageId, authorId)];
      // The coordinator reads what the person asked for; the PM carries it out under the same checks as the buttons.
      for (const [i, r] of (coordinated.resolutions ?? []).entries()) posts.push(...await this.fromChat(messageId, () => this.resolve(r.taskId, { action: r.action, by: authorId, ...(r.note ? { note: r.note } : {}) }, `${messageId}:${i}`)));
      for (const [i, r] of (coordinated.reopens ?? []).entries()) posts.push(...await this.fromChat(messageId, () => this.reopen(r.taskId, authorId, r.reason, `${messageId}:${i}`, r.announcement)));
      await this.deliverPending();
      return posts;
    });
  }

  /**
   * Resolves a stopped task (M11 T1), from a button or an API call:
   * - accept (the goal's decider only): the current result is checked as it is, with the reason recorded;
   * - retry (the decider, the assignee or a downstream assignee): the revision count starts over and the
   *   note goes to the agent in a new turn, or to the person who owns the task;
   * - recheck (any person): the handoff review runs again on the latest result.
   * Works on blocked, submitted (a review that could not finish) and revising tasks; anything else is
   * refused with a TaskResolutionError in Korean.
   */
  resolveTask(taskId: string, input: ResolveTaskInput): Promise<PmPost[]> {
    return this.enqueue(async () => {
      const posts = await this.resolve(taskId, input, randomUUID());
      await this.deliverPending();
      return posts;
    });
  }

  /** A refusal read from chat is said in the channel instead of failing the message. */
  private async fromChat(messageId: string, run: () => Promise<PmPost[]>): Promise<PmPost[]> {
    try { return await run(); } catch (error) {
      if (!(error instanceof TaskResolutionError)) throw error;
      const state = project(await this.read());
      return this.speak(`resolve-refused:${messageId}:${randomUUID()}`, messageId, null, '요청한 처리를 할 수 없는 이유를 요청한 사람이 알아야 한다', [{ kind: 'ask', text: channelText(error.message, state, 3) }]);
    }
  }

  /** One PM record and its lines, under one idempotent consideration. */
  private async speak(considerationId: string, triggerId: string, whoseAction: string | null, reason: string, posts: PmPost[], evidence: string[] = []): Promise<PmPost[]> {
    const state = project(await this.read());
    if (!posts.length) return [];
    await this.options.store.append([
      { ...this.context, actor: { kind: 'system', id: 'pm' }, type: 'pm_considered', idempotencyKey: considerationId, payload: { considerationId, triggerId, whoseAction, alreadyKnows: 'no', evidence: [triggerId, ...evidence], decision: 'speak', reason, openTopics: state.openTopics } },
      ...posts.map((post, i) => ({ ...this.context, actor: { kind: 'system' as const, id: 'pm' }, type: 'pm_spoke' as const, idempotencyKey: `${considerationId}:${i}`, payload: { considerationId, messageId: `${considerationId}:${i}`, ...post } })),
    ]);
    return posts;
  }

  private async resolve(taskId: string, { action, by, note }: ResolveTaskInput, trigger: string): Promise<PmPost[]> {
    const events = await this.read() as AnyEvent[];
    const state = project(events);
    const task = state.tasks.get(taskId);
    const name = (id: string) => state.members.get(id)?.displayName ?? id;
    if (!task || task.status === 'cancelled') throw new TaskResolutionError('not_found', '작업을 찾지 못했습니다.');
    if (!['accept', 'retry', 'recheck'].includes(action)) throw new TaskResolutionError('invalid_input', "처리 방법은 '이대로 확인', '다시 맡기기', '다시 검토' 중 하나여야 해요.");
    if (state.members.get(by)?.kind !== 'human') throw new TaskResolutionError('forbidden', '사람 멤버만 멈춘 작업을 처리할 수 있어요.');
    const title = task.spec.title;
    const decider = state.goal?.decider;
    if (action === 'accept' && by !== decider) throw new TaskResolutionError('forbidden', REFUSAL.accept(decider ? name(decider) : undefined));
    if (action === 'retry' && !this.mayHandBack(state, taskId, by)) throw new TaskResolutionError('forbidden', REFUSAL.retry);
    if (!['blocked', 'submitted', 'revising'].includes(task.status)) throw new TaskResolutionError('invalid_state', `"${title}" 작업은 지금 ${STATUS_LABEL[task.status] ?? task.status}${particle(STATUS_LABEL[task.status] ?? '', '이/가') === '이' ? '이라' : '라'} 처리할 멈춤이 없어요.`);
    const assignee = task.spec.assignee;
    const agent = state.members.get(assignee)?.kind === 'agent';
    const latest = task.results.at(-1);
    const working = agent && state.activeTurn.get(assignee) === taskId;
    const key = `resolve:${action}:${taskId}:${trigger}`;
    const actor = { kind: 'human' as const, id: by };
    const note_ = note?.trim();

    if (action === 'accept') {
      if (!latest) throw new TaskResolutionError('invalid_state', "확인할 결과가 아직 없어요. '다시 맡기기'로 작업을 다시 진행해 주세요.");
      if (working) throw new TaskResolutionError('invalid_state', `${name(assignee)}${particle(name(assignee), '이/가')} 지금 "${title}" 결과를 고치고 있어요. 보완본이 오면 다시 판단해 주세요.`);
      const reason = `결정권자 ${name(by)}${particle(name(by), '이/가')} 현재 결과를 그대로 확인함${note_ ? `: ${note_}` : ''}`;
      const outcome = await this.dispatcher.acceptResult(taskId, by, reason, key);
      const recorded = await this.read() as AnyEvent[];
      const after = project(recorded);
      const next = recorded.flatMap(e => e.type === 'task_start_reserved' && e.payload.trigger === outcome.review.resultId ? [e.payload.taskId] : []);
      const nextText = [...new Set(next)].flatMap(id => { const t = after.tasks.get(id); return t ? [`${name(t.spec.assignee)}${particle(name(t.spec.assignee), '이/가')} "${t.spec.title}"${particle(t.spec.title)}`] : []; });
      const lines = [`"${title}" 결과를 ${name(by)}의 결정으로 지금 상태 그대로 확인했어요${nextText.length ? `. 다음은 ${nextText.join(', ')} 시작합니다.` : '.'}`,
        ...outcome.notices, ...outcome.failures, ...(outcome.limitNotice ? [outcome.limitNotice] : []), ...this.allCheckedNotice(after)];
      const posts = await this.speak(key, trigger, decider ?? null, '결정권자가 멈춘 작업의 현재 결과를 확인해 다음 작업이 이어진다', lines.map(text => ({ kind: 'fact' as const, text: channelText(text, after, 3) })), [outcome.review.resultId]);
      posts.push(...await this.reviewWaiting(taskId));
      return posts;
    }

    if (action === 'recheck') {
      if (!latest) throw new TaskResolutionError('invalid_state', '다시 검토할 결과가 아직 없어요.');
      if (working) throw new TaskResolutionError('invalid_state', `${name(assignee)}${particle(name(assignee), '이/가')} 지금 "${title}" 결과를 고치고 있어요. 보완본이 오면 자동으로 검토합니다.`);
      const current = task.status === 'blocked' ? task.blocked?.prevStatus : task.status;
      // A review that never finished runs again on the same submission; anything else is resubmitted for a fresh review.
      if (current === 'submitted' && !events.some(e => e.idempotencyKey === `handoff:${latest.resultId}`)) {
        if (task.status === 'blocked') await this.options.store.append([{ ...this.context, actor, type: 'task_resumed', idempotencyKey: `${key}:resume`, payload: { taskId } }]);
        return this.review(taskId, latest.resultId, { by, trigger: key });
      }
      return this.recheck(taskId, key, by, note_ ?? '', []);
    }

    // retry: the count starts over, and the task goes back to whoever does it with the note.
    const request = sentence(note_ || '멈춘 지점부터 다시 진행해 주세요.');
    const current = task.status === 'blocked' ? task.blocked?.prevStatus : task.status;
    const revise = !!latest && (current === 'submitted' || current === 'revising');
    await this.options.store.append([
      { ...this.context, actor: { kind: 'system', id: 'pm' }, type: 'pm_considered', idempotencyKey: `${retryKey(taskId, trigger)}:reset`, payload: { considerationId: `${retryKey(taskId, trigger)}:reset`, triggerId: trigger, whoseAction: assignee, alreadyKnows: 'no', evidence: [trigger], decision: 'silent', reason: `${name(by)}${particle(name(by), '이/가')} "${title}"를 다시 맡겨 보완 횟수를 새로 센다`, openTopics: state.openTopics } },
      ...(task.status === 'blocked' ? [{ ...this.context, actor, type: 'task_resumed' as const, idempotencyKey: `${key}:resume`, payload: { taskId } }] : []),
      ...(revise ? [{ ...this.context, actor, type: 'revision_requested' as const, idempotencyKey: `${key}:revision`, payload: { taskId, resultId: latest!.resultId, missing: [`${name(by)} 요청: ${request}`] } }] : []),
    ]);
    if (!agent) {
      const text = by === assignee ? `"${title}"를 다시 진행합니다: ${request} 보완본을 이 작업에 첨부해 올려 주세요.`
        : `@${name(assignee)} ${name(by)}${particle(name(by), '이/가')} "${title}"${particle(title)} 다시 맡겼어요: ${request} 보완본을 이 작업에 첨부해 올려 주세요.`;
      return this.speak(key, trigger, assignee, '다시 맡긴 작업을 담당자가 이어서 해야 한다', [{ kind: 'ask', text }]);
    }
    const lead = `"${title}"${particle(title)} ${name(assignee)}에게 다시 맡겼어요. 보완 횟수는 새로 셉니다.`;
    let problem = '';
    try {
      const after = await this.read() as AnyEvent[];
      const afterState = project(after);
      if (revise) {
        const update = revisionUpdate(after, afterState.plan!.version, taskId, latest!.resultId);
        const sent = update ? await this.sessions.deliver(assignee, taskId, update) : { sent: false as const, reason: '' };
        if (!sent.sent) problem = sent.reason;
      } else if (current === 'running') {
        const sent = await this.sessions.deliver(assignee, taskId, { updateId: key, fromVersion: afterState.plan!.version, toVersion: afterState.plan!.version, keep: [], drop: [],
          change: [`${name(by)} 요청: ${request}`], reason: `${name(by)}${particle(name(by), '이/가')} 멈춘 작업을 다시 맡겼습니다. 멈춘 지점부터 이어서 진행한 뒤 result_report로 제출하세요` });
        if (!sent.sent) problem = sent.reason;
      } else if (current === 'reserved') {
        const started = await this.dispatcher.startReserved(taskId);
        problem = started.failures.join(' ');
      }
    } catch (error) { this.failures.push(error); problem = '전달 중 오류가 났습니다'; }
    const text = problem ? `${lead} 다만 지금은 전달하지 못했어요(${problem}). 전달되면 이어서 진행합니다.` : lead;
    return this.speak(key, trigger, assignee, '멈춘 Agent 작업을 요청과 함께 다시 맡겼다', [{ kind: 'fact', text: channelText(text, state, 3) }]);
  }

  /** The decider, the task's own assignee (a person) and the people whose tasks build on it may hand it back or reopen it. */
  private mayHandBack(state: ProjectState, taskId: string, by: string): boolean {
    if (state.members.get(by)?.kind !== 'human') return false;
    if (state.goal?.decider === by || state.tasks.get(taskId)?.spec.assignee === by) return true;
    return this.downstream(state, taskId).some(t => t.spec.assignee === by);
  }
  /** Every task that builds on this one, directly or through others. */
  private downstream(state: ProjectState, taskId: string): TaskState[] {
    const found = new Map<string, TaskState>();
    const visit = (id: string) => { for (const t of state.tasks.values()) if (t.spec.dependsOn.includes(id) && !found.has(t.spec.id)) { found.set(t.spec.id, t); visit(t.spec.id); } };
    visit(taskId);
    return [...found.values()];
  }

  /**
   * A person asks for more on a result that was already checked (M11 T3): the task goes back to
   * revising under the person's request, the agent gets it in a new turn (a person hears it in the
   * channel), and the resubmission is reviewed like any result. Tasks built on the result keep going;
   * the requester hears that in one line. The decider, the assignee and downstream assignees may ask.
   */
  private async reopen(taskId: string, by: string, reason: string, trigger: string, announcement?: string): Promise<PmPost[]> {
    const events = await this.read() as AnyEvent[];
    const state = project(events);
    const task = state.tasks.get(taskId);
    const name = (id: string) => state.members.get(id)?.displayName ?? id;
    if (!task || task.status === 'cancelled') throw new TaskResolutionError('not_found', '작업을 찾지 못했습니다.');
    const title = task.spec.title;
    const assignee = task.spec.assignee;
    const agent = state.members.get(assignee)?.kind === 'agent';
    const key = `reopen:${taskId}:${trigger}`;
    const request = sentence(reason.trim() || '결과를 보완해 다시 올려 주세요.');
    const current = task.status === 'blocked' ? task.blocked?.prevStatus : task.status;
    const resultId = task.checkedResultId ?? task.results.at(-1)?.resultId;
    // Still in progress: an agent at work just gets the request; otherwise there is no checked result to reopen.
    if (current !== 'checked' || !resultId) {
      if (agent && (current === 'running' || current === 'revising') && task.status !== 'blocked') {
        if (!this.mayHandBack(state, taskId, by)) throw new TaskResolutionError('forbidden', REFUSAL.reopen);
        const version = state.plan!.version;
        const sent = await this.sessions.deliver(assignee, taskId, { updateId: key, fromVersion: version, toVersion: version, keep: [], drop: [], change: [`${name(by)} 요청: ${request}`], reason: `${name(by)}${particle(name(by), '이/가')} 진행 중인 작업에 요청을 더했습니다. 반영한 뒤 result_report로 제출하세요` });
        const text = sent.sent ? `진행 중인 "${title}" 작업에 요청을 ${name(assignee)}에게 전달했어요.` : `진행 중인 "${title}" 작업에 요청을 지금은 전달하지 못했어요(${sent.reason}).`;
        return this.speak(key, trigger, assignee, '진행 중인 Agent 작업에 사람 요청을 전달했다', [{ kind: 'fact', text }]);
      }
      const label = STATUS_LABEL[task.status] ?? task.status;
      throw new TaskResolutionError('invalid_state', `"${title}" 작업은 아직 확인 전(${label})이라 다시 열 결과가 없어요.`);
    }
    if (!this.mayHandBack(state, taskId, by)) throw new TaskResolutionError('forbidden', REFUSAL.reopen);
    const actor = { kind: 'human' as const, id: by };
    await this.options.store.append([
      ...(task.status === 'blocked' ? [{ ...this.context, actor, type: 'task_resumed' as const, idempotencyKey: `${key}:resume`, payload: { taskId } }] : []),
      { ...this.context, actor, type: 'revision_requested', idempotencyKey: key, payload: { taskId, resultId, missing: [`${name(by)} 요청: ${request}`] } },
    ]);
    const going = this.downstream(state, taskId).filter(t => ['reserved', 'running', 'submitted', 'revising'].includes(t.status));
    const keep = going.length ? ` 진행 중인 후행 작업 ${going.map(t => `"${t.spec.title}"`).join(', ')}${particle(going.at(-1)!.spec.title, '이/가') === '이' ? '은' : '는'} 그대로 둡니다.` : '';
    if (!agent) {
      // A scope decision that reopened the task speaks once, in the coordinator's own summary (M12 V2).
      const text = announcement?.trim()
        ? `@${name(assignee)} ${announcement.trim()} 보완본을 이 작업에 첨부해 올려 주세요.${keep}`
        : `@${name(assignee)} 확인된 "${title}" 결과에 ${name(by)}${particle(name(by), '이/가')} 보완을 요청했어요: ${request} 보완본을 이 작업에 첨부해 올려 주세요.${keep}`;
      return this.speak(key, trigger, assignee, '확인된 결과에 사람이 보완을 요청해 담당자가 다시 해야 한다', [{ kind: 'ask', text }]);
    }
    let problem = '';
    try {
      const after = await this.read() as AnyEvent[];
      const update = revisionUpdate(after, project(after).plan!.version, taskId, resultId);
      const sent = update ? await this.sessions.deliver(assignee, taskId, update) : { sent: false as const, reason: '' };
      if (!sent.sent) problem = sent.reason;
    } catch (error) { this.failures.push(error); problem = '전달 중 오류가 났습니다'; }
    const lead = announcement?.trim() || `확인된 "${title}" 결과를 다시 열어 ${name(assignee)}에게 보완을 맡겼어요.`;
    const text = `${lead}${problem ? ` 다만 지금은 전달하지 못했어요(${problem}). 전달되면 이어서 진행합니다.` : ''}${keep}`;
    return this.speak(key, trigger, by, '확인된 결과에 사람이 보완을 요청해 Agent에게 다시 맡겼다', [{ kind: 'fact', text: channelText(text, state, 3) }]);
  }

  /** Once every task of the plan is checked, the channel hears it once (M11 U3). */
  private allCheckedNotice(state: ProjectState): string[] {
    const tasks = [...state.tasks.values()].filter(t => t.status !== 'cancelled');
    return tasks.length && tasks.every(t => t.status === 'checked') ? ['프로젝트 작업이 모두 확인됐어요.'] : [];
  }

  /**
   * A person sends an agent's result back for review (S3): the handoff judgement runs again on the
   * files they attached, or on the agent's latest files, and only its verdict moves the task — the PM
   * never declares a result sufficient in conversation. A task stopped at the revision cap resumes
   * into that review.
   */
  private async recheck(taskId: string, messageId: string, authorId: string, text: string, attachmentIds: string[]): Promise<PmPost[]> {
    const events = await this.read() as AnyEvent[];
    const state = project(events);
    const task = state.tasks.get(taskId)!;
    const latest = events.findLast(e => e.type === 'result_submitted' && e.payload.taskId === taskId);
    const previous = latest?.type === 'result_submitted' ? latest.payload : undefined;
    const artifactIds = attachmentIds.length ? attachmentIds : previous?.artifactIds ?? [];
    const resultId = `result:${messageId}`;
    const actor = { kind: 'human' as const, id: authorId };
    await this.options.store.append([
      ...(task.status === 'blocked' ? [{ ...this.context, actor, type: 'task_resumed' as const, idempotencyKey: `recheck-resume:${messageId}`, payload: { taskId } }] : []),
      { ...this.context, actor, type: 'result_submitted', idempotencyKey: resultId, payload: { taskId, resultId, planVersion: previous?.planVersion ?? state.plan!.version, summary: previous?.summary ?? text, artifactIds } },
    ]);
    return this.review(taskId, resultId, { by: authorId, trigger: messageId });
  }

  /**
   * Judges a submission and records what people hear. A re-check a person asked for (`recheck`: who asked,
   * and the request that triggered it) always ends in a recorded channel line (M12 W2): checked, still
   * not checked and why, or why it could not run — a review of the same result never goes silent.
   */
  private async review(taskId: string, resultId: string, recheck?: { by: string; trigger: string }): Promise<PmPost[]> {
    const outcome = await this.dispatcher.onResultSubmitted(taskId, resultId);
    let notices = outcome.kind === 'revision' || outcome.kind === 'deferred' ? [outcome.notice].filter(Boolean)
      : outcome.kind === 'error' ? [outcome.message]
      : outcome.kind === 'checked' ? [...await this.acceptedNotice(taskId, resultId, recheck?.by), ...outcome.notices, ...outcome.failures, ...(outcome.limitNotice ? [outcome.limitNotice] : []), ...this.allCheckedNotice(project(await this.read()))] : [];
    let considerationId: string | undefined;
    if (recheck) {
      const events = await this.read() as AnyEvent[];
      const state = project(events);
      const title = state.tasks.get(taskId)?.spec.title ?? '작업';
      const name = (id: string) => state.members.get(id)?.displayName ?? id;
      const decider = state.goal?.decider;
      const still = `"${title}" 결과를 다시 검토했지만`;
      if (outcome.kind === 'error') {
        const who = decider && decider !== recheck.by ? `@${name(decider)} ` : '';
        notices = [`${who}${still} ${outcome.cause} 때문에 아직 확인되지 않았어요. 결과를 보고 '이대로 확인'하거나 요청을 적어 '다시 맡기기'로 다시 맡길 수 있어요.`];
      } else if (outcome.kind === 'revision') notices = [`${still} 보완할 점 때문에 아직 확인되지 않았어요.`, ...notices];
      else if (outcome.kind === 'deferred' && !notices.length) notices = [`"${title}" 결과는 선행 작업이 확인되면 이어서 다시 검토합니다.`];
      else if (outcome.kind === 'skipped') notices = [`"${title}" 결과는 지금 다시 검토할 제출이 아니라 검토하지 않았어요.`];
      // The first verdict on this result already used its record; a re-check is a record of its own.
      const first = outcome.kind === 'deferred' ? `handoff-wait:${resultId}` : `handoff-notice:${resultId}`;
      if (outcome.kind === 'skipped' || events.some(e => e.idempotencyKey === first)) considerationId = `recheck-notice:${recheck.trigger}`;
    }
    const posts = notices.length ? await this.recordNotices(resultId, taskId, outcome, notices, considerationId) : [];
    // Results that waited for this task are judged now that it is checked (M1).
    if (outcome.kind === 'checked') posts.push(...await this.reviewWaiting(taskId));
    return posts;
  }

  /** Submissions of dependent tasks that were kept unjudged until their predecessors were checked. */
  private async reviewWaiting(checkedTaskId: string): Promise<PmPost[]> {
    const events = await this.read() as AnyEvent[];
    const state = project(events);
    const posts: PmPost[] = [];
    for (const task of state.tasks.values()) {
      const resultId = task.results.at(-1)?.resultId;
      if (!resultId || task.status !== 'submitted' || !task.spec.dependsOn.includes(checkedTaskId)) continue;
      if (task.spec.dependsOn.some(id => { const dep = state.tasks.get(id)?.status; return dep !== undefined && dep !== 'checked' && dep !== 'cancelled'; })) continue;
      if (events.some(e => e.idempotencyKey === `handoff:${resultId}`)) continue;
      posts.push(...await this.review(task.spec.id, resultId));
    }
    return posts;
  }

  /**
   * The person whose result was checked hears it once, with what starts next — also on a first result
   * that simply passes (QA4 Z5). Someone who re-attached it on another's behalf hears the verdict; a
   * person who asked for a revision of a checked result (or handed the task back) hears the revised
   * result was accepted, even when an agent did the work.
   */
  private async acceptedNotice(taskId: string, resultId: string, recheckedBy?: string): Promise<string[]> {
    const events = await this.read() as AnyEvent[];
    const state = project(events);
    const submitted = events.findLast(e => e.type === 'result_submitted' && e.payload.resultId === resultId);
    const submitter = submitted?.actor.id;
    const task = state.tasks.get(taskId);
    if (!submitter || !task) return [];
    const name = (id: string) => state.members.get(id)?.displayName ?? id;
    const next = events.flatMap(e => e.type === 'task_start_reserved' && e.payload.trigger === resultId ? [state.tasks.get(e.payload.taskId)] : [])
      .flatMap(t => t ? [`${name(t.spec.assignee)}${particle(name(t.spec.assignee), '이/가')} "${t.spec.title}"${particle(t.spec.title)}`] : []);
    const then = next.length ? `. 다음은 ${next.join(', ')} 시작합니다.` : '.';
    // A person's own request since the task was last checked (a reopen or a hand-back) is answered by this check.
    const lastChecked = events.findLast(e => e.type === 'task_checked' && e.payload.taskId === taskId && e.payload.resultId !== resultId)?.seq ?? 0;
    const asked = events.findLast(e => e.type === 'revision_requested' && e.payload.taskId === taskId && e.actor.kind === 'human' && e.seq > lastChecked && e.seq < submitted!.seq);
    const requester = asked?.actor.id;
    if (state.members.get(submitter)?.kind !== 'human') {
      if (requester && state.members.get(requester)?.kind === 'human') return [`@${name(requester)} 요청하신 "${task.spec.title}" 보완본을 확인했어요${then}`];
      // Nobody else hears this verdict on an agent's result: the person who asked for the re-check does (M12 W2).
      return recheckedBy ? [`@${name(recheckedBy)} "${task.spec.title}" 결과를 다시 확인했어요 — 인계 조건을 충족합니다${then}`] : [];
    }
    const revised = events.some(e => e.type === 'revision_requested' && e.payload.taskId === taskId && e.payload.resultId !== resultId);
    const what = submitter !== task.spec.assignee ? `"${task.spec.title}" 결과를 다시 확인했어요 — 인계 조건을 충족합니다` : `"${task.spec.title}" ${revised ? '보완본을' : '결과를'} 확인했어요`;
    return [`@${name(submitter)} ${what}${then}`];
  }
  private async recordNotices(trigger: string, taskId: string, outcome: ResultOutcome, notices: string[], recordId?: string): Promise<PmPost[]> {
    const events = await this.read() as AnyEvent[];
    const state = project(events);
    if (outcome.kind === 'error') return this.recordJudgeFailure(trigger, taskId, outcome, state, recordId, notices[0] === outcome.message ? undefined : notices[0]);
    const submitter = events.findLast(e => e.type === 'result_submitted' && e.payload.resultId === trigger)?.actor.id;
    const recipients = outcome.kind === 'checked' ? [...new Set([submitter, ...events.filter(e => e.type === 'task_start_reserved' && e.payload.trigger === trigger).flatMap(e => e.type === 'task_start_reserved' ? [state.tasks.get(e.payload.taskId)?.spec.assignee] : [])])].filter(id => id && state.members.get(id)?.kind === 'human')
      : outcome.kind === 'revision' && outcome.delivery === 'blocked' ? [state.goal?.decider]
      : outcome.kind === 'deferred' ? [submitter] : [state.tasks.get(taskId)?.spec.assignee];
    // A deferred notice and the later verdict on the same result are two separate considerations.
    const considerationId = recordId ?? (outcome.kind === 'deferred' ? `handoff-wait:${trigger}` : `handoff-notice:${trigger}`);
    const evidence = outcome.kind === 'revision' || outcome.kind === 'checked' ? outcome.review.evidence : [];
    const posts: PmPost[] = notices.map(text => ({ text: outcome.kind === 'revision' ? text : channelText(text, state, 3), kind: outcome.kind === 'checked' ? 'nudge' : outcome.kind === 'deferred' || (outcome.kind === 'revision' && (outcome.delivery === 'steer' || outcome.delivery === 'next_turn')) ? 'fact' : 'ask' }));
    await this.options.store.append([
      { ...this.context, actor: { kind: 'system', id: 'pm' }, type: 'pm_considered', idempotencyKey: considerationId, payload: { considerationId, triggerId: trigger, whoseAction: `${recipients.join(", ") || state.goal?.decider}: ${outcome.kind === 'deferred' ? '선행 작업 확인 대기' : '결과 보완 또는 다음 작업 시작'}`, alreadyKnows: 'unknown', evidence: [trigger, ...evidence], decision: 'speak', reason: outcome.kind === 'deferred' ? '선행 작업이 확인되지 않아 제출한 결과의 인계 판단을 미룬다' : '인계 판단 결과에 따라 다음 행동이 필요하다', openTopics: state.openTopics } },
      ...posts.map((post, i) => ({ ...this.context, actor: { kind: 'system' as const, id: 'pm' }, type: 'pm_spoke', idempotencyKey: `${considerationId}:${i}`, payload: { considerationId, messageId: `${considerationId}:${i}`, ...post } })),
    ]);
    return posts;
  }

  /**
   * A judge that could not finish is a technical failure, not a content problem: the goal's decider
   * checks the result, the submitter is never asked to revise, and the unverified citations stay in
   * the PM record.
   */
  private async recordJudgeFailure(trigger: string, taskId: string, outcome: Extract<ResultOutcome, { kind: 'error' }>, state: ReturnType<typeof project>, recordId?: string, text?: string): Promise<PmPost[]> {
    const considerationId = recordId ?? `handoff-notice:${trigger}`;
    const decider = state.goal?.decider;
    const name = (id: string) => state.members.get(id)?.displayName ?? id;
    const title = state.tasks.get(taskId)?.spec.title ?? '작업';
    const citations = (outcome.citationFailures ?? []).map(f => `인용 확인 실패: 조건 "${f.condition}" / 파일 ${f.file || '(지정 없음)'} / 인용 "${f.quote}" / ${f.reason}`);
    const post: PmPost = { kind: 'ask', text: channelText(text ?? `${decider ? `@${name(decider)} ` : ''}"${title}" 결과: ${outcome.message}`, state, 4) };
    await this.options.store.append([
      { ...this.context, actor: { kind: 'system', id: 'pm' }, type: 'pm_considered', idempotencyKey: considerationId, payload: { considerationId, triggerId: trigger, whoseAction: `${decider ?? '결정권자'}: 인계 판단을 마치지 못한 결과 확인`, alreadyKnows: 'no', evidence: [trigger, ...citations], decision: 'speak', reason: JUDGE_FAILURE_REASON, openTopics: state.openTopics } },
      { ...this.context, actor: { kind: 'system', id: 'pm' }, type: 'pm_spoke', idempotencyKey: `${considerationId}:0`, payload: { considerationId, messageId: `${considerationId}:0`, ...post } },
    ]);
    return [post];
  }

  /** One PM line per stopped turn; the task stays blocked until a person decides what to do. */
  private async blockedNotice({ agentId, taskId, turnId, reason }: BlockedTurn): Promise<PmPost[]> {
    const state = project(await this.read());
    const considerationId = `blocked-notice:${turnId}`;
    const decider = state.goal?.decider;
    const name = (id: string) => state.members.get(id)?.displayName ?? id;
    const post: PmPost = { kind: 'fact', text: `${decider ? `@${name(decider)} ` : ''}${name(agentId)}의 "${state.tasks.get(taskId)?.spec.title ?? taskId}" 작업이 멈췄습니다: ${reason}. 자동으로 다시 시작하지 않으니 확인한 뒤 '다시 맡기기'로 다시 맡겨 주세요.` };
    post.text = channelText(post.text, state);
    await this.options.store.append([
      { ...this.context, actor: { kind: 'system', id: 'pm' }, type: 'pm_considered', idempotencyKey: considerationId, payload: { considerationId, triggerId: `turn-blocked:${turnId}`, whoseAction: decider ?? null, alreadyKnows: 'no', evidence: [`turn-blocked:${turnId}`], decision: 'speak', reason: 'Agent 작업이 멈춰 사람이 다음 행동을 정해야 한다', openTopics: state.openTopics } },
      { ...this.context, actor: { kind: 'system', id: 'pm' }, type: 'pm_spoke', idempotencyKey: `${considerationId}:0`, payload: { considerationId, messageId: `${considerationId}:0`, ...post } },
    ]);
    return [post];
  }

  onSessionEvent(event: SessionEvent): Promise<PmPost[]> {
    return this.enqueue(async () => {
      await this.sessions.flush();
      // A turn that ended frees its agent: a revision request that could not reach it goes out now.
      if (event.type === 'turn' && event.status !== 'started') { await this.deliverRevisions(); return []; }
      if (event.type !== 'report') return [];
      const events = await this.read() as AnyEvent[];
      if (event.report.type === 'result_report') {
        const resultId = `result:${event.turnId}:${event.index}`;
        if (events.some(e => e.type === 'result_submitted' && e.payload.resultId === resultId)) return this.review(event.taskId, resultId);
      } else if (event.report.type === 'question') {
        const key = `question-route:${event.turnId}:${event.itemId}:${event.index}`;
        if (events.some(e => e.idempotencyKey === key)) return [];
        // Runner must have accepted this report for a known task/turn first.
        const accepted = events.some(e => e.type === 'reply_recorded' && e.idempotencyKey === `reply:${event.turnId}:question:${event.index}`);
        if (!accepted) return [];
        // The relay's own record carries the route key; no internal ID reaches the channel.
        const question = await this.dispatcher.onQuestion(event.taskId, event.report.question, { choices: event.report.options, routeKey: key });
        return [{ text: question.text, kind: 'ask' }];
      }
      return [];
    });
  }

  async flush(): Promise<PmPost[]> {
    let observed: Promise<unknown>;
    do { await this.sessions.flush(); observed = this.queue; await observed; } while (observed !== this.queue);
    if (this.failures.length) throw new AggregateError(this.failures.splice(0), 'PM session routing failed');
    return this.background.splice(0);
  }
  async stop(): Promise<void> { this.unsubscribe(); await this.sessions.stop(); await this.flush(); }
}
