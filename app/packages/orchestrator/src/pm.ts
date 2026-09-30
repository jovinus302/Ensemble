import { randomUUID } from 'node:crypto';
import { project, type AnyEvent, type EventContext, type NewLedgerEvent } from '@ensemble/core';
import type { SessionConnector, SessionEvent } from '@ensemble/agents';
import type { LlmProvider } from '@ensemble/llm';
import type { LedgerStore } from '@ensemble/store';
import { Coordinator, type CoordinationResult } from './coordination.ts';
import { Dispatcher, type ResultOutcome } from './dispatch.ts';
import { taskQuestions } from './context.ts';
import type { ResultContent, SubmittedResult } from './handoff.ts';
import { SessionRunner } from './session-runner.ts';
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
  private failures: unknown[] = [];
  private unsubscribe: () => void;
  private context: EventContext;

  constructor(private options: ProjectManagerOptions) {
    this.context = { projectId: options.projectId, targetProductId: options.targetProductId };
    this.sessions = new SessionRunner(options.connector, options.store, this.context);
    this.dispatcher = new Dispatcher({ store: options.store, llm: options.llm, model: options.model, context: this.context,
      connector: { startTask: async (agentId, input) => {
        await this.sessions.startSession(agentId);
        return this.sessions.startTask(agentId, input);
      }, sendUpdate: (agentId, input) => this.sessions.sendUpdate(agentId, input) }, readResult: result => this.readResult(result) });
    this.coordinator = new Coordinator(options.store, options.llm, this.sessions, { ...this.context, model: options.model, clock: options.clock });
    // Runner subscribes first. flush below ensures its asynchronous validation finished.
    this.unsubscribe = options.connector.onEvent(event => {
      void this.onSessionEvent(event).then(posts => { this.background.push(...posts); }).catch(error => this.failures.push(error));
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private read() { return this.options.store.read({ projectId: this.context.projectId }); }
  startFreeProject(goal: string, deadline?: string) {
    return this.enqueue(() => startFreeProject({ ...this.options, context: this.context }, goal, deadline));
  }
  decidePlan(proposalId: string, memberId: string, approve: boolean): Promise<PmPost[]> {
    return this.enqueue(() => decidePlan({ store: this.options.store, context: this.context, dispatcher: this.dispatcher }, proposalId, memberId, approve));
  }
  decideAuthority(requestId: string, memberId: string, granted: boolean): Promise<PmPost[]> {
    return this.enqueue(() => decideAuthority({ store: this.options.store, context: this.context, coordinator: this.coordinator }, requestId, memberId, granted));
  }
  decideCard(cardId: string, memberId: string, approve: boolean): Promise<PmPost[]> {
    return this.enqueue(async () => {
      const events = await this.read() as AnyEvent[];
      if (events.some(e => e.type === 'plan_proposed' && e.payload.proposalId === cardId)) return decidePlan({ store: this.options.store, context: this.context, dispatcher: this.dispatcher }, cardId, memberId, approve);
      return decideAuthority({ store: this.options.store, context: this.context, coordinator: this.coordinator }, cardId, memberId, approve);
    });
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

  postMessage(authorId: string, text: string, attachments: MessageAttachment[] = []): Promise<PmPost[]> {
    return this.enqueue(async () => {
      const before = await this.read();
      const state = project(before);
      if (state.members.get(authorId)?.kind !== 'human') throw new Error(`Unknown human author ${authorId}`);
      const messageId = randomUUID();
      const attachmentIds = attachments.map(() => randomUUID());
      const actor = { kind: 'human' as const, id: authorId };
      const recorded: NewLedgerEvent[] = attachments.map((a, i) => ({ ...this.context, actor, type: 'attachment_recorded', payload: { attachmentId: attachmentIds[i]!, name: a.name, mimeType: a.mimeType, uri: `data:${a.mimeType};base64,${a.contentBase64 ?? Buffer.from(a.content).toString('base64')}`, ...(a.taskId ? { taskId: a.taskId } : {}) } }));
      recorded.push({ ...this.context, actor, type: 'message_recorded', payload: { messageId, authorId, text, attachmentIds } });
      await this.options.store.append(recorded);
      const pending = [...state.tasks.values()].flatMap(t => taskQuestions(before, t.spec.id).filter(q => !q.answer).map(q => ({ ...q, taskId: t.spec.id }))).filter(q =>
        (before as AnyEvent[]).some(e => e.type === 'pm_considered' && e.payload.triggerId === q.questionId && e.payload.whoseAction === authorId));
      // Structural metadata can identify a submission; text interpretation is model-owned.
      const declaredTasks = [...new Set(attachments.map(a => a.taskId).filter((id): id is string => !!id))];
      let route: { kind: 'chat' | 'result' | 'answer'; taskId?: string; questionId?: string } = { kind: 'chat' };
      if (attachments.length && declaredTasks.length === 1 && attachments.every(a => a.taskId === declaredTasks[0])) route = { kind: 'result', taskId: declaredTasks[0] };
      else if (attachments.length || pending.length) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const response = await this.options.llm.complete({ model: this.options.model,
              system: '메시지를 결과 제출, 미해결 질문에 대한 답, 일반 대화로 분류하세요. 단어 규칙 없이 의미를 해석하세요. 확실하지 않으면 chat으로 두세요. 결과는 첨부가 있는 본인 담당 작업만, 답은 제공된 미해결 질문만 선택하세요.',
              forceTool: 'route_message', tools: [{ name: 'route_message', description: '인계 또는 대화 경로 선택', inputSchema: { type: 'object', required: ['kind'], properties: { kind: { enum: ['chat', 'result', 'answer'] }, taskId: { type: 'string' }, questionId: { type: 'string' } } } }],
              messages: [{ role: 'user', content: JSON.stringify({ messageId, planVersion: state.plan?.version, attempt, authorId, text, attachments, tasks: [...state.tasks.values()].filter(t => t.spec.assignee === authorId).map(t => t.spec), pending }) }] });
            const input = response.toolCalls.find(c => c.name === 'route_message')?.input;
            if (input?.kind === 'chat') break;
            if (input?.kind === 'result' && attachments.length && typeof input.taskId === 'string' && state.tasks.get(input.taskId)?.spec.assignee === authorId) { route = { kind: 'result', taskId: input.taskId }; break; }
            if (input?.kind === 'answer' && typeof input.questionId === 'string') {
              const question = pending.find(q => q.questionId === input.questionId && q.taskId === input.taskId);
              if (question) { route = { kind: 'answer', taskId: question.taskId, questionId: question.questionId }; break; }
            }
          } catch { /* Retry once, then retain ordinary conversational handling. */ }
        }
      }
      if (route.kind === 'result' && route.taskId) {
        const task = state.tasks.get(route.taskId);
        if (!task || task.spec.assignee !== authorId || task.status === 'cancelled') throw new Error('Result must belong to the submitting person and an active plan task');
        const resultId = `result:${messageId}`;
        await this.options.store.append([{ ...this.context, actor, type: 'result_submitted', idempotencyKey: resultId, payload: { taskId: route.taskId, resultId, planVersion: state.plan!.version, summary: text, artifactIds: attachmentIds } }]);
        return this.review(route.taskId, resultId);
      }
      if (route.kind === 'answer' && route.taskId) {
        // Dispatcher answers the oldest open question; never silently route to another one.
        const oldest = taskQuestions(before, route.taskId).find(q => !q.answer);
        if (oldest?.questionId === route.questionId) { await this.dispatcher.onAnswer(route.taskId, text); return []; }
      }
      return (await this.coordinator.onMessage(messageId)).posts;
    });
  }

  private async review(taskId: string, resultId: string): Promise<PmPost[]> {
    const outcome = await this.dispatcher.onResultSubmitted(taskId, resultId);
    const notices = outcome.kind === 'revision' ? [outcome.notice] : outcome.kind === 'error' ? [outcome.message] : outcome.kind === 'checked' ? [...outcome.notices, ...outcome.failures, ...(outcome.limitNotice ? [outcome.limitNotice] : [])] : [];
    if (!notices.length) return [];
    return this.recordNotices(resultId, taskId, outcome, notices);
  }
  private async recordNotices(trigger: string, taskId: string, outcome: ResultOutcome, notices: string[]): Promise<PmPost[]> {
    const state = project(await this.read());
    const considerationId = `handoff-notice:${trigger}`;
    const evidence = outcome.kind === 'revision' || outcome.kind === 'checked' ? outcome.review.evidence : [];
    const posts: PmPost[] = notices.map(text => ({ text, kind: 'ask' }));
    await this.options.store.append([
      { ...this.context, actor: { kind: 'system', id: 'pm' }, type: 'pm_considered', idempotencyKey: considerationId, payload: { considerationId, triggerId: trigger, whoseAction: `${state.tasks.get(taskId)?.spec.assignee}: 결과 보완 또는 다음 작업 시작`, alreadyKnows: 'unknown', evidence: [trigger, ...evidence], decision: 'speak', reason: '인계 판단 결과에 따라 다음 행동이 필요하다', openTopics: state.openTopics } },
      ...posts.map((post, i) => ({ ...this.context, actor: { kind: 'system' as const, id: 'pm' }, type: 'pm_spoke', idempotencyKey: `${considerationId}:${i}`, payload: { considerationId, messageId: `${considerationId}:${i}`, ...post } })),
    ]);
    return posts;
  }

  onSessionEvent(event: SessionEvent): Promise<PmPost[]> {
    return this.enqueue(async () => {
      await this.sessions.flush();
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
        const question = await this.dispatcher.onQuestion(event.taskId, event.report.question, { choices: event.report.options });
        await this.options.store.append([{ ...this.context, actor: { kind: 'system', id: 'pm' }, type: 'reply_recorded', idempotencyKey: key, payload: { memberId: event.agentId, taskId: event.taskId, turnId: event.turnId, text: `질문 전달: ${question.questionId}` } }]);
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
