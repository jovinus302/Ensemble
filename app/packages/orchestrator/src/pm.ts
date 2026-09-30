import { channelText, particle } from './channel-text.ts';
import { randomUUID } from 'node:crypto';
import { automationGate, project, type AnyEvent, type EventContext, type NewLedgerEvent } from '@ensemble/core';
import type { SessionConnector, SessionEvent } from '@ensemble/agents';
import type { LlmProvider } from '@ensemble/llm';
import type { LedgerStore } from '@ensemble/store';
import { Coordinator, type CoordinationResult } from './coordination.ts';
import { Dispatcher, type ResultOutcome } from './dispatch.ts';
import { MAX_AGENT_REVISIONS, pendingChangeUpdate, revisionChangeId, revisionCount, revisionUpdate, taskQuestions } from './context.ts';
import type { ResultContent, SubmittedResult } from './handoff.ts';
import { SessionRunner, type BlockedTurn } from './session-runner.ts';
import { startFreeProject, decidePlan } from './planning.ts';
import { decideAuthority } from './authority-flow.ts';

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
}
export type PmPost = CoordinationResult['posts'][number];

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
    this.dispatcher = new Dispatcher({ store: options.store, llm: options.llm, model: options.model, context: this.context,
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
    return this.enqueue(() => this.thenDeliver(decideAuthority({ store: this.options.store, context: this.context, coordinator: this.coordinator }, requestId, memberId, granted)));
  }
  decideCard(cardId: string, memberId: string, approve: boolean): Promise<PmPost[]> {
    return this.enqueue(async () => {
      const events = await this.read() as AnyEvent[];
      if (events.some(e => e.type === 'plan_proposed' && e.payload.proposalId === cardId)) return this.thenDeliver(decidePlan({ store: this.options.store, context: this.context, dispatcher: this.dispatcher }, cardId, memberId, approve));
      return this.thenDeliver(decideAuthority({ store: this.options.store, context: this.context, coordinator: this.coordinator }, cardId, memberId, approve));
    });
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
  private async deliverAgentAnswers(answers: NonNullable<CoordinationResult['agentAnswers']>): Promise<void> {
    for (const answer of answers) {
      const events = await this.read();
      if (!automationGate(project(events)).allowed) return;
      const oldest = taskQuestions(events, answer.taskId).find(q => !q.answer);
      if (oldest?.questionId !== answer.questionId || !answer.text.trim()) continue;
      await this.dispatcher.onAnswer(answer.taskId, answer.text);
    }
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
      if (requested?.type !== 'revision_requested' || requested.payload.resultId !== resultId || handled.has(revisionChangeId(resultId))) continue;
      if (revisionCount(events, task.spec.id) > MAX_AGENT_REVISIONS) continue;
      const update = revisionUpdate(events, state.plan.version, task.spec.id, resultId);
      if (!update) continue;
      handled.add(update.updateId);
      try { await this.sessions.deliver(agentId, task.spec.id, update); } catch (error) { this.failures.push(error); }
    }
  }
  setAvailability(memberId: string, weeklyHours: number): Promise<void> {
    return this.enqueue(async () => {
      if (project(await this.read()).members.get(memberId)?.kind !== 'human') throw new Error('Availability must be entered by a human member');
      if (!Number.isFinite(weeklyHours) || weeklyHours < 0) throw new Error('Weekly hours must be finite and nonnegative');
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

  async recordMessage(authorId: string, text: string, attachments: MessageAttachment[] = []): Promise<{ messageId: string }> {
      const before = await this.read();
      const state = project(before);
      if (state.members.get(authorId)?.kind !== 'human') throw new Error(`Unknown human author ${authorId}`);
      const messageId = randomUUID();
      const attachmentIds = attachments.map(() => randomUUID());
      const actor = { kind: 'human' as const, id: authorId };
      const recorded: NewLedgerEvent[] = attachments.map((a, i) => ({ ...this.context, actor, type: 'attachment_recorded', payload: { attachmentId: attachmentIds[i]!, name: a.name, mimeType: a.mimeType, uri: `data:${a.mimeType};base64,${a.contentBase64 ?? Buffer.from(a.content).toString('base64')}`, ...(a.taskId ? { taskId: a.taskId } : {}) } }));
      recorded.push({ ...this.context, actor, type: 'message_recorded', payload: { messageId, authorId, text, attachmentIds } });
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
      // Agent results a person may send back for another handoff review (S3): the agent is not on it now.
      const recheckable = [...state.tasks.values()].filter(t => state.members.get(t.spec.assignee)?.kind === 'agent' && t.results.length > 0
        && (t.status === 'revising' || (t.status === 'blocked' && t.blocked?.prevStatus === 'revising')) && state.activeTurn.get(t.spec.assignee) !== t.spec.id);
      const canRecheck = (taskId: unknown) => typeof taskId === 'string' && recheckable.some(t => t.spec.id === taskId);
      let route: { kind: 'chat' | 'result' | 'answer' | 'recheck'; taskId?: string; questionId?: string } = { kind: 'chat' };
      if (attachments.length && declaredTasks.length === 1 && attachments.every(a => a.taskId === declaredTasks[0])) route = { kind: canRecheck(declaredTasks[0]) && state.tasks.get(declaredTasks[0]!)?.spec.assignee !== authorId ? 'recheck' : 'result', taskId: declaredTasks[0] };
      else if (attachments.length || pending.length || recheckable.length) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const response = await this.options.llm.complete({ model: this.options.model,
              system: '메시지를 결과 제출, 미해결 질문에 대한 답, Agent 결과 재확인 요청, 일반 대화로 분류하세요. 단어 규칙 없이 의미를 해석하세요. 확실하지 않으면 chat으로 두세요. 결과는 첨부가 있는 본인 담당 작업만, 답은 제공된 미해결 질문만 선택하세요. recheck는 사람이 recheckable에 있는 Agent 작업의 결과를 다시 첨부하거나 그 결과를 다시 확인해 달라고 할 때만 그 taskId로 고르세요.',
              forceTool: 'route_message', tools: [{ name: 'route_message', description: '인계 또는 대화 경로 선택', inputSchema: { type: 'object', required: ['kind'], properties: { kind: { enum: ['chat', 'result', 'answer', 'recheck'] }, taskId: { type: 'string' }, questionId: { type: 'string' } } } }],
              messages: [{ role: 'user', content: JSON.stringify({ messageId, planVersion: state.plan?.version, attempt, authorId, text, attachments, tasks: [...state.tasks.values()].filter(t => t.spec.assignee === authorId).map(t => t.spec), pending,
                recheckable: recheckable.map(t => ({ taskId: t.spec.id, title: t.spec.title, assignee: state.members.get(t.spec.assignee)?.displayName, status: t.status })) }) }] });
            const input = response.toolCalls.find(c => c.name === 'route_message')?.input;
            if (input?.kind === 'chat') break;
            if (input?.kind === 'recheck' && canRecheck(input.taskId)) { route = { kind: 'recheck', taskId: input.taskId as string }; break; }
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
        if (!task || task.spec.assignee !== authorId || task.status === 'cancelled') throw new Error('Result must belong to the submitting person and an active plan task');
        const resultId = `result:${messageId}`;
        await this.options.store.append([{ ...this.context, actor, type: 'result_submitted', idempotencyKey: resultId, payload: { taskId: route.taskId, resultId, planVersion: state.plan!.version, summary: text, artifactIds: attachmentIds } }]);
        const posts = await this.review(route.taskId, resultId); await markProcessed(); return posts;
      }
      if (route.kind === 'answer' && route.taskId) {
        // Dispatcher answers the oldest open question; never silently route to another one.
        const oldest = taskQuestions(before, route.taskId).find(q => !q.answer);
        if (oldest?.questionId === route.questionId) { await this.dispatcher.onAnswer(route.taskId, text); await markProcessed(); await this.deliverPending(); return []; }
      }
      const coordinated = await this.coordinator.onMessage(messageId);
      await this.deliverAgentAnswers(coordinated.agentAnswers ?? []);
      await this.deliverPending();
      return coordinated.posts;
    });
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
    return this.review(taskId, resultId);
  }

  private async review(taskId: string, resultId: string): Promise<PmPost[]> {
    const outcome = await this.dispatcher.onResultSubmitted(taskId, resultId);
    const notices = outcome.kind === 'revision' || outcome.kind === 'deferred' ? [outcome.notice].filter(Boolean)
      : outcome.kind === 'error' ? [outcome.message]
      : outcome.kind === 'checked' ? [...await this.acceptedNotice(taskId, resultId), ...outcome.notices, ...outcome.failures, ...(outcome.limitNotice ? [outcome.limitNotice] : [])] : [];
    const posts = notices.length ? await this.recordNotices(resultId, taskId, outcome, notices) : [];
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
   * A person who revised a result, resubmitted one for a check, or was told their result waits on a
   * predecessor hears once that it was accepted and what starts next (L3). A first result that simply
   * passes needs no word: the next assignee's own notice already shows it.
   */
  private async acceptedNotice(taskId: string, resultId: string): Promise<string[]> {
    const events = await this.read() as AnyEvent[];
    const state = project(events);
    const submitter = events.findLast(e => e.type === 'result_submitted' && e.payload.resultId === resultId)?.actor.id;
    const task = state.tasks.get(taskId);
    if (!submitter || !task || state.members.get(submitter)?.kind !== 'human') return [];
    const revised = events.some(e => e.type === 'revision_requested' && e.payload.taskId === taskId && e.payload.resultId !== resultId);
    const waited = events.some(e => e.type === 'pm_considered' && e.idempotencyKey === `handoff-wait:${resultId}`);
    const onBehalf = submitter !== task.spec.assignee;
    if (!revised && !waited && !onBehalf) return [];
    const name = (id: string) => state.members.get(id)?.displayName ?? id;
    const next = events.flatMap(e => e.type === 'task_start_reserved' && e.payload.trigger === resultId ? [state.tasks.get(e.payload.taskId)] : [])
      .flatMap(t => t ? [`${name(t.spec.assignee)}${particle(name(t.spec.assignee), '이/가')} "${t.spec.title}"${particle(t.spec.title)}`] : []);
    const what = onBehalf ? `"${task.spec.title}" 결과를 다시 확인했어요 — 인계 조건을 충족합니다` : `"${task.spec.title}" ${revised ? '보완본을' : '결과를'} 확인했어요`;
    return [`@${name(submitter)} ${what}${next.length ? `. 다음은 ${next.join(', ')} 시작합니다.` : '.'}`];
  }
  private async recordNotices(trigger: string, taskId: string, outcome: ResultOutcome, notices: string[]): Promise<PmPost[]> {
    const events = await this.read() as AnyEvent[];
    const state = project(events);
    if (outcome.kind === 'error') return this.recordJudgeFailure(trigger, taskId, outcome, state);
    const submitter = events.findLast(e => e.type === 'result_submitted' && e.payload.resultId === trigger)?.actor.id;
    const recipients = outcome.kind === 'checked' ? [...new Set([submitter, ...events.filter(e => e.type === 'task_start_reserved' && e.payload.trigger === trigger).flatMap(e => e.type === 'task_start_reserved' ? [state.tasks.get(e.payload.taskId)?.spec.assignee] : [])])].filter(id => id && state.members.get(id)?.kind === 'human')
      : outcome.kind === 'revision' && outcome.delivery === 'blocked' ? [state.goal?.decider]
      : outcome.kind === 'deferred' ? [submitter] : [state.tasks.get(taskId)?.spec.assignee];
    // A deferred notice and the later verdict on the same result are two separate considerations.
    const considerationId = outcome.kind === 'deferred' ? `handoff-wait:${trigger}` : `handoff-notice:${trigger}`;
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
  private async recordJudgeFailure(trigger: string, taskId: string, outcome: Extract<ResultOutcome, { kind: 'error' }>, state: ReturnType<typeof project>): Promise<PmPost[]> {
    const considerationId = `handoff-notice:${trigger}`;
    const decider = state.goal?.decider;
    const name = (id: string) => state.members.get(id)?.displayName ?? id;
    const title = state.tasks.get(taskId)?.spec.title ?? '작업';
    const citations = (outcome.citationFailures ?? []).map(f => `인용 확인 실패: 조건 "${f.condition}" / 파일 ${f.file || '(지정 없음)'} / 인용 "${f.quote}" / ${f.reason}`);
    const post: PmPost = { kind: 'ask', text: channelText(`${decider ? `@${name(decider)} ` : ''}"${title}" 결과: ${outcome.message}`, state, 4) };
    await this.options.store.append([
      { ...this.context, actor: { kind: 'system', id: 'pm' }, type: 'pm_considered', idempotencyKey: considerationId, payload: { considerationId, triggerId: trigger, whoseAction: `${decider ?? '결정권자'}: 인계 판단을 마치지 못한 결과 확인`, alreadyKnows: 'no', evidence: [trigger, ...citations], decision: 'speak', reason: '결과 내용이 아니라 판단 과정의 문제라 사람이 결과를 확인해야 한다', openTopics: state.openTopics } },
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
    const post: PmPost = { kind: 'fact', text: `${decider ? `@${name(decider)} ` : ''}${name(agentId)}의 "${state.tasks.get(taskId)?.spec.title ?? taskId}" 작업이 멈췄습니다: ${reason}. 자동으로 다시 시작하지 않으니 확인 후 다시 맡겨 주세요.` };
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
