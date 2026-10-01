import { availabilityWeek, formatKstDate, scopeItem, scopeMentions, remainingScopeOps, type ForecastResult } from '@ensemble/core';
import { channelText, taskName, shortTaskName, numericFacts, hasGroundedNumbers } from './channel-text.ts';
import { affectedMembers, automationGate, diffPlans, forecastFromState, withoutStopped, isAutomationAction, limitReachedEvent, project, applyOps, opAuthority } from '@ensemble/core';
import { createDecisionRequest, isParentTask, planOpProblems, planOpsProblems, planStarts, routeTask, taskMetaFromOps, PRIORITIES, ROUTING_REASONS } from '@ensemble/core';
import { createHash } from 'node:crypto';
import type { AnyEvent, ChangeKind, EventContext, EventPayloads, EventType, LedgerEvent, NewLedgerEvent, PlanOp, ProjectState, TaskDraft, TaskSpec } from '@ensemble/core';
import type { SessionConnector, UpdateInstructionsInput } from '@ensemble/agents';
import type { LlmProvider, ToolSpec } from '@ensemble/llm';
import type { LedgerStore } from '@ensemble/store';
import { PM_SYSTEM_PROMPT } from './pm-prompt.ts';
import { recoveryRefusal, taskQuestions } from './context.ts';
import { opsApplicable } from './sweep.ts';

export type TaskRecoveryOp = (
  | { type: 'resolve_task'; taskId: string; action: 'accept' | 'retry' | 'recheck'; note?: string }
  | { type: 'reopen_task'; taskId: string; reason: string }
) & { sourceMessageIds: string[] };
export type CoordinationOp = PlanOp | TaskRecoveryOp;
const isRecoveryOp = (op: CoordinationOp): op is TaskRecoveryOp => op.type === 'resolve_task' || op.type === 'reopen_task';
export interface CoordinationInterpretation {
  category: string;
  summary: string;
  ops: CoordinationOp[];
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
export interface CoordinationResult {
  posts: { text: string; kind: EventPayloads['pm_spoke']['kind'] }[]; events: LedgerEvent[];
  agentAnswers?: { taskId: string; questionId: string; text: string }[];
  resolutions?: { taskId: string; action: 'accept' | 'retry' | 'recheck'; note?: string }[];
  reopens?: { taskId: string; reason: string; announcement?: string }[];
  /** New work reserved to start in this handling; the PM starts each with `Dispatcher.startReserved`. */
  starts?: string[];
  /** Decision requests opened for work changes the speaker could not make alone. */
  requests?: string[];
}
export interface CoordinatorOptions extends EventContext { model?: string; clock?: () => Date }
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string' && x.length > 0);
const stringArray = { type: 'array', items: { type: 'string' } };
const JUDGEMENT_FAILURE_TEXT = '제가 이 요청을 판단하지 못했어요. 무엇을 바꾸길 원하는지 한 문장으로 다시 알려 주세요';
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
      op('resolve_task', { taskId, action: { enum: ['accept', 'retry', 'recheck'] }, note: { type: 'string', description: '사람이 요청한 보완 내용 또는 수락 사유. 없으면 빈 문자열' } }),
      op('reopen_task', { taskId, reason: { type: 'string', minLength: 1 } }),
      op('create_task', { ...workDraft(state), parentId: taskId }),
      op('split_task', { taskId, children: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: Object.keys(workDraft(state)), properties: workDraft(state) } } }),
      op('cancel_task', { taskId, reason: { type: 'string', minLength: 1 } }),
      op('set_priority', { taskId, priority: { enum: [...PRIORITIES] } }),
    ] } },
  } } };
}
/** The fields the model drafts for new work. Routing is a proposal; brief ids are chosen from enums. */
function workDraft(state: ProjectState): Record<string, unknown> {
  const ids = (values: string[]) => values.length ? { type: 'array', items: { type: 'string', enum: values } } : { type: 'array', maxItems: 0, items: { type: 'string' } };
  return {
    tempId: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,39}$', description: '새 작업 ID. 기존 작업 ID와 겹치지 않는 짧은 영문 소문자(예: login-screen). 같은 응답의 다른 연산이 dependsOn·parentId로 참조할 수 있다' },
    title: { type: 'string', minLength: 1 }, assignee: { type: 'string', enum: [...state.members.keys()], description: '제안 담당. Agent 배정은 코드가 역할로 다시 고른다' },
    handoffConditions: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', minLength: 1 } },
    dependsOn: { type: 'array', items: { type: 'string' } }, priority: { enum: [...PRIORITIES] },
    routing: { type: 'object', additionalProperties: false, required: ['executor', 'reason', 'note'], properties: { executor: { enum: ['agent', 'human'] }, reason: { enum: [...ROUTING_REASONS] }, note: { type: 'string', description: '누가 왜 하는지 한 문장' } } },
    brief: { type: 'object', additionalProperties: false, required: ['why', 'decisionIds', 'attachmentIds', 'constraints'], properties: {
      why: { type: 'string', minLength: 1, description: '목표 → 상위 작업 → 이 작업으로 이어지는 이유 1~2문장' },
      decisionIds: ids([...state.decisions.keys()]), attachmentIds: stringArray, constraints: { ...stringArray, description: '대화에서 확정된 제약만' },
    } },
  };
}
const WORK_OPS = ['create_task', 'split_task', 'cancel_task', 'set_priority'] as const;
type WorkOp = Extract<PlanOp, { type: typeof WORK_OPS[number] }>;
const isWorkOp = (op: CoordinationOp): op is WorkOp => (WORK_OPS as readonly string[]).includes(op.type);
/** New work from one message beyond this goes to the decider as one bundled request (§3). */
export const MAX_TASKS_PER_MESSAGE = 5;
const newTaskIds = (ops: readonly CoordinationOp[]): string[] => ops.flatMap(op => op.type === 'create_task' ? [op.tempId] : op.type === 'split_task' ? op.children.map(c => c.tempId) : []);
const DRAFT_FIELDS = ['tempId', 'title', 'assignee', 'handoffConditions', 'dependsOn', 'priority', 'routing', 'brief'];

/**
 * Code finishes what the model drafted: routing picks the assignee (§2.5), and the brief gets the
 * source conversation and its attachments (§2.6). Unknown ids stay in so validation rejects them.
 */
function finishDraft(state: ProjectState, events: readonly AnyEvent[], raw: Record<string, unknown>, sourceMessageIds: string[]): { draft?: TaskDraft; problems: string[] } {
  if (!raw || typeof raw !== 'object') return { problems: ['새 작업 초안이 객체가 아닙니다.'] };
  const label = typeof raw.tempId === 'string' ? raw.tempId : '새 작업';
  if (Object.keys(raw).some(k => !DRAFT_FIELDS.includes(k))) return { problems: [`${label}: 새 작업 필드는 ${DRAFT_FIELDS.join(', ')}만 허용합니다.`] };
  const routing = raw.routing as Record<string, unknown> | undefined;
  const brief = raw.brief as Record<string, unknown> | undefined;
  if (!routing || typeof routing !== 'object' || !brief || typeof brief !== 'object') return { problems: [`${label}: routing과 brief가 필요합니다.`] };
  const routed = routeTask(state, { executor: routing.executor as 'agent' | 'human', reason: String(routing.reason), note: typeof routing.note === 'string' ? routing.note : '', ...(typeof raw.assignee === 'string' ? { assignee: raw.assignee } : {}) });
  if (!routed.ok) return { problems: [`${label}: ${routed.reason}`] };
  if (routed.assignee === undefined) return { problems: [`${label}: 맡을 사람이 없습니다.`] };
  const messageAttachments = events.flatMap(e => e.type === 'message_recorded' && sourceMessageIds.includes(e.payload.messageId) ? e.payload.attachmentIds : []);
  const known = new Set(events.flatMap(e => e.type === 'attachment_recorded' ? [e.payload.attachmentId] : []));
  const attachmentIds = Array.isArray(brief.attachmentIds) ? brief.attachmentIds.filter((id): id is string => typeof id === 'string') : [];
  const unknown = attachmentIds.filter(id => !known.has(id));
  if (unknown.length) return { problems: [`${label}: 없는 자료 ${unknown.join(', ')}`] };
  return { problems: [], draft: {
    ...(raw as unknown as TaskDraft), assignee: routed.assignee, routing: routed.routing,
    brief: { why: String(brief.why ?? ''), sourceMessageIds: [...sourceMessageIds], decisionIds: Array.isArray(brief.decisionIds) ? brief.decisionIds as string[] : [], attachmentIds: [...new Set([...attachmentIds, ...messageAttachments.filter(id => known.has(id))])], constraints: Array.isArray(brief.constraints) ? brief.constraints as string[] : [] },
  } };
}

/** Model output → recorded ops: work drafts finished by code, then the whole batch validated in order. */
function prepareOps(state: ProjectState, events: readonly AnyEvent[], raw: readonly CoordinationOp[]): { ops: CoordinationOp[]; problems: string[] } {
  const problems: string[] = [];
  const ops = raw.map(op => {
    if (op.type === 'create_task') {
      const { parentId, sourceMessageIds, type, ...draft } = op as unknown as Record<string, unknown> & { sourceMessageIds: string[] };
      const done = finishDraft(state, events, draft, sourceMessageIds);
      problems.push(...done.problems);
      return done.draft ? { type, sourceMessageIds, ...(parentId !== undefined ? { parentId } : {}), ...done.draft } as PlanOp : op;
    }
    if (op.type === 'split_task' && Array.isArray(op.children)) {
      const children = op.children.map(child => {
        const done = finishDraft(state, events, child as unknown as Record<string, unknown>, op.sourceMessageIds);
        problems.push(...done.problems);
        return done.draft ?? child;
      });
      return { ...op, children };
    }
    return op;
  });
  if (!problems.length) problems.push(...planOpsProblems(state, ops.filter((op): op is PlanOp => !isRecoveryOp(op))));
  return { ops, problems };
}
function validCoordinationOp(value: unknown, state: ProjectState): value is CoordinationOp {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!strings(v.sourceMessageIds) || !v.sourceMessageIds.length || !v.sourceMessageIds.every(id => state.messages.some(m => m.messageId === id && state.members.get(m.authorId)?.kind === 'human'))) return false;
  const fields: Record<string, string[]> = { set_availability: ['memberId', 'weeklyHours', 'weekStart', 'period'], exclude_scope: ['taskId', 'item'], limit_scope: ['taskId', 'items'], handoff_early: ['taskId'], reassign: ['taskId', 'assignee'], set_deadline: ['date'], change_goal: ['text'], resolve_task: ['taskId', 'action', 'note'], reopen_task: ['taskId', 'reason'], create_task: [...DRAFT_FIELDS, 'parentId'], split_task: ['taskId', 'children'], cancel_task: ['taskId', 'reason'], set_priority: ['taskId', 'priority'] };
  const allowed = fields[String(v.type)];
  if (!allowed || Object.keys(v).some(k => !['type', 'sourceMessageIds', ...allowed].includes(k))) return false;
  if (allowed.includes('taskId') && !state.plan?.tasks.some(t => t.id === v.taskId)) return false;
  switch (v.type) {
    case 'resolve_task': return ['accept', 'retry', 'recheck'].includes(String(v.action)) && (v.note === undefined || typeof v.note === 'string');
    case 'reopen_task': return typeof v.reason === 'string' && !!v.reason.trim();
    case 'set_availability': return state.members.get(String(v.memberId))?.kind === 'human' && typeof v.weeklyHours === 'number' && Number.isFinite(v.weeklyHours) && v.weeklyHours >= 0 && (v.period === undefined || ['this_week', 'ongoing', 'unclear'].includes(String(v.period))) && (v.weekStart === undefined || (typeof v.weekStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.weekStart) && availabilityWeek(new Date(`${v.weekStart}T00:00:00+09:00`)) === v.weekStart));
    case 'limit_scope': return strings(v.items) && v.items.length > 0;
    case 'exclude_scope': return typeof v.item === 'string' && !!v.item.trim();
    case 'handoff_early': return true;
    case 'reassign': return state.members.has(String(v.assignee));
    case 'set_deadline': return typeof v.date === 'string' && Number.isFinite(Date.parse(v.date));
    case 'change_goal': return typeof v.text === 'string' && !!v.text.trim();
    // Work ops: shape only here. Drafts are finished and the batch is checked by `prepareOps`/`planOpsProblems`.
    case 'create_task': return typeof v.tempId === 'string' && typeof v.title === 'string' && (v.parentId === undefined || typeof v.parentId === 'string');
    case 'split_task': return Array.isArray(v.children) && v.children.length > 0;
    case 'cancel_task': return typeof v.reason === 'string' && !!v.reason.trim();
    case 'set_priority': return PRIORITIES.includes(v.priority as never);
    default: return false;
  }
}
/** Authority cards keep their original plan-only contract. */
export function validOp(value: unknown, state: ProjectState): value is PlanOp {
  return validCoordinationOp(value, state) && !isRecoveryOp(value);
}
/** The current human request must authorize the action; old decider messages never grant it. */
export function recoveryAllowed(state: ProjectState, op: TaskRecoveryOp, messageId: string): boolean {
  const message = state.messages.find(m => m.messageId === messageId);
  const task = state.tasks.get(op.taskId);
  if (!message || state.members.get(message.authorId)?.kind !== 'human' || !op.sourceMessageIds.includes(messageId) || !task) return false;
  const decider = state.goal?.decider === message.authorId;
  const downstream = (id: string, seen = new Set<string>()): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    return (state.tasks.get(id)?.spec.dependsOn ?? []).some(dep => dep === op.taskId || downstream(dep, seen));
  };
  const assigned = task.spec.assignee === message.authorId || [...state.tasks.values()].some(t => t.status !== 'cancelled' && t.spec.assignee === message.authorId && downstream(t.spec.id));
  if (op.type === 'reopen_task') return task.status === 'checked' && (decider || assigned);
  if (op.action === 'recheck') return task.status === 'submitted' && task.results.length > 0;
  if (!['blocked', 'submitted', 'revising'].includes(task.status)) return false;
  return op.action === 'accept' ? decider && task.results.length > 0 : decider || assigned;
}
function describeOp(op: PlanOp, state: ProjectState): string {
  const name = (id: string) => state.members.get(id)?.displayName ?? id;
  switch (op.type) {
    case 'set_availability': return `${name(op.memberId)} 가용 시간 ${op.weekStart ? "이번 주만" : "매주"} ${op.weeklyHours}시간`;
    case 'exclude_scope': return `${shortTaskName(state, op.taskId)}에서 ${op.item} 제외`;
    case 'limit_scope': return `${shortTaskName(state, op.taskId)} 범위를 ${op.items.map(scopeItem).join(' · ')}까지만 한정`;
    case 'handoff_early': return `${taskName(state, op.taskId)} 초안 단계에서 인계 가능`;
    case 'reassign': return `${taskName(state, op.taskId)} 담당 ${name(op.assignee)}`;
    case 'set_deadline': return `기한 ${op.date}`;
    case 'change_goal': return `목표 ${op.text}`;
    case 'create_task': return `새 작업 ${op.title}`;
    case 'split_task': return `${taskName(state, op.taskId)}을 ${op.children.map(c => c.title).join(' · ')}로 나눔`;
    case 'cancel_task': return `${taskName(state, op.taskId)} 취소`;
    case 'set_priority': return `${taskName(state, op.taskId)} 우선순위 ${op.priority}`;
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
  if (forecast.uncertainty) return `${forecast.uncertainty.warning}. 멈춘 작업을 재개한 뒤 종료일을 다시 확인해 주세요.`;
  if (!forecast.ok) {
    const labels = { missing_estimate: '작업 예상 시간 미입력', missing_availability: '담당자 가용 시간 미입력', zero_availability: '담당자 가용 시간 없음', cycle: '작업 의존 관계 순환', unknown_dependency: '선행 작업 누락' };
    return `현재는 ${[...new Set(forecast.reasons.map(r => labels[r.kind]))].join(', ')} 때문에 종료일을 계산할 수 없습니다.`;
  }
  const range = `현재 기록 기준 예상 종료는 ${formatKstDate(forecast.end.min)}~${formatKstDate(forecast.end.max)}(서울 시간)입니다.`;
  if (forecast.shortages.length) return `${range} 기한 내 가용 시간이 부족한 담당자는 ${forecast.shortages.map(s => `${state.members.get(s.memberId)?.displayName ?? '담당자'}(${Number(s.hours.toFixed(1))}시간 부족)`).join(', ')}입니다.`;
  return `${range}${forecast.lateness ? forecast.lateness.maxDays > 0 ? ` 현재 작업 시간과 선후 관계 기준 최대 ${Number(forecast.lateness.maxDays.toFixed(1))}일 기한을 넘깁니다.` : ' 현재 계산으로는 기한 안에 끝납니다.' : ''}`;
}

const calendarForecast = (forecast: ForecastResult) => forecast.ok ? { ...forecast, calendarDates: { timeZone: 'Asia/Seoul', min: formatKstDate(forecast.end.min), max: formatKstDate(forecast.end.max) } } : forecast;

/**
 * Live work whose assignee is not on the team (a removed member, a stale id), routed as the sweep routes it (§2.5):
 * the old assignee is read as the role the work needs, so a capable agent is found, else a person (`no_capable_agent`).
 */
function orphanRoutes(state: ProjectState, tasks: readonly TaskSpec[] = state.plan?.tasks ?? []) {
  return tasks.filter(spec => !state.members.has(spec.assignee) && state.tasks.get(spec.id)?.status !== 'cancelled')
    .map(spec => ({ spec, route: routeTask(state, { executor: 'agent', reason: 'agent_capable', note: '', role: spec.assignee }) }));
}
/** The forecast with orphaned work on its routed assignee: a member leaving never crashes the PM loop. Nothing is reassigned. */
function forecastRouted(state: ProjectState, now: Date): ForecastResult {
  const orphans = orphanRoutes(state);
  if (!orphans.length || !state.plan) return forecastFromState(state, now);
  const routed = structuredClone(state);
  routed.plan!.tasks = routed.plan!.tasks.flatMap(spec => {
    const orphan = orphans.find(o => o.spec.id === spec.id);
    const assignee = !orphan ? spec.assignee : orphan.route.ok ? orphan.route.assignee : undefined;
    // Without anyone to route to (no decider), the work is left out and its dependents read as unknown.
    if (assignee === undefined) return [];
    const task = routed.tasks.get(spec.id);
    if (task && JSON.stringify(task.spec) === JSON.stringify(spec)) task.spec = { ...spec, assignee };
    return [{ ...spec, assignee }];
  });
  return forecastFromState(routed, now);
}

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
    const current = forecastRouted(state, now);
    const knownFacts = [
      { id: 'forecast:current', value: current },
      ...(state.plan?.tasks ?? []).map(t => ({ id: `task:${t.id}`, value: t })),
      ...[...state.availability].map(([id, hours]) => ({ id: `availability:${id}`, value: hours })),
      ...[...state.decisions.values()].map(d => ({ id: `decision:${d.decisionId}`, value: d })),
    ];
    const humanMessages = state.messages.filter(m => state.members.get(m.authorId)?.kind === 'human');
    const lastHuman = humanMessages.at(-1);
    const pendingAgentQuestions = [...state.tasks.values()].filter(t => state.members.get(t.spec.assignee)?.kind === 'agent').flatMap(t => taskQuestions(events, t.spec.id).filter(q => !q.answer).map(q => ({ ...q, taskId: t.spec.id })));
    const facts = { messageId, planVersion: version, now, messages: state.messages, knownFacts, pendingAgentQuestions, plan: state.plan, taskStates: [...state.tasks.values()], members: [...state.members.values()], activeTurns: [...state.activeTurn], availability: [...state.availability], availabilityOverrides: [...state.availabilityOverrides].map(([id, weeks]) => [id, [...weeks]]), estimates: [...state.estimates], goal: state.goal, currentForecast: calendarForecast(current), forecastInputIds: forecastInputs, decisions: [...state.decisions.values()], pendingAuthority: [...state.pendingAuthority.values()], previousSpeech: prior, openTopics: state.openTopics, attachments: events.flatMap(e => e.type === 'attachment_recorded' ? [e.payload] : []) };
    // A decision request answered on its card: the target's answer message carries the authority the original talk lacked.
    const decisionRequest = confirmed && requestId ? state.decisionRequests.get(requestId) : undefined;
    if (decisionRequest && (decisionRequest.request.targetMemberId !== message.authorId || ['rejected', 'withdrawn', 'expired'].includes(decisionRequest.status))) throw new Error('Operation answer is not from the decision request target');
    const confirmedOps = decisionRequest ? confirmed!.map(op => op.sourceMessageIds.includes(messageId) ? op : { ...op, sourceMessageIds: [...op.sourceMessageIds, messageId] }) : confirmed;
    if (confirmedOps && (!confirmedOps.every(op => validOp(op, state) && opAuthority(state, op).allowed) || (confirmedOps.some(isWorkOp) && planOpsProblems(state, confirmedOps).length))) throw new Error('Invalid or unauthorized confirmed operation');
    const interpretation = confirmedOps ? { category: 'authority', summary: '기록된 변경 승인', ops: confirmedOps, conflicts: [] } : !state.plan ? undefined : await this.call<CoordinationInterpretation>(interpretationTool(state), facts, v => {
      const errors: string[] = [];
      if (!Object.keys(v).every(k => ['category', 'summary', 'ops', 'conflicts', 'conversation', 'factMentions', 'agentAnswers'].includes(k))) errors.push('최상위 필드는 category, summary, ops, conflicts, conversation, factMentions, agentAnswers만 허용합니다.');
      if (typeof v.category !== 'string' || typeof v.summary !== 'string') errors.push('category와 summary는 문자열이어야 합니다.');
      if (!Array.isArray(v.ops) || !v.ops.every(op => validCoordinationOp(op, state))) errors.push('ops: 허용된 연산 필드·작업/담당자 ID·실제 사람 sourceMessageIds만 사용하세요.');
      else {
        const problems = prepareOps(state, events, v.ops as CoordinationOp[]).problems;
        if (problems.length) errors.push(`ops: 작업 변경이 규칙에 맞지 않습니다. ${problems.join(' ')}`);
      }
      if (!strings(v.conflicts) || !v.conflicts.every(id => state.decisions.has(id))) errors.push(`conflicts: 기존 결정의 decisionId만 허용합니다. 허용 ID=${JSON.stringify([...state.decisions.keys()])}. 작업/계획 이벤트/메시지 ID는 결정 ID가 아닙니다.${state.decisions.size ? '' : ' 기존 결정이 없으므로 conflicts는 반드시 []입니다.'}`);
      if (!(v.agentAnswers === undefined || (Array.isArray(v.agentAnswers) && v.agentAnswers.every(a => a && typeof a === 'object' && pendingAgentQuestions.some(q => q.questionId === a.questionId) && strings(a.sourceMessageIds) && a.sourceMessageIds.includes(messageId) && a.sourceMessageIds.every((id: string) => humanMessages.some(m => m.messageId === id)))))) errors.push('agentAnswers: 미해결 질문 ID와 현재 메시지를 포함한 사람 sourceMessageIds만 허용합니다.');
      if (!validConversation(v.conversation, state, lastHuman?.messageId)) errors.push(`conversation: questionMessageId는 ${lastHuman?.messageId} 또는 null이며, waitingOnMemberIds는 질문자를 제외한 사람 ID 배열입니다. 질문이 없으면 null/[]/false를 쓰세요.`);
      if (!Array.isArray(v.factMentions) || !v.factMentions.every(mention => mention && typeof mention === 'object' && humanMessages.some(m => m.messageId === mention.messageId) && strings(mention.factIds) && mention.factIds.every((id: string) => knownFacts.some(f => f.id === id)))) errors.push('factMentions: 실제 사람 messageId와 knownFacts의 id만 배열로 사용하세요.');
      return errors;
    });
    if (interpretation && !confirmedOps) interpretation.ops = prepareOps(state, events, interpretation.ops).ops;
    const planOps =(interpretation?.ops ?? []).filter((op): op is PlanOp => !isRecoveryOp(op)).map(op => {
      if (op.type !== 'set_availability') return op;
      const sources = humanMessages.filter(m => op.sourceMessageIds.includes(m.messageId) && m.authorId === op.memberId);
      const explicitWeek = sources.some(m => /이번\s*주/.test(m.text)) && !sources.some(m => /매주|앞으로도|계속/.test(m.text));
      return explicitWeek && (op as PlanOp & { period?: string }).period === 'unclear' ? { ...op, period: 'this_week' } : op;
    });
    const outputText = new Map<string, string>();
    for (const event of events) if (event.type === 'result_submitted') outputText.set(event.payload.taskId, event.payload.summary);
    const unclearAvailability = planOps.filter(op => op.type === 'set_availability' && (op as PlanOp & { period?: string }).period === 'unclear');
    const ops = remainingScopeOps(state, planOps.filter(op => !unclearAvailability.includes(op)).map(op => {
      if (op.type !== 'set_availability') return op;
      const { period, ...operation } = op as Extract<PlanOp, { type: 'set_availability' }> & { period?: string };
      return { ...operation, ...(period === 'this_week' ? { weekStart: availabilityWeek(now) } : {}) };
    }), outputText);
    const conversation = interpretation?.conversation ?? { questionMessageId: null, waitingOnMemberIds: [], directedToPm: false };
    const openHumanQuestion = conversation.questionMessageId !== null && conversation.waitingOnMemberIds.length > 0 && !conversation.directedToPm;
    const requestedRecovery = (interpretation?.ops ?? []).filter(isRecoveryOp);
    // Distinct actions for one task in one utterance are ambiguous; execute neither.
    const recoveryOps = [...new Map(requestedRecovery.map(op => [JSON.stringify(op), op])).values()];
    const authorizedRecovery = recoveryOps.filter(op => !openHumanQuestion && recoveryAllowed(state, op, messageId)
      && recoveryOps.filter(other => other.taskId === op.taskId).length === 1);
    const resolutions: NonNullable<CoordinationResult['resolutions']> = authorizedRecovery.flatMap(op => op.type === 'resolve_task' ? [{ taskId: op.taskId, action: op.action, ...(op.note ? { note: op.note } : {}) }] : []);
    const reopens: NonNullable<CoordinationResult['reopens']> = authorizedRecovery.flatMap(op => op.type === 'reopen_task' ? [{ taskId: op.taskId, reason: op.reason }] : []);
    // The PM carries these out right after this message, so speech must not warn about them as stopped.
    const settled = (result: ForecastResult) => withoutStopped(result, resolutions.map(r => r.taskId));
    const candidate = structuredClone(state);
    if (candidate.plan) candidate.plan.tasks = applyOps(candidate.plan.tasks, ops);
    for (const op of ops) {
      if (op.type === 'set_availability') {
        if (op.weekStart) { const weeks = candidate.availabilityOverrides.get(op.memberId) ?? new Map<string, number>(); weeks.set(op.weekStart, op.weeklyHours); candidate.availabilityOverrides.set(op.memberId, weeks); }
        else candidate.availability.set(op.memberId, op.weeklyHours);
      }
      if (op.type === 'set_deadline' && candidate.goal) candidate.goal.deadline = op.date;
    }
    const proposed = forecastRouted(candidate, now);
    // More new work than one message should make goes to the decider as one bundled request.
    const bundled = !confirmedOps && newTaskIds(ops).length > MAX_TASKS_PER_MESSAGE;
    const assessed: { op: PlanOp; kind: ChangeKind; personId?: string; allowed: boolean }[] = ops.map(op => bundled && isWorkOp(op) ? { op, kind: 'scope_add', personId: state.goal?.decider, allowed: false } : { op, ...opAuthority(state, op) });
    const allowedOps = assessed.filter(a => a.allowed).map(a => a.op).filter(op => {
      if (op.type === 'set_availability') return (op.weekStart ? state.availabilityOverrides.get(op.memberId)?.get(op.weekStart) : state.availability.get(op.memberId)) !== op.weeklyHours;
      // A question/proposal awaiting a person is not a confirmed plan change,
      // even when its author would have authority to make that change.
      if (openHumanQuestion && op.sourceMessageIds.includes(conversation.questionMessageId!)) return false;
      if (op.type === 'set_deadline') return state.goal?.deadline !== op.date;
      if (op.type === 'change_goal') return state.goal?.text !== op.text;
      if (op.type === 'set_priority') return (state.tasks.get(op.taskId)?.meta?.priority ?? 'normal') !== op.priority;
      return JSON.stringify(applyOps(state.plan?.tasks ?? [], [op])) !== JSON.stringify(state.plan?.tasks ?? []);
    });
    // Work that leans on work still waiting for a person (a subtask of a new task the decider has not approved) waits with it.
    const applied: PlanOp[] = [], deferred: PlanOp[] = [];
    let appliedPlan: TaskSpec[] = state.plan?.tasks ?? [];
    for (const op of allowedOps) {
      if (isWorkOp(op) && planOpProblems(state, op, appliedPlan).length) { deferred.push(op); continue; }
      applied.push(op); appliedPlan = applyOps(appliedPlan, [op]);
    }
    const pending = [...assessed.filter(a => !a.allowed), ...deferred.map(op => ({ op, kind: 'scope_add' as ChangeKind, personId: state.goal?.decider, allowed: false }))];
    const tasks = applyOps(state.plan?.tasks ?? [], applied);
    const diff = diffPlans(state.plan?.tasks, tasks);
    const planChanged = diff.changed.length > 0 || diff.added.length > 0 || diff.removed.length > 0;
    const reopened = diff.changed.filter(c => state.tasks.get(c.taskId)?.status === 'checked' || state.tasks.get(c.taskId)?.blocked?.prevStatus === 'checked');
    const dependsOnRework = (id: string, seen = new Set<string>()): boolean => {
      if (seen.has(id)) return false;
      seen.add(id);
      return (state.tasks.get(id)?.spec.dependsOn ?? []).some(dep => reopened.some(c => c.taskId === dep) || dependsOnRework(dep, seen));
    };
    const reworkDependents = [...state.tasks.values()].filter(t => ['running', 'reserved'].includes(t.status) && dependsOnRework(t.spec.id));
    const reworkText = reopened.length ? `${reopened.map(c => c.next.title).join(' · ')} 작업의 명세가 바뀌어 다시 확인이 필요합니다` : '';
    // New work reaches its assignee as a start (or their own acceptance), not as a change to other work.
    const affected = [...new Set([...affectedMembers(state, { ...diff, added: [] }), ...reworkDependents.map(t => t.spec.assignee)])];
    const participants = new Set(state.messages.filter(m => state.members.get(m.authorId)?.kind === 'human').map(m => m.authorId));
    const absent = affected.filter(id => !participants.has(id) || reworkDependents.some(t => t.spec.assignee === id) || reopened.some(c => c.next.assignee === id));
    const impact = { current, proposed, deltaDays: current.ok && proposed.ok ? { min: proposed.days.min - current.days.min, max: proposed.days.max - current.days.max } : null, diff, affected, absent, operations: assessed, conflicts: interpretation?.conflicts ?? [] };
    const lastAvailability = events.findLastIndex(e => e.type === 'availability_updated');
    const beforeState = lastAvailability >= 0 ? project(events.slice(0, lastAvailability)) : undefined;
    const beforeAvailability = beforeState ? forecastRouted(beforeState, now) : undefined;
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
    const recordedWeek = [...state.availabilityOverrides.values()].some(weeks => weeks.has(availabilityWeek(now)));
    if (directQuestion && !unclearAvailability.length && recordedWeek && /이번\s*주.*매주|기간.*(?:알려|확인)/.test(judgement.text)) judgement = { ...judgement, whoseAction: message.authorId, alreadyKnows: 'no', evidence: ['forecast:current'], decision: 'speak', reason: '명시된 이번 주 가용 시간을 적용한 계산으로 직접 질문에 답한다', text: forecastAnswer(current, state) };
    if (directQuestion && !unclearAvailability.length && recordedWeek && current.ok && beforeAvailability?.ok && /밀리|밀려|늦|지연|언제|일정|기한/.test(message.text)) {
      const target = state.plan?.tasks.find(t => [t.baseTitle ?? t.title, shortTaskName(state, t.id), t.id].some(name => message.text.includes(name)));
      const afterTask = target && current.tasks.find(t => t.taskId === target.id);
      const beforeTask = target && beforeAvailability.tasks.find(t => t.taskId === target.id);
      const delta = afterTask && beforeTask ? afterTask.max.endDay - beforeTask.max.endDay : current.days.max - beforeAvailability.days.max;
      const change = Math.abs(delta) < 0.01 ? '이전 가용 시간 기준과 같아요' : `이전 가용 시간 기준보다 약 ${Number(Math.abs(delta).toFixed(1))}일 ${delta > 0 ? '늦어져요' : '빨라져요'}`;
      const end = afterTask ? `예상 완료는 ${formatKstDate(new Date(now.getTime() + afterTask.min.endDay * 86400000))}~${formatKstDate(new Date(now.getTime() + afterTask.max.endDay * 86400000))}(서울 시간)` : `전체 예상 완료는 ${formatKstDate(current.end.min)}~${formatKstDate(current.end.max)}(서울 시간)`;
      judgement = { ...judgement, whoseAction: message.authorId, alreadyKnows: 'no', evidence: ['forecast:current', 'forecast:before_availability'], decision: 'speak', reason: '이번 주 가용 시간 변경 전후의 작업별 계산으로 직접 일정 질문에 답한다', text: `${target ? `${shortTaskName(state, target.id)} ` : ''}${end}으로 ${change}.` };
    }
    if (!validJudgement && directQuestion) judgement = { ...judgement, whoseAction: message.authorId, alreadyKnows: 'no', evidence: ['forecast:current'], decision: 'speak', reason: '직접 질문의 모델 판단 검증 실패 후 기록 기반 계산 답변', text: forecastAnswer(current, state) };
    // A validated, authorized explicit exclusion does not need model prose to be applied.
    // If interpretation itself is missing, ask instead of guessing an operation.
    const exclusionConclusion = !validJudgement && message.authorId === state.goal?.decider && !openHumanQuestion && !conversation.questionMessageId
      && applied.length > 0 && !interpretation?.conflicts.length && applied.every(op => op.type === 'exclude_scope' && op.sourceMessageIds.includes(messageId) && message.text.includes(op.item)) && /빼|제외/.test(message.text);
    if (!validJudgement && !exclusionConclusion && !directQuestion && message.authorId === state.goal?.decider && /빼|제외|확정|바꾸자/.test(message.text)) judgement = { ...judgement, whoseAction: message.authorId, alreadyKnows: 'no', evidence: [`msg:${messageId}`], decision: 'speak', reason: '결정권자의 변경 발언을 검증하지 못해 재확인한다', text: '변경 내용을 확인하지 못해, 적용할 작업과 변경할 범위를 다시 알려주시겠어요?' };
    if (!state.plan && state.members.get(message.authorId)?.kind === 'human') judgement = { ...judgement, whoseAction: message.authorId, alreadyKnows: 'no', evidence: [`msg:${messageId}`], decision: 'speak', reason: '계획이 없어 다음 시작 경로를 안내한다', text: state.pendingPlans.size ? '제안된 계획 초안을 확인하고 승인해 주세요.' : '자유형식에서 말씀하신 목표로 계획을 만들어 볼까요?' };
    const failedJudgement = !!state.plan && !validJudgement;
    if (failedJudgement && !directQuestion && !exclusionConclusion && !authorizedRecovery.length) judgement = { ...judgement, whoseAction: message.authorId, alreadyKnows: 'no', evidence: [`msg:${messageId}`], decision: 'speak', reason: 'judgement_failed', text: JUDGEMENT_FAILURE_TEXT };
    // M12 X2: say exactly who may do it (the buttons' authority); an open question or an ambiguous request keeps the general line.
    const refusalText = () => {
      const refused = recoveryOps.find(op => !authorizedRecovery.includes(op));
      const ambiguous = !refused || openHumanQuestion || recoveryOps.filter(other => other.taskId === refused.taskId).length > 1;
      return (!ambiguous && recoveryRefusal(state, refused.type === 'resolve_task' ? { type: 'resolve_task', action: refused.action, taskId: refused.taskId } : { type: 'reopen_task', taskId: refused.taskId }, message.authorId))
        || '이 요청은 현재 작업 상태나 요청 권한을 확인할 수 없어 실행하지 않았어요. 결정권자나 해당 작업 담당자가 원하는 조치를 다시 알려 주세요.';
    };
    if (requestedRecovery.length) {
      // Execution owns success announcements and will revalidate against the latest ledger.
      judgement = { ...judgement, whoseAction: message.authorId, alreadyKnows: 'no', evidence: [`msg:${messageId}`],
        decision: authorizedRecovery.length === recoveryOps.length ? 'silent' : 'speak',
        reason: '작업 해결 요청의 권한과 상태를 코드로 검증',
        text: authorizedRecovery.length === recoveryOps.length ? '' : refusalText() };
    }
    // Conversational judgement does not run an artifact review. Only checkResult owns
    // positive acceptance speech and its task_checked/review evidence in the same handling.
    if (/(?:충족|통과|인계\s*가능|조건.{0,12}만족)/.test(judgement.text)) {
      judgement.text = '결과의 충족 여부는 인계 검토로 확인해야 합니다. 해당 작업에 결과물을 첨부해 확인을 요청해 주세요.';
      judgement.reason = '대화 판단만으로 인계 충족을 선언할 수 없어 검토 경로 안내';
    }
    if (judgement.decision === 'speak' && settled(current).uncertainty && judgement.evidence.some(id => id.startsWith('forecast:'))) judgement.text = forecastAnswer(settled(current), state);
    judgement.text = channelText(judgement.text, state);
    let post: CoordinationResult['posts'][number] | undefined = judgement.decision === 'speak' ? { text: judgement.text, kind: 'answer' } : undefined;
    const append: NewLedgerEvent[] = [];
    // A decision request is closed by its own `decision_resolved` (decision flow), not by an authority grant.
    if (confirmed && requestId && !decisionRequest) {
      const request = state.pendingAuthority.get(requestId);
      if (!request) return { posts: [], events: [] };
      if (request.personId !== message.authorId || !confirmed.every(op => operationKey(op) === request.operationKey)) throw new Error('Operation does not match authority request');
      append.push(make('authority_granted', { requestId, personId: message.authorId, granted: true }, `granted:${requestId}`));
    }
    const changeId = `${key}:change`;
    const deliveries: { agentId: string; taskId: string; input: UpdateInstructionsInput }[] = [];
    const summaryGroups = new Map<string, PlanOp[]>();
    applied.forEach((op, index) => {
      const groupKey = op.type === 'exclude_scope' || op.type === 'limit_scope' ? `task:${op.taskId}` : `op:${index}`;
      summaryGroups.set(groupKey, [...(summaryGroups.get(groupKey) ?? []), op]);
    });
    const summary = [...summaryGroups.values()].map(group => group.map((op, index) => {
      const text = describeOp(op, state).replace(/\s*\([^)]*포함\)/g, '');
      if (op.type !== 'exclude_scope' && op.type !== 'limit_scope') return text;
      return index > 0 ? text.replace(`${shortTaskName(state, op.taskId)}${op.type === 'exclude_scope' ? '에서' : ''} `, '') : text;
    }).join(', ')).join('; ');
    const sourceMessageIds = [...new Set(applied.flatMap(op => op.sourceMessageIds))];
    const dropFor = (taskId: string) => applied.filter((op): op is Extract<PlanOp, { type: 'exclude_scope' }> => op.type === 'exclude_scope' && op.taskId === taskId).map(op => op.item);
    for (const [index, a] of pending.entries()) {
      if (isWorkOp(a.op)) continue;
      if (judgement.decision !== 'speak' || !a.personId) continue;
      const text = channelText(`${state.members.get(a.personId)?.displayName ?? '담당자'}님, ${describeOp(a.op, state)} 변경을 승인하시겠어요?`, state);
      append.push(make('authority_requested', { requestId: `${changeId}:${index}:${a.personId}`, operationKey: operationKey(a.op), personId: a.personId, changeKinds: [a.kind], text }, `authority:${index}`));
      append.push(make('pm_spoke', { considerationId: key, messageId: `${key}:ask:${index}`, text, kind: 'ask' }, `ask:${index}`, true));
      post = undefined;
    }
    // Work changes outside the speaker's authority become one decision request per person, recommending exactly those ops (§2.3).
    const workAsks = new Map<string, typeof pending>();
    for (const a of pending) if (isWorkOp(a.op) && a.personId) workAsks.set(a.personId, [...(workAsks.get(a.personId) ?? []), a]);
    if (validJudgement && !confirmedOps) for (const [personId, asks] of workAsks) {
      const askOps = asks.map(a => a.op);
      const name = (id: string) => state.members.get(id)?.displayName ?? '담당자';
      const created = newTaskIds(askOps);
      const existing = [...new Set(askOps.flatMap(op => 'taskId' in op ? [op.taskId] : []))];
      const assignment = asks.every(a => a.kind === 'human_commitment');
      const list = askOps.map(op => describeOp(op, state)).join(', ');
      const question = `${name(personId)}님, ${bundled ? `${name(message.authorId)}님 말씀에서 작업 ${created.length}개가 나왔어요(${list}). 한 번에 반영할까요?`
        : assignment ? `${list}을 맡아 주시겠어요?` : `${name(message.authorId)}님 요청: ${list}. 반영할까요?`}`;
      const sourceMessageIds = [...new Set(askOps.flatMap(op => op.sourceMessageIds))];
      const requestId = `${key}:decision:${personId}`;
      try {
        append.push(createDecisionRequest(state, {
          requestId, kind: assignment ? 'assignment' : 'plan_change', targetMemberId: personId, question: channelText(question, state),
          options: [
            { optionId: 'apply', label: assignment ? '맡기' : '반영', effects: [{ type: 'plan_ops', ops: askOps }], tradeoff: '작업이 바로 생기고 Agent가 맡은 작업은 자동으로 시작돼요' },
            { optionId: 'hold', label: '보류', effects: [{ type: 'none' }], tradeoff: '지금은 만들지 않고 열린 주제로 남겨요' },
          ],
          recommendation: { optionId: 'apply', rationale: `${name(message.authorId)}님이 대화에서 요청한 일이에요`, evidence: sourceMessageIds },
          impact: { taskIds: [...created, ...existing], blockedTaskIds: [] },
          editable: askOps.length === 1 && askOps[0]!.type === 'create_task' ? ['title', 'priority'] : ['priority'],
          sourceMessageIds,
        }, { projectId: this.options.projectId, targetProductId: this.options.targetProductId }, now));
      } catch { continue; } // One open request per task: the earlier request still covers it.
      append.push(make('pm_spoke', { considerationId: key, messageId: `${key}:ask:decision:${personId}`, text: channelText(question, state), kind: 'ask', requestId, ...(existing.length ? { taskIds: existing } : {}) }, `ask:decision:${personId}`, true));
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
        const completedScope = applied.filter((op): op is Extract<PlanOp, { type: 'exclude_scope' | 'limit_scope' }> => (op.type === 'exclude_scope' || op.type === 'limit_scope') && (state.tasks.get(op.taskId)?.status === 'checked' || state.tasks.get(op.taskId)?.blocked?.prevStatus === 'checked'));
        const uncertainScope: string[] = [];
        for (const op of completedScope) {
          const spec = state.tasks.get(op.taskId)!.spec;
          const items = op.type === 'exclude_scope' ? [op.item] : op.items;
          if (!scopeMentions([spec.baseTitle ?? spec.title, ...spec.handoffConditions, outputText.get(op.taskId) ?? ''].join(' '), items)) { uncertainScope.push(...items); continue; }
          const reason = op.type === 'exclude_scope' ? `${op.item} 제외 반영` : `${op.items.join('·')} 범위 한정 반영`;
          const existing = reopens.find(r => r.taskId === op.taskId);
          if (existing) existing.reason = `${existing.reason}; ${reason}`;
          else reopens.push({ taskId: op.taskId, reason });
        }
        const appliedState = structuredClone(state);
        if (appliedState.plan) appliedState.plan.tasks = tasks;
        appliedState.goal = goal;
        for (const op of applied) if (op.type === 'set_availability') {
          if (op.weekStart) {
            const weeks = appliedState.availabilityOverrides.get(op.memberId) ?? new Map<string, number>();
            weeks.set(op.weekStart, op.weeklyHours); appliedState.availabilityOverrides.set(op.memberId, weeks);
          } else appliedState.availability.set(op.memberId, op.weeklyHours);
        }
        const after = settled(forecastRouted(appliedState, now));
        const late = after.uncertainty ? ` ${after.uncertainty.warning}.` : after.ok && after.lateness && after.lateness.maxDays > 0 ? ` 그래도 최대 ${formatKstDate(after.end.max)}로 기한을 넘깁니다.` : '';
        const reopening = reopens.length ? ` — ${reopens.map(r => `${shortTaskName(state, r.taskId).replace(/\s*\([^)]*포함\)/g, '')} 작업을 다시 열어 ${r.reason}을 맡겼어요`).join('; ')}` : '';
        post = uncertainScope.length
          ? { text: `정리하면: ${summary} — ${state.members.get(state.goal.decider)?.displayName ?? '결정권자'}님, ${[...new Set(uncertainScope)].join('·')} 변경을 반영하려면 어느 작업을 다시 열까요?`, kind: 'ask' }
          : { text: `정리하면: ${summary}${reopening}.${late}`, kind: 'summary' };
        judgement = { ...judgement, decision: 'speak', whoseAction: affected.join(', ') || state.goal.decider, alreadyKnows: 'no', evidence: sourceMessageIds.map(id => `msg:${id}`), reason: '확인된 변경을 계획과 담당자에게 반영', text: post.text };
        if (completedScope.length && reopens.length && !uncertainScope.length) {
          for (const reopen of reopens) reopen.announcement = channelText(post.text, state);
          // The executor announces only after the reopen actually succeeds.
          judgement = { ...judgement, decision: 'silent', text: '', reason: '범위 변경은 기록하고 재작업 실행 결과에서 요약을 알린다' };
          post = undefined;
        }
        append.push(make('decision_recorded', { decisionId: changeId, summary, sourceMessageIds, approvedBy: 'pm', changeKinds: [...new Set(applied.map(op => opAuthority(state, op).kind))] }));
        if (planChanged) append.push(make('plan_committed', { version: version + 1, basedOn: version, tasks, reason: summary, approvedBy: 'pm', sourceMessageIds }, 'plan_committed', true));
      }
      // Origin, brief, routing and priority of new work, in the same transaction as its plan version.
      for (const [index, op] of applied.entries()) {
        if (!isWorkOp(op)) continue;
        const creator = decisionRequest ? humanMessages.find(m => decisionRequest.request.sourceMessageIds.includes(m.messageId))?.authorId ?? message.authorId
          : op.sourceMessageIds.includes(messageId) ? message.authorId : humanMessages.find(m => op.sourceMessageIds.includes(m.messageId))?.authorId ?? 'pm';
        for (const meta of taskMetaFromOps([op], { planVersion: planChanged ? version + 1 : version, createdBy: creator, ...(decisionRequest ? { decisionRequestId: requestId! } : {}) })) {
          append.push(make('task_meta_set', meta, `meta:${index}:${meta.taskId}`));
        }
      }
      for (const id of absent.filter(id => state.members.get(id)?.kind === 'human')) {
        if (reopens.some(r => r.announcement && state.tasks.get(r.taskId)?.spec.assignee === id)) continue;
        const details = diff.changed.filter(c => c.prev.assignee === id || c.next.assignee === id).map(c => `${c.next.title}: ${c.next.assignee === id ? c.next.handoffConditions.join(', ') : '담당 작업에서 제외'}`);
        details.push(...diff.removed.filter(t => t.assignee === id).map(t => `${t.title}: 작업 취소`));
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
        const cancelled = diff.removed.find(t => t.id === taskId);
        if (!diff.changed.some(c => c.taskId === taskId) && !predecessorRework && !cancelled) continue;
        deliveries.push({ agentId, taskId, input: { updateId: `${changeId}:${agentId}`, fromVersion: version, toVersion: version + 1, keep: diff.unchanged.filter(t => t.assignee === agentId).map(t => t.title), change: [...diff.changed.filter(c => c.taskId === taskId).map(c => JSON.stringify(c.next)), ...(predecessorRework ? [reworkText] : [])], drop: cancelled ? [cancelled.title] : dropFor(taskId), reason: summary } });
      }
    }
    // Todo work whose assignee left the team and that no agent can take goes to the decider as an `assignment` request.
    // Asked once per task here; an answered (held) request is re-asked by the daily sweep, not on every message.
    const decider = state.goal?.decider;
    const planAfter = append.some(e => e.type === 'plan_committed') ? tasks : state.plan?.tasks ?? [];
    for (const { spec, route } of decider ? orphanRoutes(state, planAfter) : []) {
      const task = state.tasks.get(spec.id);
      if (!task || !['waiting', 'ready'].includes(task.status) || isParentTask(state, task)) continue;
      if (!route.ok || route.routing.reason !== 'no_capable_agent') continue;
      if ([...state.decisionRequests.values()].some(e => e.request.kind === 'assignment' && e.request.impact.blockedTaskIds.includes(spec.id))) continue;
      const person = route.assignee ?? decider!;
      const ops: PlanOp[] = [{ type: 'reassign', taskId: spec.id, assignee: person, sourceMessageIds: [] }];
      if (!opsApplicable(state, ops, decider!)) continue;
      const name = (id: string) => state.members.get(id)?.displayName ?? '담당자';
      const label = person === decider ? '제가 맡기' : `${name(person)}님이 맡기`;
      const requestId = `${key}:assignment:${spec.id}`;
      const text = channelText(`${name(decider!)}님, "${spec.title}" 작업을 맡을 담당이 팀에 없고 이 일을 할 수 있는 Agent도 없어요. 추천은 '${label}'입니다 — 결정 카드에서 골라 주세요.`, state);
      try {
        append.push(createDecisionRequest(state, {
          requestId, kind: 'assignment', targetMemberId: decider!, question: `"${spec.title}" 작업을 맡을 담당이 팀에 없어요. 누구에게 맡길까요?`,
          options: [
            { optionId: 'person', label, effects: [{ type: 'plan_ops', ops }], tradeoff: '사람의 일정에 이 작업이 더해집니다.' },
            { optionId: 'hold', label: '보류', effects: [{ type: 'none' }], tradeoff: '담당이 정해질 때까지 이 작업은 시작하지 않습니다.' },
          ],
          recommendation: { optionId: 'person', rationale: `담당 ${spec.assignee}이 팀에 없고, 이 일을 할 수 있는 Agent가 없어 사람이 맡아야 합니다.`, evidence: [] },
          impact: { taskIds: [spec.id], blockedTaskIds: [spec.id] }, sourceMessageIds: [],
        }, { projectId: this.options.projectId, targetProductId: this.options.targetProductId }, now));
      } catch { continue; } // One open request per task: the earlier request still covers it.
      append.push(make('pm_spoke', { considerationId: key, messageId: `${key}:ask:assignment:${spec.id}`, text, kind: 'ask', requestId, taskIds: [spec.id] }, `ask:assignment:${spec.id}`, true));
    }
    const agentAnswers = [...new Map((interpretation?.agentAnswers ?? []).map(a => [a.questionId, a])).values()].map(a => ({ taskId: pendingAgentQuestions.find(q => q.questionId === a.questionId)!.taskId, questionId: a.questionId, text: humanMessages.filter(m => a.sourceMessageIds.includes(m.messageId)).map(m => m.text).join('\n') }));
    const tx = await this.store.transaction<'duplicate' | 'retry' | 'applied'>(this.options.projectId, fresh => {
      if (fresh.some(e => e.idempotencyKey === `${key}:pm_considered`)) return { append: [], result: 'duplicate' };
      const latest = project(fresh);
      if ((confirmed && latest.lastSeq !== state.lastSeq) || fresh.slice(events.length).some(e => !['message_recorded', 'attachment_recorded'].includes(e.type))) {
        if (retry < 2) return { append: [], result: 'retry' };
        const text = '기록이 계속 바뀌어 변경을 반영하지 못했습니다. 잠시 후 다시 말씀해 주세요.';
        judgement = { ...judgement!, whoseAction: message.authorId, alreadyKnows: 'no', evidence: [`msg:${messageId}`], decision: 'speak', reason: '최신 기록 재판단 두 번 후에도 경합이 계속됨', text };
        append.length = 0; deliveries.length = 0; agentAnswers.length = 0; resolutions.length = 0; reopens.length = 0; post = { text, kind: 'ask' };
      }
      // Human approvals and decider conclusions start a new window before its changes.
      const approvals = append.filter(e => ['authority_granted', 'decision_recorded'].includes(e.type));
      const budgetState = project([...fresh, ...approvals.map((e, i) => ({ ...e, id: `budget:${i}`, seq: latest.lastSeq + i + 1, at: now.toISOString() }))]);
      const gate = automationGate(budgetState);
      // Each successful delivery records both update_sent and change_notified.
      const cost = append.filter(isAutomationAction).length + deliveries.length * 2;
      if (cost > gate.remaining) {
        if (confirmed) throw new Error('Automation limit reached; resume before applying approval');
        judgement = { ...judgement!, decision: 'silent', reason: '자동 행동 상한' }; post = undefined; append.length = 0; deliveries.length = 0; agentAnswers.length = 0; resolutions.length = 0; reopens.length = 0;
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
      if (failedJudgement) {
        append.push(make('judgement_failed', { triggerId: messageId, stage: interpretation ? 'judgement' : 'interpretation', reason: '재생성 후에도 모델 응답 검증 실패' }));
        // Preserve grounded deterministic answers, while still disclosing the failed model judgement.
        if (post?.text !== JUDGEMENT_FAILURE_TEXT) append.push(make('pm_spoke', { considerationId: key, messageId: `${key}:failure`, text: JUDGEMENT_FAILURE_TEXT, kind: 'ask' }, 'failure-notice'));
      }
      // New work goes straight to work: reserve its start in the same transaction (§3 B3). Only the new tasks;
      // the dispatcher's own triggers keep starting everything else.
      const created = new Set(newTaskIds(applied));
      if (created.size && append.some(e => e.type === 'plan_committed')) {
        const after = project([...fresh, ...append.map((e, i) => ({ ...e, id: `pending:${i}`, seq: latest.lastSeq + i + 1, at: e.at ?? now.toISOString() }))]);
        append.push(...planStarts(after, key, { projectId: this.options.projectId, targetProductId: this.options.targetProductId })
          .filter(e => created.has((e.payload as EventPayloads['task_start_reserved']).taskId)));
      }
      return { append, result: 'applied' };
    });
    if (tx.result === 'retry') return this.consider(messageId, confirmed, requestId, retry + 1);
    if (tx.result === 'duplicate') return { posts: [], events: [] };
    const result: CoordinationResult = { posts: post ? [post] : [], events: tx.appended, ...(agentAnswers.length ? { agentAnswers } : {}), ...(resolutions.length ? { resolutions } : {}), ...(reopens.length ? { reopens } : {}) };
    const starts = (tx.appended as AnyEvent[]).flatMap(e => e.type === 'task_start_reserved' ? [e.payload.taskId] : []);
    const requests = (tx.appended as AnyEvent[]).flatMap(e => e.type === 'decision_requested' ? [e.payload.requestId] : []);
    if (starts.length) result.starts = starts;
    if (requests.length) result.requests = requests;
    for (const e of tx.appended as AnyEvent[]) if (e.type === 'pm_spoke' && e.idempotencyKey === `${key}:failure-notice`) result.posts.push({ text: e.payload.text, kind: 'ask' });
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
