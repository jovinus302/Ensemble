// Slack <-> Space coordination for one workspace, one channel and one Space (issue #79, EXPERIMENT).
// A: a person mentions the PM in a thread -> the PM reads the thread and the Space's goal, decisions and
//    work -> replies in the same thread -> later thread replies are recorded with what they settled.
// B: an agent's result or blocker (or a decision) lands in the Space -> the PM posts to the owner in the
//    designated channel first -> the owner's thread reply is linked back to the original task.
// Ledger first and at most once: the observed message is recorded before any reply, so a redelivered
// event never produces a second answer. Failures and unanswered requests are ledger records too.
import {
  externalConversation, overdueExternalRequests, project,
  type AnyEvent, type EventContext, type EventPayloads, type ExternalAuthor, type ExternalConversationState, type ExternalFailureStage,
  type ExternalMessageKind, type ExternalRequestReason, type ExternalRequestState, type ExternalSourceRef, type Id, type NewLedgerEvent, type ProjectState,
} from '@ensemble/core';
import { routeSlackEvent, slackErrorCode, SlackEventDeduper, slackTsToIso, stripMention, type SlackApi, type SlackEventCallback, type SlackMessageEvent, type SlackThreadMessage } from '@ensemble/channel';
import type { LlmProvider } from '@ensemble/llm';
import type { LedgerStore } from '@ensemble/store';

export { handleSlackEventsRequest, openSocketModeUrl, slackConfigFromEnv, SlackSocketModeClient, SlackWebApi, type SlackEnvConfig, type SlackEventCallback, type SlackHttpResult } from '@ensemble/channel';

export interface SlackSpaceBinding {
  teamId: string;
  channelId: string;
  botUserId: string;
  botId?: string;
  /** Slack user or bot id -> Space member id. Unmapped people are still recorded, without a member. */
  users: Record<string, Id>;
  /**
   * Test fallback when `users` does not name someone: `goal_decider` treats every unmapped human in the bound
   * channel as the goal's decider (their "decision" counts, and they may answer the decider's requests).
   */
  unmappedHumans?: 'none' | 'goal_decider';
  /** Slack user to mention for the goal's decider when `users` has none. */
  ownerUserId?: string;
}
/** Redacted progress for live runs: ids, ts, reason codes and counts, never tokens. */
export type SlackProgress =
  | { step: 'event_received'; eventId: string; type: string; channel: string; ts: string; threadTs?: string; retryNum?: number }
  | { step: 'event_skipped'; eventId: string; outcome: 'ignored' | 'duplicate'; reason: string }
  | { step: 'thread_read'; messageId: Id; messages: number }
  | { step: 'reply_posted'; messageId: Id; ts: string; threadTs: string; kind: 'answer' | 'ask'; composedBy: 'llm' | 'template' }
  | { step: 'request_sent'; requestId: Id; ts: string; reason: ExternalRequestReason; target: string; taskIds: Id[] }
  | { step: 'reply_recorded'; messageId: Id; kind: ExternalMessageKind; requestId?: Id; resolved: boolean }
  | { step: 'request_expired'; requestId: Id }
  | { step: 'failure'; stage: ExternalFailureStage; operation: string; error: string; triggerId: Id; attempt: number };
/** A request target meaning "any person in the channel" (fallback without a Slack mapping). */
export const ANY_SLACK_HUMAN = '*';
export type ProactiveTrigger = 'agent_result' | 'agent_blocker' | 'decision_followup';
export interface ProactiveSettings {
  /** Which Space changes the PM may raise in Slack first. Default: agent results and blockers. */
  triggers?: ProactiveTrigger[];
  /** Only Space changes recorded at or after this time are raised (default: when the coordinator was created). */
  since?: string;
  /** Post into this thread instead of starting a new one per request. */
  threadTs?: string;
  /** Who must confirm; default: the blocker's unblockBy when a person, otherwise the goal's decider. */
  recipientFor?: (input: { trigger: ProactiveTrigger; taskId?: Id; state: ProjectState }) => Id | undefined;
  maxSendAttempts?: number;
}
export interface SlackCoordinatorOptions {
  store: LedgerStore;
  llm: LlmProvider;
  model: string;
  api: SlackApi;
  binding: SlackSpaceBinding;
  /** The Space this channel is bound to. A function lets a host follow its current project. */
  context: EventContext | (() => EventContext);
  clock?: () => Date;
  /** How long a request may wait before it counts as no response. Default 24 hours. */
  responseTimeoutMs?: number;
  proactive?: ProactiveSettings;
  /** Thread messages read for context. Default 30. */
  threadLimit?: number;
  onProgress?: (entry: SlackProgress) => void;
}

export type SlackReceiveOutcome =
  | { kind: 'ignored'; reason: string }
  | { kind: 'duplicate'; key: string }
  | { kind: 'replied'; messageId: Id; replyMessageId: Id; requestId?: Id; composedBy: 'llm' | 'template'; resolvedRequestId?: Id }
  | { kind: 'recorded'; messageId: Id; requestId?: Id; resolved: boolean }
  | { kind: 'failed'; messageId: Id; stage: ExternalFailureStage; error: string };
export type SlackProactiveOutcome =
  | { kind: 'sent'; requestId: Id; triggerId: Id; ts: string }
  | { kind: 'failed'; requestId: Id; triggerId: Id; error: string; attempt: number };

const DAY_MS = 24 * 3_600_000;
const DEFAULT_TRIGGERS: ProactiveTrigger[] = ['agent_result', 'agent_blocker'];
const MESSAGE_KINDS: readonly ExternalMessageKind[] = ['decision', 'proposal', 'request', 'answer', 'other'];
const PM_ACTOR = { kind: 'pm' as const, id: 'pm' };

export const slackMessageId = (teamId: string, channelId: string, ts: string) => `slack:${teamId}:${channelId}:${ts}`;
const threadKey = (source: Pick<ExternalSourceRef, 'channelId' | 'messageTs' | 'threadTs'>) => `${source.channelId}:${source.threadTs ?? source.messageTs}`;
const strings = (value: unknown, max = 8): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()).slice(0, max) : []);

export class SlackCoordinator {
  private readonly deduper = new SlackEventDeduper();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly since: string;

  constructor(private readonly options: SlackCoordinatorOptions) {
    this.since = options.proactive?.since ?? this.now().toISOString();
  }

  /**
   * Handles one verified event. Call it after acknowledging the HTTP request (Slack waits three seconds).
   * Redeliveries are dropped by event id here and by the message's ledger key after a restart.
   */
  async receive(envelope: SlackEventCallback, meta: { retryNum?: number } = {}): Promise<SlackReceiveOutcome> {
    const e = envelope.event;
    this.progress({ step: 'event_received', eventId: envelope.event_id, type: e?.type, channel: e?.channel, ts: e?.ts, ...(e?.thread_ts ? { threadTs: e.thread_ts } : {}), ...(meta.retryNum ? { retryNum: meta.retryNum } : {}) });
    const outcome: SlackReceiveOutcome = this.deduper.check(envelope.event_id) ? { kind: 'duplicate', key: envelope.event_id } : await this.enqueue(() => this.handle(envelope));
    if (outcome.kind === 'ignored') this.progress({ step: 'event_skipped', eventId: envelope.event_id, outcome: 'ignored', reason: outcome.reason });
    if (outcome.kind === 'duplicate') this.progress({ step: 'event_skipped', eventId: envelope.event_id, outcome: 'duplicate', reason: outcome.key });
    return outcome;
  }

  /** Flow B: raises new Space changes in Slack. Idempotent per triggering ledger event. */
  syncSpaceChanges(): Promise<SlackProactiveOutcome[]> {
    return this.enqueue(() => this.proactive());
  }

  /** Marks requests past their due time as no response. Returns their ids. */
  expireOverdue(now: Date = this.now()): Promise<Id[]> {
    return this.enqueue(async () => {
      const overdue = overdueExternalRequests(externalConversation(await this.read()), now);
      if (!overdue.length) return [];
      await this.options.store.append(overdue.map(r => this.event('external_request_resolved', { requestId: r.request.requestId, outcome: 'no_response' }, `${r.request.requestId}:resolved`, now)));
      for (const r of overdue) this.progress({ step: 'request_expired', requestId: r.request.requestId });
      return overdue.map(r => r.request.requestId);
    });
  }

  /** Requests (awaiting / answered / no response), messages and failures as the ledger holds them. */
  async status(): Promise<ExternalConversationState> { return externalConversation(await this.read()); }

  // --- intake -------------------------------------------------------------------------------------

  private async handle(envelope: SlackEventCallback): Promise<SlackReceiveOutcome> {
    const events = await this.read();
    const state = project(events);
    const { binding } = this.options;
    const agentAccounts = new Set(Object.entries(binding.users).filter(([, memberId]) => state.members.get(memberId)?.kind === 'agent').map(([slackId]) => slackId));
    const route = routeSlackEvent(envelope, { ...binding, agentAccounts });
    if (route.action === 'ignore') return { kind: 'ignored', reason: route.reason };
    const messageId = slackMessageId(binding.teamId, route.event.channel, route.event.ts);
    if (events.some(e => e.idempotencyKey === messageId)) return { kind: 'duplicate', key: messageId };
    const conversation = externalConversation(events);
    if (route.action === 'thread_message' && !this.tracked(conversation, route.event)) return { kind: 'ignored', reason: 'untracked_thread' };
    const author = this.author(route.authorId, state, route.event.bot_id);
    return route.action === 'mention'
      ? this.mention(route.event, messageId, author, state, conversation)
      : this.threadMessage(route.event, messageId, author, state, conversation);
  }

  /** Flow A: record the mention, read the thread, answer in the same thread. */
  private async mention(event: SlackMessageEvent, messageId: Id, author: ExternalAuthor, state: ProjectState, conversation: ExternalConversationState): Promise<SlackReceiveOutcome> {
    const { binding } = this.options;
    const root = event.thread_ts ?? event.ts;
    const question = stripMention(event.text ?? '', binding.botUserId);
    const answered = this.answerTarget(conversation, event, author);
    const recorded: NewLedgerEvent[] = [this.event('external_message_observed', { messageId, source: this.source(event), author, text: event.text ?? '', postedAt: slackTsToIso(event.ts),
      kind: answered ? 'answer' : 'request', ...(answered ? { requestId: answered.request.requestId, taskIds: answered.request.taskIds } : {}) }, messageId)];
    if (answered?.status === 'awaiting_response') recorded.push(this.resolution(answered.request.requestId, messageId, author));
    await this.options.store.append(recorded);
    const resolvedRequestId = answered?.status === 'awaiting_response' ? answered.request.requestId : undefined;

    let thread: SlackThreadMessage[];
    try {
      thread = await this.options.api.conversationsReplies({ channel: event.channel, ts: root, limit: this.options.threadLimit ?? 30 });
      this.progress({ step: 'thread_read', messageId, messages: thread.length });
    } catch (error) {
      const code = slackErrorCode(error);
      await this.failure('read', 'conversations.replies', messageId, code, 1, { channelId: event.channel, threadTs: root });
      // Tell the person in the thread; if even that fails the ledger still shows both failures.
      const notice = `스레드 맥락을 읽지 못해 아직 답하지 못했어요 (${code}). Ensemble 앱이 이 채널에 초대됐는지와 읽기 권한을 확인해 주세요.`;
      const posted = await this.post(event.channel, notice, root, messageId);
      if (posted.ok) await this.options.store.append([this.pmMessage(posted.ts, root, notice, 'other', 'template', { inReplyTo: messageId })]);
      return { kind: 'failed', messageId, stage: 'read', error: code };
    }

    const composed = await this.compose(state, conversation, thread, question, author);
    if (composed.error) await this.failure('compose', 'pm_reply', messageId, composed.error, 1, { channelId: event.channel, threadTs: root });
    const posted = await this.post(event.channel, composed.text, root, messageId);
    if (!posted.ok) return { kind: 'failed', messageId, stage: 'send', error: posted.error };
    const replyMessageId = slackMessageId(binding.teamId, event.channel, posted.ts);
    const out: NewLedgerEvent[] = [this.pmMessage(posted.ts, root, composed.text, composed.kind === 'ask' ? 'request' : 'answer', composed.composedBy,
      { inReplyTo: messageId, confirmed: composed.confirmed, remaining: composed.remaining, taskIds: composed.taskIds })];
    const requestId = composed.kind === 'ask' ? `slack-request:${messageId}` : undefined;
    if (requestId) out.push(this.request(requestId, posted.ts, root, author, composed.text, 'thread_question', messageId, composed.taskIds, composed.composedBy));
    await this.options.store.append(out);
    this.progress({ step: 'reply_posted', messageId, ts: posted.ts, threadTs: root, kind: composed.kind, composedBy: composed.composedBy });
    if (requestId) this.progress({ step: 'request_sent', requestId, ts: posted.ts, reason: 'thread_question', target: author.externalUserId, taskIds: composed.taskIds });
    return { kind: 'replied', messageId, replyMessageId, composedBy: composed.composedBy, ...(requestId ? { requestId } : {}), ...(resolvedRequestId ? { resolvedRequestId } : {}) };
  }

  /** A reply in a thread the PM is part of: recorded with what it settled; it answers a request when its target wrote it. No PM reply. */
  private async threadMessage(event: SlackMessageEvent, messageId: Id, author: ExternalAuthor, state: ProjectState, conversation: ExternalConversationState): Promise<SlackReceiveOutcome> {
    const target = this.answerTarget(conversation, event, author);
    const classified = await this.classify(state, conversation, event, author, target);
    const kind = classified.kind ?? (target ? 'answer' : 'unclassified');
    const recorded: NewLedgerEvent[] = [this.event('external_message_observed', { messageId, source: this.source(event), author, text: event.text ?? '', postedAt: slackTsToIso(event.ts), kind,
      confirmed: classified.confirmed, remaining: classified.remaining,
      ...(target ? { requestId: target.request.requestId, taskIds: target.request.taskIds } : {}) }, messageId)];
    const resolves = target?.status === 'awaiting_response';
    if (resolves) recorded.push(this.resolution(target.request.requestId, messageId, author));
    await this.options.store.append(recorded);
    this.progress({ step: 'reply_recorded', messageId, kind, resolved: resolves, ...(target ? { requestId: target.request.requestId } : {}) });
    return { kind: 'recorded', messageId, resolved: resolves, ...(target ? { requestId: target.request.requestId } : {}) };
  }

  // --- Flow B ------------------------------------------------------------------------------------

  private async proactive(): Promise<SlackProactiveOutcome[]> {
    const events = await this.read();
    const state = project(events);
    const conversation = externalConversation(events);
    const settings = this.options.proactive ?? {};
    const triggers = new Set(settings.triggers ?? DEFAULT_TRIGGERS);
    const maxAttempts = settings.maxSendAttempts ?? 3;
    const outcomes: SlackProactiveOutcome[] = [];
    for (const e of events as AnyEvent[]) {
      if (e.at < this.since) continue;
      const candidate = this.candidate(e, state, triggers);
      if (!candidate) continue;
      const requestId = `slack-request:${e.id}`;
      if (conversation.requests.has(requestId)) continue;
      const attempts = conversation.failures.filter(f => f.requestId === requestId);
      if (attempts.length >= maxAttempts || attempts.some(f => f.error === 'recipient_not_mapped')) continue;
      const attempt = attempts.length + 1;
      const memberId = settings.recipientFor ? settings.recipientFor({ trigger: candidate.trigger, taskId: candidate.taskIds[0], state }) : this.defaultRecipient(candidate, state);
      const slackUser = memberId ? this.slackUserFor(memberId, state) : undefined;
      if (!memberId || !slackUser) {
        await this.failure('send', 'chat.postMessage', e.id, 'recipient_not_mapped', attempt, { requestId });
        outcomes.push({ kind: 'failed', requestId, triggerId: e.id, error: 'recipient_not_mapped', attempt });
        continue;
      }
      const text = slackUser === ANY_SLACK_HUMAN ? `${state.members.get(memberId)?.displayName ?? '담당자'}님, ${candidate.text}` : `<@${slackUser}> ${candidate.text}`;
      const posted = await this.post(this.options.binding.channelId, text, settings.threadTs, e.id, requestId, attempt);
      if (!posted.ok) { outcomes.push({ kind: 'failed', requestId, triggerId: e.id, error: posted.error, attempt }); continue; }
      const target: ExternalAuthor = { kind: 'human', externalUserId: slackUser, memberId };
      await this.options.store.append([
        this.pmMessage(posted.ts, settings.threadTs, text, 'request', 'template', { taskIds: candidate.taskIds }),
        this.request(requestId, posted.ts, settings.threadTs, target, text, candidate.reason, e.id, candidate.taskIds, 'template'),
      ]);
      this.progress({ step: 'request_sent', requestId, ts: posted.ts, reason: candidate.reason, target: slackUser, taskIds: candidate.taskIds });
      outcomes.push({ kind: 'sent', requestId, triggerId: e.id, ts: posted.ts });
    }
    return outcomes;
  }

  private candidate(e: AnyEvent, state: ProjectState, triggers: Set<ProactiveTrigger>): { trigger: ProactiveTrigger; reason: ExternalRequestReason; taskIds: Id[]; text: string } | undefined {
    const name = (id: Id | undefined) => (id && state.members.get(id)?.displayName) || '담당 Agent';
    const agentTask = (taskId: Id) => { const task = state.tasks.get(taskId); return task && state.members.get(task.spec.assignee)?.kind === 'agent' ? task : undefined; };
    if (e.type === 'task_blocked' && triggers.has('agent_blocker')) {
      const task = agentTask(e.payload.taskId);
      if (task) return { trigger: 'agent_blocker', reason: 'agent_blocker', taskIds: [task.spec.id],
        text: `${name(task.spec.assignee)}가 "${task.spec.title}" 작업에서 막혔어요: ${e.payload.reason}. 어떻게 진행할지 이 스레드에 답해 주세요.` };
    }
    if (e.type === 'result_submitted' && triggers.has('agent_result') && e.actor.kind === 'agent') {
      const task = agentTask(e.payload.taskId);
      if (task) return { trigger: 'agent_result', reason: 'agent_result', taskIds: [task.spec.id],
        text: `${name(task.spec.assignee)}가 "${task.spec.title}" 결과를 Space에 남겼어요: ${e.payload.summary}. 이대로 진행해도 되는지, 바꿀 점이 있는지 이 스레드에 답해 주세요.` };
    }
    if (e.type === 'decision_recorded' && triggers.has('decision_followup')) {
      return { trigger: 'decision_followup', reason: 'decision_followup', taskIds: [],
        text: `"${e.payload.summary}" 결정이 확정됐어요. 이 결정으로 바뀌는 작업이나 확인할 점이 있으면 이 스레드에 답해 주세요.` };
    }
    return undefined;
  }

  private defaultRecipient(candidate: { trigger: ProactiveTrigger; taskIds: Id[] }, state: ProjectState): Id | undefined {
    const unblockBy = candidate.trigger === 'agent_blocker' ? state.tasks.get(candidate.taskIds[0] ?? '')?.blocked?.unblockBy : undefined;
    if (unblockBy && state.members.get(unblockBy)?.kind === 'human') return unblockBy;
    return state.goal?.decider;
  }

  // --- PM model ----------------------------------------------------------------------------------

  private spaceContext(state: ProjectState, conversation: ExternalConversationState) {
    const name = (id: Id) => state.members.get(id)?.displayName ?? id;
    return {
      goal: state.goal ? { text: state.goal.text, deadline: state.goal.deadline, decider: name(state.goal.decider) } : null,
      decisions: [...state.decisions.values()].map(d => d.summary),
      tasks: [...state.tasks.values()].filter(t => t.status !== 'cancelled').map(t => ({ taskId: t.spec.id, title: t.spec.title, status: t.status, assignee: name(t.spec.assignee), ...(t.blocked ? { blocked: t.blocked.reason } : {}) })),
      openDecisionRequests: [...state.decisionRequests.values()].filter(r => r.status === 'open').map(r => ({ question: r.request.question, target: name(r.request.targetMemberId) })),
      awaitingInSlack: [...conversation.requests.values()].filter(r => r.status === 'awaiting_response').map(r => ({ text: r.request.text, taskIds: r.request.taskIds })),
    };
  }

  private transcript(thread: SlackThreadMessage[], state: ProjectState) {
    return thread.map(m => {
      const author = this.author(m.user ?? m.botId ?? 'unknown', state, m.botId);
      const who = author.kind === 'pm' ? 'PM Agent' : (author.memberId && state.members.get(author.memberId)?.displayName) || 'Slack 사용자';
      return { ts: m.ts, author: who, authorKind: author.kind, text: stripMention(m.text, this.options.binding.botUserId) };
    });
  }

  private async compose(state: ProjectState, conversation: ExternalConversationState, thread: SlackThreadMessage[], question: string, author: ExternalAuthor) {
    type Composed = { text: string; kind: 'answer' | 'ask'; confirmed: string[]; remaining: string[]; taskIds: Id[]; composedBy: 'llm' | 'template'; error?: string };
    try {
      const response = await this.options.llm.complete({ model: this.options.model, maxTokens: 1200,
        system: [
          '당신은 Ensemble PM Agent입니다. Slack 스레드에서 멘션을 받았습니다.',
          'Space의 목표·확정 결정·작업 상태와 스레드 맥락만 근거로 같은 스레드에 한국어로 짧게(최대 3문장) 답하세요.',
          '확정되지 않은 것을 확정이라고 말하지 마세요. 사람의 확인이 필요하면 누구에게 무엇을 확인할지 질문하고 kind=ask, 다음 행동이나 사실을 알려 주면 kind=answer.',
          'confirmed에는 이미 확정된 내용, remaining에는 남은 일을 적으세요. taskIds에는 제공된 작업 id만 넣으세요. 내부 id를 문장에 쓰지 마세요.',
        ].join(' '),
        forceTool: 'slack_thread_reply',
        tools: [{ name: 'slack_thread_reply', description: '같은 Slack 스레드에 보낼 PM Agent 답변', inputSchema: { type: 'object', required: ['text', 'kind'], properties: {
          text: { type: 'string' }, kind: { enum: ['answer', 'ask'] }, confirmed: { type: 'array', items: { type: 'string' } }, remaining: { type: 'array', items: { type: 'string' } }, taskIds: { type: 'array', items: { type: 'string' } } } } }],
        messages: [{ role: 'user', content: JSON.stringify({ question, askedBy: author.kind === 'human' && author.memberId ? state.members.get(author.memberId)?.displayName ?? 'Slack 사용자' : 'Slack 사용자', space: this.spaceContext(state, conversation), thread: this.transcript(thread, state) }) }] });
      const input = response.toolCalls.find(c => c.name === 'slack_thread_reply')?.input;
      const text = typeof input?.text === 'string' ? input.text.trim() : '';
      if (!text || text.length > 2000 || (input?.kind !== 'answer' && input?.kind !== 'ask')) throw new Error('invalid_reply');
      return { text, kind: input.kind, confirmed: strings(input.confirmed), remaining: strings(input.remaining), taskIds: strings(input.taskIds, 20).filter(id => state.tasks.has(id)), composedBy: 'llm' } satisfies Composed;
    } catch (error) {
      // The fixed template still gives the person the Space's state; the ledger marks it as a template.
      const open = [...state.tasks.values()].filter(t => t.status !== 'cancelled' && t.status !== 'checked');
      const blocked = open.filter(t => t.status === 'blocked');
      const text = [
        state.goal ? `현재 Space 목표는 "${state.goal.text}"이에요.` : '아직 이 채널에 연결된 Space 목표가 없어요.',
        `확정된 결정 ${state.decisions.size}건, 진행 중인 작업 ${open.length}건${blocked.length ? `(막힘 ${blocked.length}건: ${blocked.map(t => t.spec.title).join(', ')})` : ''}이 있어요.`,
        '지금은 질문에 맞춘 답을 만들지 못했으니, 필요한 결정을 이 스레드에 적어 주시면 기록해 둘게요.',
      ].join(' ');
      return { text, kind: 'answer', confirmed: [], remaining: [], taskIds: [], composedBy: 'template', error: (error as Error)?.message === 'invalid_reply' ? 'invalid_reply' : 'model_unavailable' } satisfies Composed;
    }
  }

  private async classify(state: ProjectState, conversation: ExternalConversationState, event: SlackMessageEvent, author: ExternalAuthor, target: ExternalRequestState | undefined): Promise<{ kind?: ExternalMessageKind; confirmed: string[]; remaining: string[] }> {
    try {
      const response = await this.options.llm.complete({ model: this.options.model, maxTokens: 600,
        system: 'PM Agent가 참여한 Slack 스레드의 새 메시지를 분류하세요. decision=작성자가 무엇을 확정함, proposal=제안·의견, request=다른 사람에게 행동이나 답을 요청, answer=질문에 답했지만 확정은 아님, other=해당 없음. confirmed에는 이 메시지로 확정된 내용, remaining에는 남은 일을 적으세요.',
        forceTool: 'record_thread_reply',
        tools: [{ name: 'record_thread_reply', description: 'Slack 스레드 메시지 분류', inputSchema: { type: 'object', required: ['kind'], properties: {
          kind: { enum: [...MESSAGE_KINDS] }, confirmed: { type: 'array', items: { type: 'string' } }, remaining: { type: 'array', items: { type: 'string' } } } } }],
        messages: [{ role: 'user', content: JSON.stringify({ text: stripMention(event.text ?? '', this.options.binding.botUserId), authorKind: author.kind, mappedMember: !!author.memberId,
          answersRequest: target ? target.request.text : null, space: this.spaceContext(state, conversation) }) }] });
      const input = response.toolCalls.find(c => c.name === 'record_thread_reply')?.input;
      let kind = MESSAGE_KINDS.find(k => k === input?.kind);
      // Only a person mapped to a Space member can decide; anyone else's "decision" stays a proposal.
      if (kind === 'decision' && !(author.kind === 'human' && author.memberId && state.members.get(author.memberId)?.kind === 'human')) kind = 'proposal';
      return { ...(kind ? { kind } : {}), confirmed: kind === 'decision' ? strings(input?.confirmed) : [], remaining: strings(input?.remaining) };
    } catch {
      return { confirmed: [], remaining: [] };
    }
  }

  // --- helpers -----------------------------------------------------------------------------------

  private tracked(conversation: ExternalConversationState, event: SlackMessageEvent): boolean {
    const key = `${event.channel}:${event.thread_ts}`;
    return conversation.messages.some(m => m.author.kind === 'pm' && threadKey(m.source) === key)
      || [...conversation.requests.values()].some(r => threadKey(r.request.source) === key);
  }

  /** The request this message answers: the oldest awaiting one in its thread aimed at its author, else the latest unanswered-in-time one. */
  private answerTarget(conversation: ExternalConversationState, event: SlackMessageEvent, author: ExternalAuthor): ExternalRequestState | undefined {
    if (!event.thread_ts) return undefined;
    const key = `${event.channel}:${event.thread_ts}`;
    const mine = [...conversation.requests.values()].filter(r => threadKey(r.request.source) === key
      && (r.request.target.externalUserId === author.externalUserId || (r.request.target.externalUserId === ANY_SLACK_HUMAN && author.kind === 'human')));
    return mine.find(r => r.status === 'awaiting_response') ?? mine.filter(r => r.status === 'no_response').at(-1);
  }

  private author(externalUserId: string, state: ProjectState, botId?: string): ExternalAuthor {
    const { binding } = this.options;
    if (externalUserId === binding.botUserId || (botId && botId === binding.botId)) return { kind: 'pm', externalUserId };
    const fallback = binding.unmappedHumans === 'goal_decider' && !botId ? state.goal?.decider : undefined;
    const memberId = binding.users[externalUserId] ?? (botId ? binding.users[botId] : undefined) ?? fallback;
    const kind = memberId && state.members.get(memberId)?.kind === 'agent' ? 'agent' : 'human';
    return { kind, externalUserId, ...(memberId ? { memberId } : {}) };
  }

  /** The Slack account to address for a member: the mapping, then SLACK_OWNER_USER_ID for the decider, then "anyone" under the fallback. */
  private slackUserFor(memberId: Id, state: ProjectState): string | undefined {
    const { binding } = this.options;
    const mapped = Object.entries(binding.users).find(([, m]) => m === memberId)?.[0];
    if (mapped) return mapped;
    if (memberId === state.goal?.decider && binding.ownerUserId) return binding.ownerUserId;
    return binding.unmappedHumans === 'goal_decider' && memberId === state.goal?.decider ? ANY_SLACK_HUMAN : undefined;
  }

  private progress(entry: SlackProgress): void {
    try { this.options.onProgress?.(entry); } catch { /* Logging never breaks coordination. */ }
  }

  private source(event: Pick<SlackMessageEvent, 'channel' | 'ts' | 'thread_ts'>): ExternalSourceRef {
    return { provider: 'slack', workspaceId: this.options.binding.teamId, channelId: event.channel, messageTs: event.ts, ...(event.thread_ts && event.thread_ts !== event.ts ? { threadTs: event.thread_ts } : {}) };
  }

  private async post(channel: string, text: string, threadTs: string | undefined, triggerId: Id, requestId?: Id, attempt = 1): Promise<{ ok: true; ts: string } | { ok: false; error: string }> {
    try {
      const posted = await this.options.api.postMessage({ channel, text, ...(threadTs ? { threadTs } : {}) });
      return { ok: true, ts: posted.ts };
    } catch (error) {
      const code = slackErrorCode(error);
      await this.failure('send', 'chat.postMessage', triggerId, code, attempt, { channelId: channel, ...(threadTs ? { threadTs } : {}), ...(requestId ? { requestId } : {}) });
      return { ok: false, error: code };
    }
  }

  private async failure(stage: ExternalFailureStage, operation: string, triggerId: Id, error: string, attempt: number, extra: { requestId?: Id; channelId?: string; threadTs?: string } = {}) {
    const failureId = `${stage}:${triggerId}:${attempt}`;
    await this.options.store.append([this.event('external_delivery_failed', { failureId, stage, operation, triggerId, error, attempt, ...extra }, `slack-failure:${failureId}`)]);
    this.progress({ step: 'failure', stage, operation, error, triggerId, attempt });
  }

  private pmMessage(ts: string, threadTs: string | undefined, text: string, kind: ExternalMessageKind, composedBy: 'llm' | 'template', extra: { inReplyTo?: Id; confirmed?: string[]; remaining?: string[]; taskIds?: Id[] } = {}): NewLedgerEvent {
    const { binding } = this.options;
    const messageId = slackMessageId(binding.teamId, binding.channelId, ts);
    return this.event('external_message_observed', { messageId, source: this.source({ channel: binding.channelId, ts, ...(threadTs ? { thread_ts: threadTs } : {}) }),
      author: { kind: 'pm', externalUserId: binding.botUserId }, text, postedAt: slackTsToIso(ts), kind, composedBy, ...extra }, messageId);
  }

  private request(requestId: Id, ts: string, threadTs: string | undefined, target: ExternalAuthor, text: string, reason: ExternalRequestReason, triggerId: Id, taskIds: Id[], composedBy: 'llm' | 'template'): NewLedgerEvent {
    const { binding } = this.options;
    const dueAt = new Date(this.now().getTime() + (this.options.responseTimeoutMs ?? DAY_MS)).toISOString();
    return this.event('external_request_sent', { requestId, source: this.source({ channel: binding.channelId, ts, ...(threadTs ? { thread_ts: threadTs } : {}) }), target, text, reason, triggerId, taskIds, dueAt, composedBy }, requestId);
  }

  private resolution(requestId: Id, replyMessageId: Id, by: ExternalAuthor): NewLedgerEvent {
    return this.event('external_request_resolved', { requestId, outcome: 'answered', replyMessageId, by }, `${requestId}:resolved`);
  }

  private event<K extends 'external_message_observed' | 'external_request_sent' | 'external_request_resolved' | 'external_delivery_failed'>(type: K, payload: EventPayloads[K], idempotencyKey: string, at: Date = this.now()): NewLedgerEvent {
    return { ...this.context(), actor: PM_ACTOR, type, payload, idempotencyKey, at: at.toISOString() };
  }

  private context(): EventContext { const c = this.options.context; return typeof c === 'function' ? c() : c; }
  private now(): Date { return this.options.clock?.() ?? new Date(); }
  private read(): Promise<AnyEvent[]> { return this.options.store.read({ projectId: this.context().projectId }) as Promise<AnyEvent[]>; }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

/**
 * Builds the binding for a configured channel. Team and bot user ids come from auth.test when the settings leave
 * them out. Without SLACK_USER_MAP every unmapped human counts as the goal's decider (test fallback).
 */
export async function slackBindingFromConfig(config: { channelId: string; teamId?: string; botUserId?: string; users: Record<string, Id>; ownerUserId?: string }, api: Pick<SlackApi, 'authTest'>): Promise<SlackSpaceBinding> {
  const identity: { teamId: string; userId: string; botId?: string } = config.teamId && config.botUserId ? { teamId: config.teamId, userId: config.botUserId } : await api.authTest();
  return { teamId: config.teamId ?? identity.teamId, channelId: config.channelId, botUserId: config.botUserId ?? identity.userId,
    ...(identity.botId ? { botId: identity.botId } : {}), users: config.users,
    unmappedHumans: Object.keys(config.users).length ? 'none' : 'goal_decider', ...(config.ownerUserId ? { ownerUserId: config.ownerUserId } : {}) };
}
