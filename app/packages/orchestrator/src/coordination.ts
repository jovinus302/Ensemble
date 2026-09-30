import { affectedMembers, automationGate, diffPlans, forecastFromState, limitReachedEvent, project, applyOps, opAuthority } from '@ensemble/core';
import type { AnyEvent, EventContext, EventPayloads, EventType, LedgerEvent, NewLedgerEvent, PlanOp, ProjectState } from '@ensemble/core';
import type { SessionConnector, UpdateInstructionsInput } from '@ensemble/agents';
import type { LlmProvider, ToolSpec } from '@ensemble/llm';
import type { LedgerStore } from '@ensemble/store';
import { PM_SYSTEM_PROMPT } from './pm-prompt.ts';

export interface CoordinationInterpretation {
  category: string;
  summary: string;
  ops: PlanOp[];
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
const stringArray = { type: 'array', items: { type: 'string' } };
function interpretationTool(state: ProjectState): ToolSpec {
  const ids = (values: string[]) => ({ type: 'string', enum: values });
  const sourceMessageIds = { type: 'array', minItems: 1, items: ids(state.messages.filter(m => state.members.get(m.authorId)?.kind === 'human').map(m => m.messageId)) };
  const taskId = ids(state.plan?.tasks.map(t => t.id) ?? []);
  const memberId = ids([...state.members.keys()]);
  const op = (type: string, properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: ['type', 'sourceMessageIds', ...Object.keys(properties)], properties: { type: { const: type }, sourceMessageIds, ...properties } });
  return { name: 'interpret_coordination', description: '발언에서 근거가 있는 변경 연산만 추출한다. 결론과 권한은 코드가 판단한다.', inputSchema: { type: 'object', additionalProperties: false, required: ['category', 'summary', 'ops', 'conflicts'], properties: {
    category: { type: 'string' }, summary: { type: 'string' }, conflicts: stringArray,
    ops: { type: 'array', items: { oneOf: [
      op('set_availability', { memberId: ids([...state.members.values()].filter(m => m.kind === 'human').map(m => m.memberId)), weeklyHours: { type: 'number', minimum: 0 } }),
      op('exclude_scope', { taskId, item: { type: 'string', minLength: 1 } }),
      op('handoff_early', { taskId }), op('reassign', { taskId, assignee: memberId }),
      op('set_deadline', { date: { type: 'string' } }), op('change_goal', { text: { type: 'string', minLength: 1 } }),
    ] } },
  } } };
}
export function validOp(value: unknown, state: ProjectState): value is PlanOp {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!strings(v.sourceMessageIds) || !v.sourceMessageIds.length || !v.sourceMessageIds.every(id => state.messages.some(m => m.messageId === id && state.members.get(m.authorId)?.kind === 'human'))) return false;
  const fields: Record<string, string[]> = { set_availability: ['memberId', 'weeklyHours'], exclude_scope: ['taskId', 'item'], handoff_early: ['taskId'], reassign: ['taskId', 'assignee'], set_deadline: ['date'], change_goal: ['text'] };
  const allowed = fields[String(v.type)];
  if (!allowed || Object.keys(v).some(k => !['type', 'sourceMessageIds', ...allowed].includes(k))) return false;
  if (allowed.includes('taskId') && !state.plan?.tasks.some(t => t.id === v.taskId)) return false;
  switch (v.type) {
    case 'set_availability': return state.members.get(String(v.memberId))?.kind === 'human' && typeof v.weeklyHours === 'number' && Number.isFinite(v.weeklyHours) && v.weeklyHours >= 0;
    case 'exclude_scope': return typeof v.item === 'string' && !!v.item.trim();
    case 'handoff_early': return true;
    case 'reassign': return state.members.has(String(v.assignee));
    case 'set_deadline': return typeof v.date === 'string' && Number.isFinite(Date.parse(v.date));
    case 'change_goal': return typeof v.text === 'string' && !!v.text.trim();
    default: return false;
  }
}
function describeOp(op: PlanOp): string {
  switch (op.type) {
    case 'set_availability': return `${op.memberId} 가용 시간 주 ${op.weeklyHours}시간`;
    case 'exclude_scope': return `${op.taskId}에서 ${op.item} 제외`;
    case 'handoff_early': return `${op.taskId} 초안 단계에서 인계 가능`;
    case 'reassign': return `${op.taskId} 담당 ${op.assignee}`;
    case 'set_deadline': return `기한 ${op.date}`;
    case 'change_goal': return `목표 ${op.text}`;
  }
}
function operationKey(op: PlanOp): string {
  return JSON.stringify(Object.entries(op).filter(([key]) => key !== 'sourceMessageIds').sort(([a], [b]) => a.localeCompare(b)));
}
const judgementTool: ToolSpec = { name: 'judge_coordination', description: '세 원칙 질문에 답하고 발언 또는 침묵을 결정한다', inputSchema: { type: 'object', required: ['whoseAction', 'alreadyKnows', 'evidence', 'decision', 'reason', 'openTopics', 'text'], properties: {
  whoseAction: { type: ['string', 'null'] }, alreadyKnows: { enum: ['yes', 'no', 'unknown'] }, evidence: stringArray, decision: { enum: ['speak', 'silent'] }, reason: { type: 'string' }, openTopics: stringArray, text: { type: 'string' },
} } };

/** Fixed operations preserve task identity; authority and calculations stay in code. */
export class Coordinator {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private store: LedgerStore, private llm: LlmProvider, private connector: Pick<SessionConnector, 'sendUpdate'>, private options: CoordinatorOptions) {}

  onMessage(messageId: string): Promise<CoordinationResult> {
    const next = this.queue.then(() => this.consider(messageId));
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Card answers supply exact recorded operations, while sharing normal application and delivery. */
  onConfirmedOperations(messageId: string, ops: PlanOp[], requestId: string): Promise<CoordinationResult> {
    const next = this.queue.then(() => this.consider(messageId, ops, requestId));
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

  private async consider(messageId: string, confirmed?: PlanOp[], requestId?: string): Promise<CoordinationResult> {
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
    if (confirmed && (!confirmed.every(op => validOp(op, state) && opAuthority(state, op).allowed))) throw new Error('Invalid or unauthorized confirmed operation');
    const interpretation = confirmed ? { category: 'authority', summary: 'Approved authority request', ops: confirmed, conflicts: [] } : await this.call<CoordinationInterpretation>(interpretationTool(state), facts, v =>
      Object.keys(v).every(k => ['category', 'summary', 'ops', 'conflicts'].includes(k)) && typeof v.category === 'string' && typeof v.summary === 'string' && Array.isArray(v.ops) && v.ops.every(op => validOp(op, state)) && strings(v.conflicts) && v.conflicts.every(id => state.decisions.has(id)));
    const ops = interpretation?.ops ?? [];
    const candidate = structuredClone(state);
    if (candidate.plan) candidate.plan.tasks = applyOps(candidate.plan.tasks, ops);
    for (const op of ops) {
      if (op.type === 'set_availability') candidate.availability.set(op.memberId, op.weeklyHours);
      if (op.type === 'set_deadline' && candidate.goal) candidate.goal.deadline = op.date;
    }
    const proposed = forecastFromState(candidate, now);
    const assessed = ops.map(op => ({ op, ...opAuthority(state, op) }));
    const applied = assessed.filter(a => a.allowed).map(a => a.op).filter(op => {
      if (op.type === 'set_availability') return state.availability.get(op.memberId) !== op.weeklyHours;
      if (op.type === 'set_deadline') return state.goal?.deadline !== op.date;
      if (op.type === 'change_goal') return state.goal?.text !== op.text;
      return JSON.stringify(applyOps(state.plan?.tasks ?? [], [op])) !== JSON.stringify(state.plan?.tasks ?? []);
    });
    const pending = assessed.filter(a => !a.allowed);
    const tasks = applyOps(state.plan?.tasks ?? [], applied);
    const diff = diffPlans(state.plan?.tasks, tasks);
    const planChanged = diff.changed.length > 0;
    const affected = affectedMembers(state, diff);
    const participants = new Set(state.messages.filter(m => state.members.get(m.authorId)?.kind === 'human').map(m => m.authorId));
    const absent = affected.filter(id => !participants.has(id));
    const impact = { current, proposed, deltaDays: current.ok && proposed.ok ? { min: proposed.days.min - current.days.min, max: proposed.days.max - current.days.max } : null, diff, affected, absent, operations: assessed, conflicts: interpretation?.conflicts ?? [] };
    const lastAvailability = events.findLastIndex(e => e.type === 'availability_updated');
    const beforeAvailability = lastAvailability >= 0 ? forecastFromState(project(events.slice(0, lastAvailability)), now) : undefined;
    const factList = [
      ...state.messages.map(m => ({ id: `msg:${m.messageId}`, description: '기록된 사실', value: m })),
      ...[...state.decisions.values()].map(d => ({ id: `decision:${d.decisionId}`, description: '기록된 사실', value: d })),
      { id: 'forecast:current', description: '현재 계획의 계산 결과', value: current },
      { id: 'forecast:candidate', description: '후보 연산 적용 시 계산 결과와 현재 대비 일수 차이', value: { forecast: proposed, deltaDays: impact.deltaDays } },
      ...(beforeAvailability?.ok ? [{ id: 'forecast:before_availability', description: '마지막 가용 시간 기록 직전의 계획을 현재 시각으로 계산한 결과', value: beforeAvailability }] : []),
      ...(state.plan?.tasks ?? []).map(t => ({ id: `task:${t.id}`, description: '현재 작업', value: t })),
      ...[...state.availability].map(([id, hours]) => ({ id: `availability:${id}`, description: '주간 가용 시간', value: hours })),
      ...absent.map(id => ({ id: `absent:${id}`, description: '변경 영향이 있지만 대화에 없는 담당자', value: id })),
    ];
    const validIds = new Set(factList.map(f => f.id));
    const tool = structuredClone(judgementTool);
    (tool.inputSchema.properties as Record<string, unknown>).evidence = { type: 'array', items: { type: 'string', enum: [...validIds] } };
    let judgement: CoordinationJudgement | undefined = confirmed ? { whoseAction: message.authorId, alreadyKnows: 'no', evidence: [`msg:${messageId}`], decision: 'speak', reason: 'Person approved the recorded operation', openTopics: state.openTopics, text: '승인한 변경을 반영했습니다.' } : interpretation ? await this.call<CoordinationJudgement>(tool, { ...facts, factList, interpretation, impact }, v => (v.whoseAction === null || typeof v.whoseAction === 'string') && ['yes', 'no', 'unknown'].includes(String(v.alreadyKnows)) && strings(v.evidence) && v.evidence.every(id => validIds.has(id)) && ['speak', 'silent'].includes(String(v.decision)) && typeof v.reason === 'string' && strings(v.openTopics) && typeof v.text === 'string' && (v.decision !== 'speak' || v.text.trim().length > 0)) : undefined;
    const validJudgement = !!judgement;
    judgement ??= { whoseAction: null, alreadyKnows: 'unknown', evidence: [], decision: 'silent', reason: '판단 불가', openTopics: state.openTopics, text: '' };
    judgement.openTopics = [...new Set([...judgement.openTopics, ...pending.map(a => `${describeOp(a.op)} — ${a.personId ?? '결정권자'} 확인 필요`)])];
    if (judgement.decision === 'speak' && (!judgement.whoseAction?.trim() || judgement.alreadyKnows === 'yes' || !judgement.evidence.length)) judgement = { ...judgement, decision: 'silent', reason: '행동 변화 또는 새로운 근거 없음' };
    if (judgement.decision === 'speak' && prior.some(p => p.type === 'pm_considered' && JSON.stringify([...p.payload.evidence].sort()) === JSON.stringify([...judgement!.evidence].sort()))) judgement = { ...judgement, decision: 'silent', reason: '이미 전달한 근거' };
    let post: CoordinationResult['posts'][number] | undefined = judgement.decision === 'speak' ? { text: judgement.text, kind: 'answer' } : undefined;
    const append: NewLedgerEvent[] = [];
    if (confirmed && requestId) {
      const request = state.pendingAuthority.get(requestId);
      if (!request) return { posts: [], events: [] };
      if (request.personId !== message.authorId || !confirmed.every(op => operationKey(op) === request.operationKey)) throw new Error('Operation does not match authority request');
      append.push(make('authority_granted', { requestId, personId: message.authorId, granted: true }, `granted:${requestId}`));
    }
    const changeId = `${key}:change`;
    const deliveries: { agentId: string; taskId: string; input: UpdateInstructionsInput }[] = [];
    const summary = applied.map(describeOp).join(', ');
    const sourceMessageIds = [...new Set(applied.flatMap(op => op.sourceMessageIds))];
    const dropFor = (taskId: string) => applied.filter((op): op is Extract<PlanOp, { type: 'exclude_scope' }> => op.type === 'exclude_scope' && op.taskId === taskId).map(op => op.item);
    for (const [index, a] of pending.entries()) {
      if (judgement.decision !== 'speak' || !a.personId) continue;
      const text = `${a.personId}님, ${describeOp(a.op)} 변경을 승인하시겠어요?`;
      append.push(make('authority_requested', { requestId: `${changeId}:${index}:${a.personId}`, operationKey: operationKey(a.op), personId: a.personId, changeKinds: [a.kind], text }, `authority:${index}`));
      append.push(make('pm_spoke', { considerationId: key, messageId: `${key}:ask:${index}`, text, kind: 'ask' }, `ask:${index}`, true));
      post = undefined;
    }
    if (validJudgement && applied.length && state.goal && state.plan) {
      for (const request of state.pendingAuthority.values()) {
        if (!confirmed && applied.some(op => request.operationKey === operationKey(op) && state.messages.some(m => op.sourceMessageIds.includes(m.messageId) && m.authorId === request.personId))) {
          append.push(make('authority_granted', { requestId: request.requestId, personId: request.personId, granted: true }, `granted:${request.requestId}`));
        }
      }
      for (const [index, op] of applied.entries()) {
        if (op.type === 'set_availability') append.push(make('availability_updated', { memberId: op.memberId, weeklyHours: op.weeklyHours }, `availability:${index}`));
      }
      const goal = { ...state.goal };
      for (const op of applied) {
        if (op.type === 'set_deadline') goal.deadline = op.date;
        if (op.type === 'change_goal') goal.text = op.text;
      }
      const goalChanged = JSON.stringify(goal) !== JSON.stringify(state.goal);
      if (goalChanged) append.push(make('goal_set', goal, 'goal', true));
      if (planChanged || goalChanged) {
        post = { text: `정리하면: ${summary}`, kind: 'summary' };
        judgement = { ...judgement, decision: 'speak', whoseAction: affected.join(', ') || state.goal.decider, alreadyKnows: 'no', evidence: sourceMessageIds.map(id => `msg:${id}`), reason: '확인된 변경을 계획과 담당자에게 반영', text: post.text };
        append.push(make('decision_recorded', { decisionId: changeId, summary, sourceMessageIds, approvedBy: 'pm', changeKinds: [...new Set(applied.map(op => opAuthority(state, op).kind))] }));
        if (planChanged) append.push(make('plan_committed', { version: version + 1, basedOn: version, tasks, reason: summary, approvedBy: 'pm', sourceMessageIds }, 'plan_committed', true));
      }
      for (const id of absent.filter(id => state.members.get(id)?.kind === 'human')) {
        const details = diff.changed.filter(c => c.prev.assignee === id || c.next.assignee === id).map(c => `${c.next.title}: ${c.next.assignee === id ? c.next.handoffConditions.join(', ') : '담당 작업에서 제외'}`);
        const text = `${id}님, 계획 v${version + 1}: ${details.join('; ')}`;
        append.push(make('change_notified', { changeId, planVersion: version + 1, recipientId: id, text, via: 'channel' }, `notify:${id}`));
        append.push(make('pm_spoke', { considerationId: key, messageId: `${key}:speech:${id}`, text, kind: 'nudge' }, `speech:${id}`, true));
      }
      for (const id of affected.filter(id => state.members.get(id)?.kind === 'agent' && !state.activeTurn.has(id))) {
        append.push(make('change_notified', { changeId, planVersion: version + 1, recipientId: id, text: JSON.stringify({ summary, tasks: tasks.filter(t => t.assignee === id), drop: tasks.filter(t => t.assignee === id).flatMap(t => dropFor(t.id)) }), via: 'next_turn' }, `notify:${id}`));
      }
      for (const [agentId, taskId] of state.activeTurn) {
        if (!diff.changed.some(c => c.taskId === taskId)) continue;
        deliveries.push({ agentId, taskId, input: { updateId: `${changeId}:${agentId}`, fromVersion: version, toVersion: version + 1, keep: diff.unchanged.filter(t => t.assignee === agentId).map(t => t.title), change: diff.changed.filter(c => c.taskId === taskId).map(c => JSON.stringify(c.next)), drop: dropFor(taskId), reason: summary } });
      }
    }
    const tx = await this.store.transaction(this.options.projectId, fresh => {
      if (fresh.some(e => e.idempotencyKey === `${key}:pm_considered`)) return { append: [], result: false };
      const latest = project(fresh);
      if (confirmed && latest.lastSeq !== state.lastSeq) throw new Error('Ledger changed while applying approval; retry');
      if (latest.lastSeq !== state.lastSeq) { judgement = { ...judgement!, decision: 'silent', reason: '기록이 변경되어 재판단 필요' }; post = undefined; append.length = 0; deliveries.length = 0; }
      const gate = automationGate(latest);
      const cost = (post ? 1 : 0) + append.filter(e => e.actor.kind === 'pm').length + deliveries.length;
      if (!gate.allowed || cost > gate.remaining) {
        if (confirmed) throw new Error('Automation limit reached; resume before applying approval');
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
    for (const e of tx.appended as AnyEvent[]) if (e.type === 'pm_spoke' && e.idempotencyKey?.startsWith(`${key}:ask:`)) result.posts.push({ text: e.payload.text, kind: 'ask' });
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
