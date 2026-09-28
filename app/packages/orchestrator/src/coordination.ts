import { affectedMembers, automationGate, diffPlans, forecastFromState, limitReachedEvent, project, whoApproves } from '@ensemble/core';
import type { AnyEvent, ChangeKind, EventContext, EventPayloads, EventType, LedgerEvent, NewLedgerEvent, TaskSpec } from '@ensemble/core';
import type { SessionConnector, UpdateInstructionsInput } from '@ensemble/agents';
import type { LlmProvider, ToolSpec } from '@ensemble/llm';
import type { LedgerStore } from '@ensemble/store';
import { PM_SYSTEM_PROMPT } from './pm-prompt.ts';

export interface CoordinationInterpretation {
  category: string;
  conclusion: boolean;
  sourceMessageIds: string[];
  summary: string;
  tasks?: TaskSpec[];
  availability?: { memberId: string; weeklyHours: number }[];
  deadline?: string;
  goalText?: string;
  changeKinds: ChangeKind[];
  drop: string[];
  conflicts: string[];
}
export interface CoordinationJudgement {
  whoseAction: string | null;
  alreadyKnows: 'yes' | 'no' | 'unknown';
  evidence: string[];
  decision: 'speak' | 'silent';
  reason: string;
  openTopics: string[];
  text: string;
}
export interface CoordinationResult { posts: { text: string; kind: EventPayloads['pm_spoke']['kind'] }[]; events: LedgerEvent[] }
export interface CoordinatorOptions extends EventContext { model?: string; clock?: () => Date }
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string' && x.length > 0);
const kinds: ChangeKind[] = ['reorder', 'split_task', 'reassign_agent', 'scope_reduce', 'scope_add', 'deadline_change', 'goal_change', 'human_commitment'];
const stringArray = { type: 'array', items: { type: 'string' } };
const interpretationTool: ToolSpec = { name: 'interpret_coordination', description: '대화의 후보 변경과 결론을 해석한다', inputSchema: { type: 'object', required: ['category', 'conclusion', 'sourceMessageIds', 'summary', 'changeKinds', 'drop', 'conflicts'], properties: {
  category: { type: 'string' }, conclusion: { type: 'boolean' }, sourceMessageIds: stringArray, summary: { type: 'string' }, changeKinds: { type: 'array', items: { type: 'string', enum: kinds } }, drop: stringArray, conflicts: stringArray,
  tasks: { type: 'array', items: { type: 'object', required: ['id', 'title', 'assignee', 'dependsOn', 'handoffConditions'], properties: { id: { type: 'string' }, title: { type: 'string' }, assignee: { type: 'string' }, dependsOn: stringArray, handoffConditions: stringArray } } },
  availability: { type: 'array', items: { type: 'object', required: ['memberId', 'weeklyHours'], properties: { memberId: { type: 'string' }, weeklyHours: { type: 'number', minimum: 0 } } } }, deadline: { type: 'string' }, goalText: { type: 'string' },
} } };
const judgementTool: ToolSpec = { name: 'judge_coordination', description: '세 원칙 질문에 답하고 발언 또는 침묵을 결정한다', inputSchema: { type: 'object', required: ['whoseAction', 'alreadyKnows', 'evidence', 'decision', 'reason', 'openTopics', 'text'], properties: {
  whoseAction: { type: ['string', 'null'] }, alreadyKnows: { enum: ['yes', 'no', 'unknown'] }, evidence: stringArray, decision: { enum: ['speak', 'silent'] }, reason: { type: 'string' }, openTopics: stringArray, text: { type: 'string' },
} } };

/**
 * COMMITTED CHANGE proposition: record every judgement; apply only evidenced, delegated
 * conclusions, preserve old versions, and contact only changed recipients. SOUND:
 * two model judgements separate interpretation from code-owned forecast and authority.
 * Verification: coordination.test.ts exercises silence, forecast, commits, steering,
 * authority, repeats, invalid output, stale snapshots and the automation boundary.
 */
export class Coordinator {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private store: LedgerStore, private llm: LlmProvider, private connector: Pick<SessionConnector, 'sendUpdate'>, private options: CoordinatorOptions) {}

  onMessage(messageId: string): Promise<CoordinationResult> {
    const next = this.queue.then(() => this.consider(messageId));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async call<T>(tool: ToolSpec, facts: unknown, valid: (v: Record<string, unknown>) => boolean): Promise<T | undefined> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.llm.complete({ model: this.options.model ?? 'pm', system: PM_SYSTEM_PROMPT, forceTool: tool.name, tools: [tool], messages: [{ role: 'user', content: JSON.stringify({ facts, attempt }) }] });
        const call = response.toolCalls.length === 1 ? response.toolCalls[0] : undefined;
        if (call?.name === tool.name && call.input && valid(call.input)) return call.input as T;
      } catch { /* Transport and malformed output receive the same bounded retry. */ }
    }
    return undefined;
  }

  private async consider(messageId: string): Promise<CoordinationResult> {
    const events = await this.store.read({ projectId: this.options.projectId }) as AnyEvent[];
    const state = project(events);
    const message = state.messages.find(m => m.messageId === messageId);
    if (!message) throw new Error(`Unknown message ${messageId}`);
    if (events.some(e => e.type === 'pm_considered' && e.payload.triggerId === messageId)) return { posts: [], events: [] };
    const now = (this.options.clock ?? (() => new Date()))();
    const version = state.plan?.version ?? 0;
    const key = `coordination:${this.options.projectId}:${messageId}`;
    const make = <K extends EventType>(type: K, payload: EventPayloads[K], suffix: string = type, action = false): NewLedgerEvent => ({ projectId: this.options.projectId, targetProductId: this.options.targetProductId, type, payload, actor: { kind: action ? 'pm' : 'system', id: 'pm' }, at: now.toISOString(), idempotencyKey: `${key}:${suffix}` });
    const prior = events.filter(e => e.type === 'pm_considered' && events.some(s => s.type === 'pm_spoke' && s.payload.considerationId === e.payload.considerationId));
    const forecastInputs = events.filter(e => ['plan_committed', 'availability_updated', 'estimate_updated', 'goal_set', 'task_checked'].includes(e.type)).map(e => e.id);
    const current = forecastFromState(state, now);
    const facts = { messageId, planVersion: version, now, messages: state.messages, plan: state.plan, members: [...state.members.values()], activeTurns: [...state.activeTurn], availability: [...state.availability], estimates: [...state.estimates], goal: state.goal, currentForecast: current, forecastInputIds: forecastInputs, decisions: [...state.decisions.values()], pendingAuthority: [...state.pendingAuthority.values()], previousSpeech: prior, openTopics: state.openTopics };
    const interpretation = await this.call<CoordinationInterpretation>(interpretationTool, facts, v => {
      if (typeof v.category !== 'string' || typeof v.conclusion !== 'boolean' || typeof v.summary !== 'string' || !strings(v.sourceMessageIds) || !v.sourceMessageIds.every(id => state.messages.some(m => m.messageId === id)) || !strings(v.changeKinds) || !v.changeKinds.every(k => kinds.includes(k as ChangeKind)) || !strings(v.drop) || !strings(v.conflicts) || !v.conflicts.every(id => state.decisions.has(id))) return false;
      if (v.tasks !== undefined && (!Array.isArray(v.tasks) || !v.tasks.every(t => t && typeof t.id === 'string' && typeof t.title === 'string' && state.members.has(t.assignee) && strings(t.dependsOn) && strings(t.handoffConditions)) || new Set(v.tasks.map(t => t.id)).size !== v.tasks.length)) return false;
      if (v.availability !== undefined && (!Array.isArray(v.availability) || !v.availability.every(a => a && state.members.get(a.memberId)?.kind === 'human' && Number.isFinite(a.weeklyHours) && a.weeklyHours >= 0))) return false;
      return (v.deadline === undefined || (typeof v.deadline === 'string' && Number.isFinite(Date.parse(v.deadline)))) && (v.goalText === undefined || typeof v.goalText === 'string');
    });
    const candidate = structuredClone(state);
    const tasks = interpretation?.tasks ?? state.plan?.tasks ?? [];
    if (candidate.plan) candidate.plan.tasks = tasks;
    for (const spec of tasks) { const task = candidate.tasks.get(spec.id); if (task?.status === 'cancelled') task.status = 'waiting'; }
    for (const a of interpretation?.availability ?? []) candidate.availability.set(a.memberId, a.weeklyHours);
    if (candidate.goal && interpretation?.deadline) candidate.goal.deadline = interpretation.deadline;
    const proposed = forecastFromState(candidate, now);
    const diff = diffPlans(state.plan?.tasks, tasks);
    const shiftedTaskIds = current.ok && proposed.ok ? proposed.tasks.filter(t => {
      const old = current.tasks.find(p => p.taskId === t.taskId);
      return old && (JSON.stringify(old.min) !== JSON.stringify(t.min) || JSON.stringify(old.max) !== JSON.stringify(t.max));
    }).map(t => t.taskId) : [];
    const affected = [...new Set([...affectedMembers(state, diff), ...(interpretation?.availability ?? []).map(a => a.memberId), ...tasks.filter(t => shiftedTaskIds.includes(t.id)).map(t => t.assignee)])];
    const sources = state.messages.filter(m => interpretation?.sourceMessageIds.includes(m.messageId));
    const participants = new Set(sources.map(m => m.authorId));
    const absent = affected.filter(id => !participants.has(id));
    // Infer authority categories from actual changes too: model labels cannot grant authority.
    const changes = new Set<ChangeKind>(interpretation?.changeKinds ?? []);
    if (diff.removed.length) changes.add('scope_reduce');
    if (diff.added.length) changes.add('scope_add');
    for (const c of diff.changed) {
      if (c.fields.includes('assignee')) changes.add(state.members.get(c.next.assignee)?.kind === 'human' ? 'human_commitment' : 'reassign_agent');
      if (c.fields.includes('dependsOn')) changes.add('reorder');
      if (c.fields.includes('title')) { changes.add('scope_reduce'); changes.add('scope_add'); }
      if (c.prev.handoffConditions.some(x => !c.next.handoffConditions.includes(x))) changes.add('scope_reduce');
      if (c.next.handoffConditions.some(x => !c.prev.handoffConditions.includes(x))) changes.add('scope_add');
    }
    if (interpretation?.availability?.length) changes.add('human_commitment');
    if (interpretation?.deadline !== undefined) changes.add('deadline_change');
    if (interpretation?.goalText !== undefined) changes.add('goal_change');
    const approvers = new Set<string>();
    if (state.goal) for (const kind of changes) {
      const people = kind === 'human_commitment' ? [...new Set([...(interpretation?.availability ?? []).map(a => a.memberId), ...diff.changed.filter(c => c.fields.includes('assignee') && state.members.get(c.next.assignee)?.kind === 'human').map(c => c.next.assignee)])] : [undefined];
      if (!people.length) approvers.add(state.goal.decider);
      for (const person of people) { const approval = whoApproves({ kind, affectedPerson: person }, state.goal); if (approval.by === 'person') approvers.add(approval.personId); }
    }
    // Surface potentially overlapping confirmed decisions without pretending code can
    // settle a semantic contradiction. The model identifies the specific conflict.
    const overlappingDecisions = [...state.decisions.values()].filter(d => d.changeKinds.some(k => changes.has(k)));
    const impact = { current, proposed, deltaDays: current.ok && proposed.ok ? { min: proposed.days.min - current.days.min, max: proposed.days.max - current.days.max } : null, diff, affected, absent, conflicts: interpretation?.conflicts ?? [], overlappingDecisions, approvers: [...approvers], forecastInputIds: forecastInputs };
    const validIds = new Set([...events.map(e => e.id), ...state.messages.map(m => m.messageId)]);
    let judgement = interpretation ? await this.call<CoordinationJudgement>(judgementTool, { ...facts, interpretation, impact }, v => (v.whoseAction === null || typeof v.whoseAction === 'string') && ['yes', 'no', 'unknown'].includes(String(v.alreadyKnows)) && strings(v.evidence) && v.evidence.every(id => validIds.has(id)) && ['speak', 'silent'].includes(String(v.decision)) && typeof v.reason === 'string' && strings(v.openTopics) && typeof v.text === 'string' && (v.decision !== 'speak' || v.text.trim().length > 0)) : undefined;
    judgement ??= { whoseAction: null, alreadyKnows: 'unknown', evidence: [], decision: 'silent', reason: '판단 불가', openTopics: state.openTopics, text: '' };
    if (judgement.decision === 'speak' && (!judgement.whoseAction?.trim() || judgement.alreadyKnows === 'yes' || !judgement.evidence.length)) judgement = { ...judgement, decision: 'silent', reason: '행동 변화 또는 새로운 근거 없음' };
    if (judgement.decision === 'speak' && prior.some(p => p.type === 'pm_considered' && JSON.stringify([...p.payload.evidence].sort()) === JSON.stringify([...judgement!.evidence].sort()))) judgement = { ...judgement, decision: 'silent', reason: '이미 전달한 근거' };
    const conclusion = interpretation?.conclusion && changes.size > 0 && sources.some(m => m.authorId === state.goal?.decider || affected.includes(m.authorId));
    if (interpretation?.conclusion && !conclusion) judgement = { ...judgement, decision: 'silent', reason: '결론의 당사자 근거 없음' };
    if (!proposed.ok && proposed.reasons.some(r => r.kind === 'cycle' || r.kind === 'unknown_dependency')) judgement = { ...judgement, decision: 'silent', reason: '후보 계획의 선후 관계 오류' };
    let post: CoordinationResult['posts'][number] | undefined;
    const append: NewLedgerEvent[] = [];
    const changeId = `${key}:change`;
    const deliveries: { agentId: string; taskId: string; input: UpdateInstructionsInput }[] = [];
    if (judgement.decision === 'speak') {
      post = { text: judgement.text, kind: 'answer' };
      if (conclusion && interpretation && state.plan && state.goal) {
        if (approvers.size) {
          post = { text: `${[...approvers].join(', ')}님, ${interpretation.summary} 변경을 승인하시겠어요?`, kind: 'ask' };
          for (const personId of approvers) append.push(make('authority_requested', { requestId: `${changeId}:${personId}`, personId, changeKinds: [...changes], text: post.text }, `authority:${personId}`));
        } else {
          post = { text: `정리하면: ${interpretation.summary}`, kind: 'summary' };
          append.push(make('decision_recorded', { decisionId: changeId, summary: interpretation.summary, sourceMessageIds: interpretation.sourceMessageIds, approvedBy: 'pm', changeKinds: [...changes] }));
          append.push(make('plan_committed', { version: version + 1, basedOn: version, tasks, reason: interpretation.summary, approvedBy: 'pm', sourceMessageIds: interpretation.sourceMessageIds }, 'plan_committed', true));
          for (const id of absent.filter(id => state.members.get(id)?.kind === 'human')) {
            const own = [...diff.added, ...diff.removed, ...diff.changed.flatMap(c => [c.prev, c.next]), ...tasks.filter(t => shiftedTaskIds.includes(t.id))].filter(t => t.assignee === id);
            const details = own.map(t => {
              const next = tasks.find(n => n.id === t.id && n.assignee === id);
              return next ? `${next.title}: ${next.handoffConditions.join(', ') || '인계 조건 없음'}` : `${t.title}: 담당 작업에서 제외`;
            });
            const text = `${id}님, 계획 v${version + 1}: ${[...new Set(details)].join('; ')}`;
            append.push(make('change_notified', { changeId, planVersion: version + 1, recipientId: id, text, via: 'channel' }, `notify:${id}`));
            append.push(make('pm_spoke', { considerationId: key, messageId: `${key}:speech:${id}`, text, kind: 'nudge' }, `speech:${id}`, true));
          }
          for (const id of affected.filter(id => state.members.get(id)?.kind === 'agent' && !state.activeTurn.has(id))) {
            append.push(make('change_notified', { changeId, planVersion: version + 1, recipientId: id, text: JSON.stringify({ summary: interpretation.summary, tasks: tasks.filter(t => t.assignee === id), drop: interpretation.drop }), via: 'next_turn' }, `notify:${id}`));
          }
          for (const [agentId, taskId] of state.activeTurn) {
            if (!diff.changed.some(c => c.taskId === taskId) && !diff.removed.some(t => t.id === taskId)) continue;
            const removed = diff.removed.find(t => t.id === taskId);
            deliveries.push({ agentId, taskId, input: { updateId: `${changeId}:${agentId}`, fromVersion: version, toVersion: version + 1, keep: diff.unchanged.filter(t => t.assignee === agentId).map(t => t.title), change: removed ? ['작업 중단; 기존 산출물은 보존하되 다음 인계에서 제외'] : diff.changed.filter(c => c.taskId === taskId).map(c => JSON.stringify(c.next)), drop: [...new Set([...interpretation.drop, ...(removed ? [removed.title] : [])])], reason: interpretation.summary } });
          }
        }
      }
    }
    const tx = await this.store.transaction(this.options.projectId, fresh => {
      if (fresh.some(e => e.idempotencyKey === `${key}:pm_considered`)) return { append: [], result: false };
      const latest = project(fresh);
      if (latest.lastSeq !== state.lastSeq) { judgement = { ...judgement!, decision: 'silent', reason: '기록이 변경되어 재판단 필요' }; post = undefined; append.length = 0; deliveries.length = 0; }
      const gate = automationGate(latest);
      const cost = (post ? 1 : 0) + append.filter(e => e.actor.kind === 'pm').length + deliveries.length;
      if (!gate.allowed || cost > gate.remaining) {
        judgement = { ...judgement!, decision: 'silent', reason: '자동 행동 상한' }; post = undefined; append.length = 0; deliveries.length = 0;
        if (!latest.automation.limitReached) {
          append.push(limitReachedEvent(latest, { projectId: this.options.projectId, targetProductId: this.options.targetProductId }) ?? make('action_limit_reached', { count: latest.automation.actionsSinceResume, limit: 12 }));
          // The one required limit notice is a system safety notification, not another
          // automatic plan action. It still has a full principle record and speech ID.
          const limitId = `${key}:limit`;
          append.push(make('pm_considered', { considerationId: limitId, triggerId: messageId, whoseAction: `${latest.goal?.decider ?? '사용자'}: 자동 진행 재개 여부 결정`, alreadyKnows: 'unknown', evidence: fresh.map(e => e.id), decision: 'speak', reason: '자동 행동 상한에 도달하여 명시적 재개 필요', openTopics: judgement.openTopics }, 'limit-considered'));
          append.push(make('pm_spoke', { considerationId: limitId, messageId: `${limitId}:speech`, text: '자동 행동 상한에 도달했습니다. 계속하려면 재개해 주세요.', kind: 'ask' }, 'limit-speech'));
        }
      }
      append.unshift(make('pm_considered', { considerationId: key, triggerId: messageId, ...judgement! }));
      if (post) append.push(make('pm_spoke', { considerationId: key, messageId: `${key}:speech`, ...post }, 'pm_spoke', true));
      return { append, result: true };
    });
    if (!tx.result) return { posts: [], events: [] };
    const result: CoordinationResult = { posts: post ? [post] : [], events: tx.appended };
    for (const e of tx.appended as AnyEvent[]) if (e.type === 'change_notified' && e.payload.via === 'channel') result.posts.push({ text: e.payload.text, kind: 'nudge' });
    if (tx.appended.some(e => e.type === 'action_limit_reached')) result.posts.push({ text: '자동 행동 상한에 도달했습니다. 계속하려면 재개해 주세요.', kind: 'ask' });
    for (const delivery of deliveries) {
      let sent = false;
      try { sent = (await this.connector.sendUpdate(delivery.agentId, delivery.input)).sent; } catch { /* No blind retry on ambiguous delivery. */ }
      const recorded = await this.store.append([
        ...(sent ? [make('update_sent', { updateId: delivery.input.updateId, taskId: delivery.taskId, fromVersion: version, toVersion: version + 1 }, `update:${delivery.agentId}`, true)] : []),
        make('change_notified', { changeId, planVersion: version + 1, recipientId: delivery.agentId, text: JSON.stringify(delivery.input), via: sent ? 'steer' : 'next_turn' }, `notify:${delivery.agentId}`),
      ]);
      result.events.push(...recorded);
    }
    return result;
  }
}
