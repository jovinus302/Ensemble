import { availabilityWeek, formatKstDate, scopeItem, remainingScopeOps, type ForecastResult } from '@ensemble/core';
import { channelText, taskName, numericFacts, hasGroundedNumbers } from './channel-text.ts';
import { affectedMembers, automationGate, diffPlans, forecastFromState, isAutomationAction, limitReachedEvent, project, applyOps, opAuthority } from '@ensemble/core';
import { createHash } from 'node:crypto';
import type { AnyEvent, EventContext, EventPayloads, EventType, LedgerEvent, NewLedgerEvent, PlanOp, ProjectState } from '@ensemble/core';
import type { SessionConnector, UpdateInstructionsInput } from '@ensemble/agents';
import type { LlmProvider, ToolSpec } from '@ensemble/llm';
import type { LedgerStore } from '@ensemble/store';
import { PM_SYSTEM_PROMPT } from './pm-prompt.ts';
import { taskQuestions } from './context.ts';

export interface CoordinationInterpretation {
  category: string;
  summary: string;
  ops: PlanOp[];
  conflicts: string[];
  conversation?: { questionMessageId: string | null; waitingOnMemberIds: string[]; directedToPm: boolean };
  factMentions?: { messageId: string; factIds: string[] }[];
  agentAnswers?: { questionId: string; sourceMessageIds: string[] }[];
}
export interface CoordinationJudgement {
  whoseAction: string | null;
  alreadyKnows: 'yes' | 'no' | 'unknown';
  evidence: string[];
  decision: 'speak' | 'silent';
  reason: string;
  openTopics: string[];
  text: string;
  targetMemberIds?: string[];
  changesOpenQuestionAnswer?: boolean;
  answerFactIds?: string[];
  /** Code-owned fingerprints, persisted with the consideration for replay. */
  factVersions?: Record<string, string>;
}
export interface CoordinationResult { posts: { text: string; kind: EventPayloads['pm_spoke']['kind'] }[]; events: LedgerEvent[]; agentAnswers?: { taskId: string; questionId: string; text: string }[] }
export interface CoordinatorOptions extends EventContext { model?: string; clock?: () => Date }
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string' && x.length > 0);
const stringArray = { type: 'array', items: { type: 'string' } };
function validConversation(value: unknown, state: ProjectState, lastHumanId?: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (v.questionMessageId === null || v.questionMessageId === lastHumanId)
    && strings(v.waitingOnMemberIds) && v.waitingOnMemberIds.every(id => state.members.get(id)?.kind === 'human' && id !== state.messages.find(m => m.messageId === lastHumanId)?.authorId)
    && typeof v.directedToPm === 'boolean'
    && (v.questionMessageId !== null || (!v.waitingOnMemberIds.length && !v.directedToPm));
}
function interpretationTool(state: ProjectState): ToolSpec {
  const ids = (values: string[]) => ({ type: 'string', enum: values });
  const sourceMessageIds = { type: 'array', minItems: 1, items: ids(state.messages.filter(m => state.members.get(m.authorId)?.kind === 'human').map(m => m.messageId)) };
  const taskId = ids(state.plan?.tasks.map(t => t.id) ?? []);
  const memberId = ids([...state.members.keys()]);
  const op = (type: string, properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: ['type', 'sourceMessageIds', ...Object.keys(properties)], properties: { type: { const: type }, sourceMessageIds, ...properties } });
  return { name: 'interpret_coordination', description: '발언에서 근거가 있는 변경 연산과 대화 상대, 사실 언급을 추출한다. 결론과 권한은 코드가 판단한다.', inputSchema: { type: 'object', additionalProperties: false, required: ['category', 'summary', 'ops', 'conflicts', 'conversation', 'factMentions'], properties: {
    category: { type: 'string' }, summary: { type: 'string' }, conflicts: {
      type: 'array', description: '기존 decision_recorded 결정과 충돌할 때 그 decisionId만 선택. 작업 ID, 계획 이벤트 ID, 메시지 ID는 금지. 기존 결정이 없으면 반드시 [].',
      ...(state.decisions.size ? { items: ids([...state.decisions.keys()]) } : { maxItems: 0, items: { type: 'string' } }),
    },
    conversation: { type: 'object', additionalProperties: false, required: ['questionMessageId', 'waitingOnMemberIds', 'directedToPm'], properties: { questionMessageId: { type: ['string', 'null'], description: '마지막 사람 메시지의 질문·제안 ID, 없으면 null' }, waitingOnMemberIds: { type: 'array', items: memberId, description: '답을 기다리는 다른 사람 ID. 질문자 자신은 금지. directedToPm=true이면 반드시 빈 배열 []' }, directedToPm: { type: 'boolean', description: 'PM에게 계산·기록의 답을 묻는 질문이면 true. 사람에게 허락을 구하는 제안은 false' } } },
    factMentions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['messageId', 'factIds'], properties: { messageId: { type: 'string' }, factIds: stringArray } } },
    agentAnswers: { type: 'array', description: 'pendingAgentQuestions에 대한 사람의 답. 채널 반복 여부와 무관하게 전달한다.', items: { type: 'object', additionalProperties: false, required: ['questionId', 'sourceMessageIds'], properties: { questionId: { type: 'string' }, sourceMessageIds } } },
    ops: { type: 'array', items: { oneOf: [
      op('set_availability', { memberId: ids([...state.members.values()].filter(m => m.kind === 'human').map(m => m.memberId)), weeklyHours: { type: 'number', minimum: 0 }, period: { enum: ['this_week', 'ongoing', 'unclear'], description: '이번 주만/앞으로 계속/기간 불명확' } }),
      op('exclude_scope', { taskId, item: { type: 'string', minLength: 1 } }),
      op('limit_scope', { taskId, items: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } } }),
      op('handoff_early', { taskId }), op('reassign', { taskId, assignee: memberId }),
      op('set_deadline', { date: { type: 'string' } }), op('change_goal', { text: { type: 'string', minLength: 1 } }),
    ] } },
  } } };
}
export function validOp(value: unknown, state: ProjectState): value is PlanOp {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!strings(v.sourceMessageIds) || !v.sourceMessageIds.length || !v.sourceMessageIds.every(id => state.messages.some(m => m.messageId === id && state.members.get(m.authorId)?.kind === 'human'))) return false;
  const fields: Record<string, string[]> = { set_availability: ['memberId', 'weeklyHours', 'weekStart', 'period'], exclude_scope: ['taskId', 'item'], limit_scope: ['taskId', 'items'], handoff_early: ['taskId'], reassign: ['taskId', 'assignee'], set_deadline: ['date'], change_goal: ['text'] };
  const allowed = fields[String(v.type)];
  if (!allowed || Object.keys(v).some(k => !['type', 'sourceMessageIds', ...allowed].includes(k))) return false;
  if (allowed.includes('taskId') && !state.plan?.tasks.some(t => t.id === v.taskId)) return false;
  switch (v.type) {
    case 'set_availability': return state.members.get(String(v.memberId))?.kind === 'human' && typeof v.weeklyHours === 'number' && Number.isFinite(v.weeklyHours) && v.weeklyHours >= 0 && (v.period === undefined || ['this_week', 'ongoing', 'unclear'].includes(String(v.period))) && (v.weekStart === undefined || (typeof v.weekStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.weekStart) && availabilityWeek(new Date(`${v.weekStart}T00:00:00+09:00`)) === v.weekStart));
    case 'limit_scope': return strings(v.items) && v.items.length > 0;
    case 'exclude_scope': return typeof v.item === 'string' && !!v.item.trim();
    case 'handoff_early': return true;
    case 'reassign': return state.members.has(String(v.assignee));
    case 'set_deadline': return typeof v.date === 'string' && Number.isFinite(Date.parse(v.date));
    case 'change_goal': return typeof v.text === 'string' && !!v.text.trim();
    default: return false;
  }
}
function describeOp(op: PlanOp, state: ProjectState): string {
  const name = (id: string) => state.members.get(id)?.displayName ?? id;
  switch (op.type) {
    case 'set_availability': return `${name(op.memberId)} 가용 시간 ${op.weekStart ? "이번 주만" : "매주"} ${op.weeklyHours}시간`;
    case 'exclude_scope': return `${taskName(state, op.taskId)}에서 ${op.item} 제외`;
    case 'limit_scope': return `${taskName(state, op.taskId)} 범위를 ${op.items.map(scopeItem).join(' · ')}까지만 한정`;
    case 'handoff_early': return `${taskName(state, op.taskId)} 초안 단계에서 인계 가능`;
    case 'reassign': return `${taskName(state, op.taskId)} 담당 ${name(op.assignee)}`;
    case 'set_deadline': return `기한 ${op.date}`;
    case 'change_goal': return `목표 ${op.text}`;
  }
}
function operationKey(op: PlanOp): string {
  return JSON.stringify(Object.entries(op).filter(([key]) => key !== 'sourceMessageIds').sort(([a], [b]) => a.localeCompare(b)));
}
const judgementTool: ToolSpec = { name: 'judge_coordination', description: '세 원칙 질문에 답하고 발언 또는 침묵을 결정한다', inputSchema: { type: 'object', required: ['whoseAction', 'alreadyKnows', 'evidence', 'decision', 'reason', 'openTopics', 'text', 'targetMemberIds', 'changesOpenQuestionAnswer', 'answerFactIds'], properties: {
  whoseAction: { type: ['string', 'null'] }, alreadyKnows: { enum: ['yes', 'no', 'unknown'] }, evidence: stringArray, decision: { enum: ['speak', 'silent'] }, reason: { type: 'string' }, openTopics: stringArray, text: { type: 'string' },
  targetMemberIds: stringArray, changesOpenQuestionAnswer: { type: 'boolean' }, answerFactIds: stringArray,
} } };
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function forecastMeaning(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return Number(value.toFixed(1));
  if (Array.isArray(value)) return value.map(forecastMeaning);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, forecastMeaning(k === 'shortages' && Array.isArray(v) ? v.filter(s => Number(s.hours.toFixed(1)) > 0) : v)]));
  return value;
}
function factFingerprint(id: string, value: unknown): string {
  if (!id.startsWith('forecast:')) return fingerprint(value);
  if (value && typeof value === 'object' && 'capacity' in value) {
    const { capacity, ...rest } = value as Record<string, unknown>;
    return fingerprint(forecastMeaning({ forecast: rest.forecast ?? rest, capacity }));
  }
  return fingerprint(forecastMeaning(value));
}

function forecastAnswer(forecast: ForecastResult, state: ProjectState): string {
  if (!forecast.ok) {
    const labels = { missing_estimate: '작업 예상 시간 미입력', missing_availability: '담당자 가용 시간 미입력', zero_availability: '담당자 가용 시간 없음', cycle: '작업 의존 관계 순환', unknown_dependency: '선행 작업 누락' };
    return `현재는 ${[...new Set(forecast.reasons.map(r => labels[r.kind]))].join(', ')} 때문에 종료일을 계산할 수 없습니다.`;
  }
  const range = `현재 기록 기준 예상 종료는 ${formatKstDate(forecast.end.min)}~${formatKstDate(forecast.end.max)}(서울 시간)입니다.`;
  if (forecast.shortages.length) return `${range} 기한 내 가용 시간이 부족한 담당자는 ${forecast.shortages.map(s => `${state.members.get(s.memberId)?.displayName ?? '담당자'}(${Number(s.hours.toFixed(1))}시간 부족)`).join(', ')}입니다.`;
  return `${range}${forecast.lateness ? forecast.lateness.maxDays > 0 ? ` 현재 작업 시간과 선후 관계 기준 최대 ${Number(forecast.lateness.maxDays.toFixed(1))}일 기한을 넘깁니다.` : ' 현재 계산으로는 기한 안에 끝납니다.' : ''}`;
}

const calendarForecast = (forecast: ForecastResult) => forecast.ok ? { ...forecast, calendarDates: { timeZone: 'Asia/Seoul', min: formatKstDate(forecast.end.min), max: formatKstDate(forecast.end.max) } } : forecast;

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

  private async call<T>(tool: ToolSpec, facts: unknown, valid: (v: Record<string, unknown>) => boolean | string[]): Promise<T | undefined> {
    let validationError: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.llm.complete({ model: this.options.model ?? 'pm', system: PM_SYSTEM_PROMPT, forceTool: tool.name, tools: [tool], messages: [{ role: 'user', content: JSON.stringify({ facts, attempt, ...(validationError ? { validationError } : {}) }) }] });
        const call = response.toolCalls.length === 1 ? response.toolCalls[0] : undefined;
        const validation = call?.name === tool.name && call.input ? valid(call.input) : false;
        if (validation === true || (Array.isArray(validation) && !validation.length)) return structuredClone(call!.input) as T;
        validationError = Array.isArray(validation) ? validation.join('\n') : '이전 응답이 검증에 실패했습니다. 지정 도구의 JSON 스키마와 ID enum을 지키세요. evidence/targetMemberIds/answerFactIds/openTopics/ops/conflicts/factMentions는 문자열이 아니라 배열입니다. 숫자는 allowedNumericValues, 날짜는 calendarDates만 사용하세요. 직접 질문은 근거 있는 사실로 답하고, 변경 연산의 sourceMessageIds는 실제 사람 메시지만 쓰세요.';
      } catch { /* Transport and malformed output receive the same bounded retry. */ }
    }
    return undefined;
  }

  private async consider(messageId: string, confirmed?: PlanOp[], requestId?: string, retry = 0): Promise<CoordinationResult> {
    const events = await this.store.read({ projectId: this.options.projectId }) as AnyEvent[];
    const state = project(events);
    const message = state.messages.find(m => m.messageId === messageId);
    if (!message) throw new Error(`Unknown message ${messageId}`);
    state.messages = state.messages.filter(m => m.seq <= message.seq || state.members.get(m.authorId)?.kind !== 'human');
    if (events.some(e => e.type === 'pm_considered' && e.payload.triggerId === messageId)) return { posts: [], events: [] };
    const now = (this.options.clock ?? (() => new Date()))();
    const version = state.plan?.version ?? 0;
    const key = `coordination:${this.options.projectId}:${messageId}`;
    const make = <K extends EventType>(type: K, payload: EventPayloads[K], suffix: string = type, action = false): NewLedgerEvent => ({ projectId: this.options.projectId, targetProductId: this.options.targetProductId, type, payload, actor: { kind: action ? 'pm' : 'system', id: 'pm' }, at: now.toISOString(), idempotencyKey: `${key}:${suffix}` });
    const prior = events.filter(e => e.type === 'pm_considered' && events.some(s => s.type === 'pm_spoke' && s.payload.considerationId === e.payload.considerationId));
    const forecastInputs = events.filter(e => ['plan_committed', 'availability_updated', 'estimate_updated', 'goal_set', 'task_checked'].includes(e.type)).map(e => e.id);
    const current = forecastFromState(state, now);
    const knownFacts = [
      { id: 'forecast:current', value: current },
      ...(state.plan?.tasks ?? []).map(t => ({ id: `task:${t.id}`, value: t })),
      ...[...state.availability].map(([id, hours]) => ({ id: `availability:${id}`, value: hours })),
      ...[...state.decisions.values()].map(d => ({ id: `decision:${d.decisionId}`, value: d })),
    ];
    const humanMessages = state.messages.filter(m => state.members.get(m.authorId)?.kind === 'human');
    const lastHuman = humanMessages.at(-1);
    const pendingAgentQuestions = [...state.tasks.values()].filter(t => state.members.get(t.spec.assignee)?.kind === 'agent').flatMap(t => taskQuestions(events, t.spec.id).filter(q => !q.answer).map(q => ({ ...q, taskId: t.spec.id })));
    const facts = { messageId, planVersion: version, now, messages: state.messages, knownFacts, pendingAgentQuestions, plan: state.plan, members: [...state.members.values()], activeTurns: [...state.activeTurn], availability: [...state.availability], estimates: [...state.estimates], goal: state.goal, currentForecast: calendarForecast(current), forecastInputIds: forecastInputs, decisions: [...state.decisions.values()], pendingAuthority: [...state.pendingAuthority.values()], previousSpeech: prior, openTopics: state.openTopics };
    if (confirmed && (!confirmed.every(op => validOp(op, state) && opAuthority(state, op).allowed))) throw new Error('Invalid or unauthorized confirmed operation');
    const interpretation = confirmed ? { category: 'authority', summary: '기록된 변경 승인', ops: confirmed, conflicts: [] } : !state.plan ? undefined : await this.call<CoordinationInterpretation>(interpretationTool(state), facts, v => {
      const errors: string[] = [];
      if (!Object.keys(v).every(k => ['category', 'summary', 'ops', 'conflicts', 'conversation', 'factMentions', 'agentAnswers'].includes(k))) errors.push('최상위 필드는 category, summary, ops, conflicts, conversation, factMentions, agentAnswers만 허용합니다.');
      if (typeof v.category !== 'string' || typeof v.summary !== 'string') errors.push('category와 summary는 문자열이어야 합니다.');
      if (!Array.isArray(v.ops) || !v.ops.every(op => validOp(op, state))) errors.push('ops: 허용된 연산 필드·작업/담당자 ID·실제 사람 sourceMessageIds만 사용하세요.');
      if (!strings(v.conflicts) || !v.conflicts.every(id => state.decisions.has(id))) errors.push(`conflicts: 기존 결정의 decisionId만 허용합니다. 허용 ID=${JSON.stringify([...state.decisions.keys()])}. 작업/계획 이벤트/메시지 ID는 결정 ID가 아닙니다.${state.decisions.size ? '' : ' 기존 결정이 없으므로 conflicts는 반드시 []입니다.'}`);
      if (!(v.agentAnswers === undefined || (Array.isArray(v.agentAnswers) && v.agentAnswers.every(a => a && typeof a === 'object' && pendingAgentQuestions.some(q => q.questionId === a.questionId) && strings(a.sourceMessageIds) && a.sourceMessageIds.includes(messageId) && a.sourceMessageIds.every((id: string) => humanMessages.some(m => m.messageId === id)))))) errors.push('agentAnswers: 미해결 질문 ID와 현재 메시지를 포함한 사람 sourceMessageIds만 허용합니다.');
      if (!validConversation(v.conversation, state, lastHuman?.messageId)) errors.push(`conversation: questionMessageId는 ${lastHuman?.messageId} 또는 null이며, waitingOnMemberIds는 질문자를 제외한 사람 ID 배열입니다. 질문이 없으면 null/[]/false를 쓰세요.`);
      if (!Array.isArray(v.factMentions) || !v.factMentions.every(mention => mention && typeof mention === 'object' && humanMessages.some(m => m.messageId === mention.messageId) && strings(mention.factIds) && mention.factIds.every((id: string) => knownFacts.some(f => f.id === id)))) errors.push('factMentions: 실제 사람 messageId와 knownFacts의 id만 배열로 사용하세요.');
      return errors;
    });
    const unclearAvailability = (interpretation?.ops ?? []).filter(op => op.type === 'set_availability' && (op as PlanOp & { period?: string }).period === 'unclear');
    const ops = remainingScopeOps(state, (interpretation?.ops ?? []).filter(op => !unclearAvailability.includes(op)).map(op => {
      if (op.type !== 'set_availability') return op;
      const { period, ...operation } = op as Extract<PlanOp, { type: 'set_availability' }> & { period?: string };
      return { ...operation, ...(period === 'this_week' ? { weekStart: availabilityWeek(now) } : {}) };
    }));
    const conversation = interpretation?.conversation ?? { questionMessageId: null, waitingOnMemberIds: [], directedToPm: false };
    const openHumanQuestion = conversation.questionMessageId !== null && conversation.waitingOnMemberIds.length > 0 && !conversation.directedToPm;
    const candidate = structuredClone(state);
    if (candidate.plan) candidate.plan.tasks = applyOps(candidate.plan.tasks, ops);
    for (const op of ops) {
      if (op.type === 'set_availability') {
        if (op.weekStart) { const weeks = candidate.availabilityOverrides.get(op.memberId) ?? new Map<string, number>(); weeks.set(op.weekStart, op.weeklyHours); candidate.availabilityOverrides.set(op.memberId, weeks); }
        else candidate.availability.set(op.memberId, op.weeklyHours);
      }
      if (op.type === 'set_deadline' && candidate.goal) candidate.goal.deadline = op.date;
    }
    const proposed = forecastFromState(candidate, now);
    const assessed = ops.map(op => ({ op, ...opAuthority(state, op) }));
    const applied = assessed.filter(a => a.allowed).map(a => a.op).filter(op => {
      if (op.type === 'set_availability') return (op.weekStart ? state.availabilityOverrides.get(op.memberId)?.get(op.weekStart) : state.availability.get(op.memberId)) !== op.weeklyHours;
      // A question/proposal awaiting a person is not a confirmed plan change,
      // even when its author would have authority to make that change.
      if (openHumanQuestion && op.sourceMessageIds.includes(conversation.questionMessageId!)) return false;
      if (op.type === 'set_deadline') return state.goal?.deadline !== op.date;
      if (op.type === 'change_goal') return state.goal?.text !== op.text;
      return JSON.stringify(applyOps(state.plan?.tasks ?? [], [op])) !== JSON.stringify(state.plan?.tasks ?? []);
    });
    const pending = assessed.filter(a => !a.allowed);
    const tasks = applyOps(state.plan?.tasks ?? [], applied);
    const diff = diffPlans(state.plan?.tasks, tasks);
    const planChanged = diff.changed.length > 0;
    const reopened = diff.changed.filter(c => state.tasks.get(c.taskId)?.status === 'checked' || state.tasks.get(c.taskId)?.blocked?.prevStatus === 'checked');
    const dependsOnRework = (id: string, seen = new Set<string>()): boolean => {
      if (seen.has(id)) return false;
      seen.add(id);
      return (state.tasks.get(id)?.spec.dependsOn ?? []).some(dep => reopened.some(c => c.taskId === dep) || dependsOnRework(dep, seen));
    };
    const reworkDependents = [...state.tasks.values()].filter(t => ['running', 'reserved'].includes(t.status) && dependsOnRework(t.spec.id));
    const reworkText = reopened.length ? `${reopened.map(c => c.next.title).join(' · ')} 작업의 명세가 바뀌어 다시 확인이 필요합니다` : '';
    const affected = [...new Set([...affectedMembers(state, diff), ...reworkDependents.map(t => t.spec.assignee)])];
    const participants = new Set(state.messages.filter(m => state.members.get(m.authorId)?.kind === 'human').map(m => m.authorId));
    const absent = affected.filter(id => !participants.has(id) || reworkDependents.some(t => t.spec.assignee === id) || reopened.some(c => c.next.assignee === id));
    const impact = { current, proposed, deltaDays: current.ok && proposed.ok ? { min: proposed.days.min - current.days.min, max: proposed.days.max - current.days.max } : null, diff, affected, absent, operations: assessed, conflicts: interpretation?.conflicts ?? [] };
    const lastAvailability = events.findLastIndex(e => e.type === 'availability_updated');
    const beforeState = lastAvailability >= 0 ? project(events.slice(0, lastAvailability)) : undefined;
    const beforeAvailability = beforeState ? forecastFromState(beforeState, now) : undefined;
    const capacity = (s: ProjectState) => [...s.members.values()].filter(m => m.kind === 'human').map(m => ({ memberId: m.memberId, name: m.displayName, baselineWeeklyHours: s.availability.get(m.memberId), overrides: [...(s.availabilityOverrides.get(m.memberId) ?? [])] }));
    const factList: { id: string; description: string; value: unknown }[] = [
      ...state.messages.map(m => ({ id: `msg:${m.messageId}`, description: '기록된 사실', value: m })),
      ...[...state.decisions.values()].map(d => ({ id: `decision:${d.decisionId}`, description: '기록된 사실', value: d })),
      { id: 'forecast:current', description: '현재 계획의 계산 결과와 사람별 기준 시간', value: { ...calendarForecast(current), capacity: capacity(state) } },
      { id: 'forecast:candidate', description: '후보 연산 적용 시 계산 결과와 현재 대비 일수 차이', value: { forecast: calendarForecast(proposed), deltaDays: impact.deltaDays, capacity: capacity(candidate) } },
      ...(beforeAvailability?.ok ? [{ id: 'forecast:before_availability', description: '마지막 가용 시간 기록 직전의 계획을 현재 시각으로 계산한 결과', value: { ...calendarForecast(beforeAvailability), capacity: capacity(beforeState!) } }] : []),
      ...(state.plan?.tasks ?? []).map(t => ({ id: `task:${t.id}`, description: '현재 작업', value: t })),
      ...[...state.availability].map(([id, hours]) => ({ id: `availability:${id}`, description: '주간 가용 시간', value: hours })),
      ...absent.map(id => ({ id: `absent:${id}`, description: '변경 영향이 있지만 대화에 없는 담당자', value: id })),
    ];
    const availabilityDelta = current.ok && beforeAvailability?.ok ? { min: current.days.min - beforeAvailability.days.min, max: current.days.max - beforeAvailability.days.max } : null;
    factList.push({ id: 'forecast:availability_delta', description: '가용 시간 변경 전후의 예측 차이(일)', value: availabilityDelta });
    const allowedNumbers = numericFacts(factList.map(f => f.value));
    const validIds = new Set(factList.map(f => f.id));
    const factVersions = Object.fromEntries(factList.map(f => [f.id, factFingerprint(f.id, f.value)]));
    const knowledge = factList.map(f => {
      const posted = prior.some(p => p.type === 'pm_considered' && p.payload.evidence.some(id => {
        const version = (p.payload as Pick<CoordinationJudgement, 'factVersions'>).factVersions?.[id];
        return (id === f.id && (!version || version === factVersions[f.id]))
          || (id.startsWith('forecast:') && f.id.startsWith('forecast:') && version === factVersions[f.id]);
      }));
      const mentionedBy = humanMessages.filter(m => interpretation?.factMentions?.some(mention => mention.messageId === m.messageId && mention.factIds.includes(f.id))).map(m => m.authorId);
      return { factId: f.id, posted, knownBy: [...new Set([...mentionedBy, ...(posted ? humanMessages.map(m => m.authorId) : [])])] };
    });
    const tool = structuredClone(judgementTool);
    (tool.inputSchema.properties as Record<string, unknown>).evidence = { type: 'array', items: { type: 'string', enum: [...validIds] } };
    let judgement: CoordinationJudgement | undefined = confirmed ? { whoseAction: message.authorId, alreadyKnows: 'no', evidence: [`msg:${messageId}`], decision: 'speak', reason: '담당자가 기록된 변경을 승인했다', openTopics: state.openTopics, text: '승인한 변경을 반영했습니다.' } : interpretation ? await this.call<CoordinationJudgement>(tool, { ...facts, factList, allowedNumericValues: [...allowedNumbers], interpretation, impact, knowledge, conversation, openHumanQuestion }, v => (v.whoseAction === null || typeof v.whoseAction === 'string') && ['yes', 'no', 'unknown'].includes(String(v.alreadyKnows)) && strings(v.evidence) && v.evidence.every(id => validIds.has(id)) && ['speak', 'silent'].includes(String(v.decision)) && typeof v.reason === 'string' && strings(v.openTopics) && typeof v.text === 'string' && hasGroundedNumbers(v.text, allowedNumbers) && (v.decision !== 'speak' || v.text.trim().length > 0)
      && strings(v.targetMemberIds) && v.targetMemberIds.every(id => state.members.has(id)) && (v.decision !== 'speak' || v.targetMemberIds.length > 0)
      && typeof v.changesOpenQuestionAnswer === 'boolean'
      && strings(v.answerFactIds) && v.answerFactIds.every(id => validIds.has(id) && (v.evidence as string[]).includes(id))) : undefined;
    const validJudgement = !!judgement;
    judgement ??= { whoseAction: null, alreadyKnows: 'unknown', evidence: [], decision: 'silent', reason: '판단 불가', openTopics: state.openTopics, text: '' };
    judgement.factVersions = factVersions;
    judgement.openTopics = [...new Set([...judgement.openTopics, ...pending.map(a => `${describeOp(a.op, state)} — ${a.personId ?? '결정권자'} 확인 필요`)])];
    if (judgement.decision === 'speak' && (!judgement.whoseAction?.trim() || judgement.alreadyKnows === 'yes' || !judgement.evidence.length)) judgement = { ...judgement, decision: 'silent', reason: '행동 변화 또는 새로운 근거 없음' };
    const computedEvidence = judgement.evidence.filter(id => !id.startsWith('msg:'));
    const targets = judgement.targetMemberIds?.length ? judgement.targetMemberIds : state.members.has(judgement.whoseAction ?? '') ? [judgement.whoseAction!] : [];
    const known = (id: string) => knowledge.some(k => k.factId === id && (k.posted || (targets.length > 0 && targets.every(target => k.knownBy.includes(target)))));
    const newFacts = computedEvidence.filter(id => !known(id));
    const directAnswer = conversation.directedToPm && judgement.answerFactIds?.some(id => id !== `msg:${conversation.questionMessageId}`);
    if (!confirmed && judgement.decision === 'speak') {
      if (!computedEvidence.length && !directAnswer) judgement = { ...judgement, decision: 'silent', reason: '이미 나온 말의 반복: 대화 밖에서 계산한 새 사실 없음' };
      else if ((computedEvidence.length > 0 && !newFacts.length) || (!computedEvidence.length && judgement.evidence.every(known))) judgement = { ...judgement, alreadyKnows: 'yes', decision: 'silent', reason: '이미 전달한 근거: 대상자가 이미 아는 사실' };
      else if (openHumanQuestion && (participants.has(state.goal?.decider ?? '') || !newFacts.length || judgement.changesOpenQuestionAnswer !== true)) judgement = { ...judgement, decision: 'silent', reason: '결정권자가 참여한 사람 사이 질문은 답을 기다린다' };
      // A person's own capacity update is already shared with the present decider.
      // It records a commitment, not a request for the PM to start coordinating it.
      if (!conversation.directedToPm && participants.has(state.goal?.decider ?? '')
        && applied.length > 0 && applied.every(op => op.type === 'set_availability' && op.memberId === message.authorId)
        && pending.length === 0 && !interpretation?.conflicts.length) {
        judgement = { ...judgement, decision: 'silent', reason: '본인이 공유한 가용 시간은 기록하고 참여 중인 결정권자와의 조율을 기다린다' };
      }
    }
    if (unclearAvailability.length) judgement = { ...judgement, decision: 'speak', whoseAction: message.authorId, alreadyKnows: 'no', evidence: [`msg:${messageId}`], reason: '기간이 불명확하여 가용 시간을 바꾸기 전에 확인이 필요하다', text: '말씀하신 가용 시간은 이번 주만인가요, 앞으로도 매주 같은가요?' };
    // Recovery only: a rejected interpretation cannot identify a direct question for us.
    const directQuestion = conversation.directedToPm || (!interpretation && /(?:PM|피엠|일정|지연|밀리|밀려|언제|기한)/i.test(message.text) && /[?？]|(?:나요|인가요|할까|밀리나|알려\s*줘|알려\s*주세요)/.test(message.text));
    if (!validJudgement && directQuestion) judgement = { ...judgement, whoseAction: message.authorId, alreadyKnows: 'no', evidence: ['forecast:current'], decision: 'speak', reason: '직접 질문의 모델 판단 검증 실패 후 기록 기반 계산 답변', text: forecastAnswer(current, state) };
    // A validated, authorized explicit exclusion does not need model prose to be applied.
    // If interpretation itself is missing, ask instead of guessing an operation.
    const exclusionConclusion = !validJudgement && message.authorId === state.goal?.decider && !openHumanQuestion && !conversation.questionMessageId
      && applied.length > 0 && !interpretation?.conflicts.length && applied.every(op => op.type === 'exclude_scope' && op.sourceMessageIds.includes(messageId) && message.text.includes(op.item)) && /빼|제외/.test(message.text);
    if (!validJudgement && !exclusionConclusion && !directQuestion && message.authorId === state.goal?.decider && /빼|제외|확정|바꾸자/.test(message.text)) judgement = { ...judgement, whoseAction: message.authorId, alreadyKnows: 'no', evidence: [`msg:${messageId}`], decision: 'speak', reason: '결정권자의 변경 발언을 검증하지 못해 재확인한다', text: '변경 내용을 확인하지 못해, 적용할 작업과 변경할 범위를 다시 알려주시겠어요?' };
    if (!state.plan && state.members.get(message.authorId)?.kind === 'human') judgement = { ...judgement, whoseAction: message.authorId, alreadyKnows: 'no', evidence: [`msg:${messageId}`], decision: 'speak', reason: '계획이 없어 다음 시작 경로를 안내한다', text: state.pendingPlans.size ? '제안된 계획 초안을 확인하고 승인해 주세요.' : '자유형식에서 말씀하신 목표로 계획을 만들어 볼까요?' };
    judgement.text = channelText(judgement.text, state);
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
    const summary = applied.map(op => describeOp(op, state)).join(', ');
    const sourceMessageIds = [...new Set(applied.flatMap(op => op.sourceMessageIds))];
    const dropFor = (taskId: string) => applied.filter((op): op is Extract<PlanOp, { type: 'exclude_scope' }> => op.type === 'exclude_scope' && op.taskId === taskId).map(op => op.item);
    for (const [index, a] of pending.entries()) {
      if (judgement.decision !== 'speak' || !a.personId) continue;
      const text = channelText(`${state.members.get(a.personId)?.displayName ?? '담당자'}님, ${describeOp(a.op, state)} 변경을 승인하시겠어요?`, state);
      append.push(make('authority_requested', { requestId: `${changeId}:${index}:${a.personId}`, operationKey: operationKey(a.op), personId: a.personId, changeKinds: [a.kind], text }, `authority:${index}`));
      append.push(make('pm_spoke', { considerationId: key, messageId: `${key}:ask:${index}`, text, kind: 'ask' }, `ask:${index}`, true));
      post = undefined;
    }
    if ((validJudgement || exclusionConclusion) && applied.length && state.goal && state.plan) {
      for (const request of state.pendingAuthority.values()) {
        if (!confirmed && applied.some(op => request.operationKey === operationKey(op) && state.messages.some(m => op.sourceMessageIds.includes(m.messageId) && m.authorId === request.personId))) {
          append.push(make('authority_granted', { requestId: request.requestId, personId: request.personId, granted: true }, `granted:${request.requestId}`));
        }
      }
      for (const [index, op] of applied.entries()) {
        if (op.type === 'set_availability') append.push(make('availability_updated', { memberId: op.memberId, weeklyHours: op.weeklyHours, ...(op.weekStart ? { weekStart: op.weekStart } : {}) }, `availability:${index}`));
      }
      const goal = { ...state.goal };
      for (const op of applied) {
        if (op.type === 'set_deadline') goal.deadline = op.date;
        if (op.type === 'change_goal') goal.text = op.text;
      }
      const goalChanged = JSON.stringify(goal) !== JSON.stringify(state.goal);
      if (goalChanged) append.push(make('goal_set', goal, 'goal', true));
      if (planChanged || goalChanged) {
        const appliedState = structuredClone(state);
        if (appliedState.plan) appliedState.plan.tasks = tasks;
        appliedState.goal = goal;
        for (const op of applied) if (op.type === 'set_availability') {
          if (op.weekStart) {
            const weeks = appliedState.availabilityOverrides.get(op.memberId) ?? new Map<string, number>();
            weeks.set(op.weekStart, op.weeklyHours); appliedState.availabilityOverrides.set(op.memberId, weeks);
          } else appliedState.availability.set(op.memberId, op.weeklyHours);
        }
        const after = forecastFromState(appliedState, now);
        const late = after.ok && after.lateness && after.lateness.maxDays > 0 ? ` 그래도 최대 ${formatKstDate(after.end.max)}로 기한을 넘깁니다.` : '';
        post = { text: `정리하면: ${summary}.${late}`, kind: 'summary' };
        judgement = { ...judgement, decision: 'speak', whoseAction: affected.join(', ') || state.goal.decider, alreadyKnows: 'no', evidence: sourceMessageIds.map(id => `msg:${id}`), reason: '확인된 변경을 계획과 담당자에게 반영', text: post.text };
        append.push(make('decision_recorded', { decisionId: changeId, summary, sourceMessageIds, approvedBy: 'pm', changeKinds: [...new Set(applied.map(op => opAuthority(state, op).kind))] }));
        if (planChanged) append.push(make('plan_committed', { version: version + 1, basedOn: version, tasks, reason: summary, approvedBy: 'pm', sourceMessageIds }, 'plan_committed', true));
      }
      for (const id of absent.filter(id => state.members.get(id)?.kind === 'human')) {
        const details = diff.changed.filter(c => c.prev.assignee === id || c.next.assignee === id).map(c => `${c.next.title}: ${c.next.assignee === id ? c.next.handoffConditions.join(', ') : '담당 작업에서 제외'}`);
        if (reworkDependents.some(t => t.spec.assignee === id) || reopened.some(c => c.next.assignee === id)) details.push(reworkText);
        const text = channelText(`${state.members.get(id)?.displayName ?? '담당자'}님, 계획 v${version + 1}: ${details.join('; ')}`, state);
        append.push(make('change_notified', { changeId, planVersion: version + 1, recipientId: id, text, via: 'channel' }, `notify:${id}`));
        append.push(make('pm_spoke', { considerationId: key, messageId: `${key}:speech:${id}`, text, kind: 'nudge' }, `speech:${id}`, true));
      }
      for (const id of affected.filter(id => state.members.get(id)?.kind === 'agent' && !state.activeTurn.has(id))) {
        append.push(make('change_notified', { changeId, planVersion: version + 1, recipientId: id, text: JSON.stringify({ summary, tasks: tasks.filter(t => t.assignee === id), drop: tasks.filter(t => t.assignee === id).flatMap(t => dropFor(t.id)), ...(reworkDependents.some(t => t.spec.assignee === id) ? { predecessorRework: reworkText } : {}) }), via: 'next_turn' }, `notify:${id}`));
      }
      for (const [agentId, taskId] of state.activeTurn) {
        const predecessorRework = reworkDependents.some(t => t.spec.id === taskId);
        if (!diff.changed.some(c => c.taskId === taskId) && !predecessorRework) continue;
        deliveries.push({ agentId, taskId, input: { updateId: `${changeId}:${agentId}`, fromVersion: version, toVersion: version + 1, keep: diff.unchanged.filter(t => t.assignee === agentId).map(t => t.title), change: [...diff.changed.filter(c => c.taskId === taskId).map(c => JSON.stringify(c.next)), ...(predecessorRework ? [reworkText] : [])], drop: dropFor(taskId), reason: summary } });
      }
    }
    const agentAnswers = [...new Map((interpretation?.agentAnswers ?? []).map(a => [a.questionId, a])).values()].map(a => ({ taskId: pendingAgentQuestions.find(q => q.questionId === a.questionId)!.taskId, questionId: a.questionId, text: humanMessages.filter(m => a.sourceMessageIds.includes(m.messageId)).map(m => m.text).join('\n') }));
    const tx = await this.store.transaction<'duplicate' | 'retry' | 'applied'>(this.options.projectId, fresh => {
      if (fresh.some(e => e.idempotencyKey === `${key}:pm_considered`)) return { append: [], result: 'duplicate' };
      const latest = project(fresh);
      if ((confirmed && latest.lastSeq !== state.lastSeq) || fresh.slice(events.length).some(e => !['message_recorded', 'attachment_recorded'].includes(e.type))) {
        if (retry < 2) return { append: [], result: 'retry' };
        const text = '기록이 계속 바뀌어 변경을 반영하지 못했습니다. 잠시 후 다시 말씀해 주세요.';
        judgement = { ...judgement!, whoseAction: message.authorId, alreadyKnows: 'no', evidence: [`msg:${messageId}`], decision: 'speak', reason: '최신 기록 재판단 두 번 후에도 경합이 계속됨', text };
        append.length = 0; deliveries.length = 0; agentAnswers.length = 0; post = { text, kind: 'ask' };
      }
      // Human approvals and decider conclusions start a new window before its changes.
      const approvals = append.filter(e => ['authority_granted', 'decision_recorded'].includes(e.type));
      const budgetState = project([...fresh, ...approvals.map((e, i) => ({ ...e, id: `budget:${i}`, seq: latest.lastSeq + i + 1, at: now.toISOString() }))]);
      const gate = automationGate(budgetState);
      // Each successful delivery records both update_sent and change_notified.
      const cost = append.filter(isAutomationAction).length + deliveries.length * 2;
      if (cost > gate.remaining) {
        if (confirmed) throw new Error('Automation limit reached; resume before applying approval');
        judgement = { ...judgement!, decision: 'silent', reason: '자동 행동 상한' }; post = undefined; append.length = 0; deliveries.length = 0; agentAnswers.length = 0;
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
      if (post) post.text = channelText(post.text, state);
      if (post) append.push(make('pm_spoke', { considerationId: key, messageId: `${key}:speech`, ...post }, 'pm_spoke', true));
      return { append, result: 'applied' };
    });
    if (tx.result === 'retry') return this.consider(messageId, confirmed, requestId, retry + 1);
    if (tx.result === 'duplicate') return { posts: [], events: [] };
    const result: CoordinationResult = { posts: post ? [post] : [], events: tx.appended, ...(agentAnswers.length ? { agentAnswers } : {}) };
    for (const e of tx.appended as AnyEvent[]) if (e.type === 'change_notified' && e.payload.via === 'channel') result.posts.push({ text: e.payload.text, kind: 'nudge' });
    for (const e of tx.appended as AnyEvent[]) if (e.type === 'pm_spoke' && e.idempotencyKey?.startsWith(`${key}:ask:`)) result.posts.push({ text: e.payload.text, kind: 'ask' });
    if (tx.appended.some(e => e.type === 'action_limit_reached')) result.posts.push({ text: '자동 행동 상한에 도달했습니다. 계속하려면 재개해 주세요.', kind: 'ask' });
    for (const delivery of deliveries) {
      let sent = false;
      try { sent = (await this.connector.sendUpdate(delivery.agentId, delivery.input)).sent; } catch { /* No blind retry on ambiguous delivery. */ }
      // A runner that records its own update_sent keeps it the only one for this update.
      const recordedSent = sent && (await this.store.read({ projectId: this.options.projectId }) as AnyEvent[]).some(e => e.type === 'update_sent' && e.payload.updateId === delivery.input.updateId);
      const recorded = await this.store.append([
        ...(sent && !recordedSent ? [make('update_sent', { updateId: delivery.input.updateId, taskId: delivery.taskId, fromVersion: version, toVersion: version + 1 }, `update:${delivery.agentId}`, true)] : []),
        make('change_notified', { changeId, planVersion: version + 1, recipientId: delivery.agentId, text: JSON.stringify(delivery.input), via: sent ? 'steer' : 'next_turn' }, `notify:${delivery.agentId}`),
      ]);
      result.events.push(...recorded);
    }
    return result;
  }
}
