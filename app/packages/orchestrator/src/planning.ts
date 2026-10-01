import { randomUUID } from 'node:crypto';
import { project, type EventContext, type EventPayloads, type NewLedgerEvent, type ProjectState, type TaskSpec } from '@ensemble/core';
import type { LlmProvider, ToolSpec } from '@ensemble/llm';
import type { LedgerStore } from '@ensemble/store';
import type { Dispatcher } from './dispatch.ts';
import type { PmPost } from './pm.ts';

export type PlanningMember = EventPayloads['member_joined'] & { weeklyHours?: number };
export interface PlanInput { goal: string; deadline?: string; members: PlanningMember[]; decider: string; }
export interface PlanDraft { tasks: TaskSpec[]; estimates: EventPayloads['plan_proposed']['estimates']; reason: string }
const nonempty = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
/** Final drafting failure: `reason` is shown to people, `detail` is for server logs only. */
export class PlanDraftingError extends Error {
  constructor(readonly reason: string, readonly detail: string) { super(`Plan drafting failed after two attempts: ${detail}`); this.name = 'PlanDraftingError'; }
}
class MissingTemplateRoleError extends PlanDraftingError {
  constructor(reason: string) { super(reason, 'Missing MVP template role'); }
}
/** One rejected attempt whose cause is known: `message` goes back to the model, `reason` to people. */
class AttemptFailure extends Error {
  constructor(message: string, readonly reason: string, options?: ErrorOptions) { super(message, options); }
}
/** Subtasks per template task in a first plan; depth stays within MAX_TASK_DEPTH (task → subtask). */
export const MAX_SUBTASKS = 3;
const INVALID_DRAFT_REASON = '모델이 만든 초안이 계획 규칙(담당자, 의존 관계, 예상 시간)을 지키지 못했습니다';
// Preserve the M5 output budget and truncation retry for Korean titles and conditions.
const DRAFT_MAX_TOKENS = 8192;
/** Delivery is performed by the system; acceptance must be observable in artifact content. */
export const unobservableHandoffCondition = (condition: string): boolean =>
  /(?:전달|공유|업로드|알림|통보|전송)(?:했다|했음|했는|함|하기|할\s*것|한다|하여|하고|되어|된|완료|\s*$)/.test(condition)
  || /(?:디자이너|담당자|팀원|채널|슬랙).{0,35}(?:전달|공유|업로드|통보|전송)/.test(condition);

/** SOUND / COMMITTED CHANGE: code owns the four-role template and validates identities and DAG;
 * only the human decider commits it. Fake-provider tests observe retries and zero early starts.
 * Roles are explicit capabilities supplied by the caller, never inferred from task title words.
 */
export async function proposePlan(input: PlanInput & { llm: LlmProvider; model: string }): Promise<PlanDraft> {
  if (!nonempty(input.goal) || !input.members.length) throw new Error('목표와 팀원을 먼저 입력해 주세요.');
  const template = [
    { id: 'research', assignee: 'research-agent', kind: 'agent', purpose: '경쟁사와 유사 사례 조사', dependsOn: [] as string[] },
    { id: 'interview', assignee: input.decider, kind: 'human', purpose: '고객 인터뷰', dependsOn: [] as string[] },
    { id: 'flow', assignee: 'designer', kind: 'human', purpose: '조사와 인터뷰를 바탕으로 사용 흐름 설계', dependsOn: ['research', 'interview'] },
    { id: 'prototype', assignee: 'prototype-agent', kind: 'agent', purpose: '사용 흐름 기반 프로토타입 구현', dependsOn: ['flow'] },
  ];
  const missing = template.filter(t => !input.members.some(m => m.memberId === t.assignee && m.kind === t.kind && (m.kind !== 'agent' || nonempty(m.role))));
  if (missing.length || input.decider === 'designer') throw new MissingTemplateRoleError(
    `역할 템플릿에 필요한 팀원이 부족합니다: ${missing.length ? missing.map(t => `${t.purpose} 담당(${t.assignee})`).join(', ') : '결정권자와 별도의 디자이너'}`);
  const taskIds = template.map(t => t.id);
  let failure = '', reason = INVALID_DRAFT_REASON, detail = '';
  const failures: string[] = [];
  const complete = async (request: Parameters<LlmProvider['complete']>[0]) => {
    let response;
    try { response = await input.llm.complete(request); } catch (error) { throw new AttemptFailure('Model call failed', 'PM 모델을 호출하지 못했습니다', { cause: error }); }
    if (response.stopReason === 'max_tokens') throw new AttemptFailure(`The ${request.forceTool} response was cut off by the output token limit; keep titles and handoff conditions short`, '초안이 너무 길어 모델 응답이 중간에 잘렸습니다');
    return response;
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const facts = { goal: input.goal, deadline: input.deadline, members: input.members, template,
        rules: { handoffConditions: 'Each task has 1–3 nonempty conditions. Group related requirements into a condition without omitting any goal requirement.', hours: 'Finite 0 <= min <= max', templateKeys: taskIds },
        ...(failure ? { validationError: failure, retryInstruction: 'Fix this exact violation, then recheck all four tasks against rules. Preserve all requested scope and constraints.' } : {}) };
      const tool: ToolSpec = { name: 'propose_plan', description: 'Draft the first plan for human approval', inputSchema: {
        type: 'object', additionalProperties: false, required: ['tasks'], properties: {
          tasks: { type: 'array', minItems: taskIds.length, maxItems: taskIds.length, items: {
            type: 'object', additionalProperties: false, required: ['templateKey', 'title', 'handoffConditions', 'hours'], properties: {
              templateKey: { enum: taskIds }, title: { type: 'string', minLength: 1 },
              handoffConditions: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', minLength: 1 } },
              hours: { type: 'object', additionalProperties: false, required: ['min', 'max'], properties: { min: { type: 'number', minimum: 0 }, max: { type: 'number', minimum: 0 } } },
              subtasks: { type: 'array', maxItems: MAX_SUBTASKS, description: 'Optional. Only for clearly separable parts the same assignee hands off one by one; the task then only groups them.', items: {
                type: 'object', additionalProperties: false, required: ['title', 'handoffConditions', 'hours'], properties: {
                  title: { type: 'string', minLength: 1 }, handoffConditions: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', minLength: 1 } },
                  hours: { type: 'object', additionalProperties: false, required: ['min', 'max'], properties: { min: { type: 'number', minimum: 0 }, max: { type: 'number', minimum: 0 } } },
                },
              } },
            },
          } },
        },
      } };
      const response = await complete({ model: input.model, forceTool: tool.name, tools: [tool], maxTokens: DRAFT_MAX_TOKENS,
        system: 'Fill each of the four supplied MVP role-template tasks exactly once. Task identities, assignees and dependencies are fixed by code. Supply only templateKey, a goal-specific title, 1–3 concrete handoff conditions and an hour range. A task may optionally list up to 3 subtasks (title, conditions, hours) when it holds clearly separable parts its assignee hands off one by one; do not split by default. The 3-condition maximum applies to EVERY task, especially flow: combine related screen requirements into one condition, preserving all requirements and prohibitions. Do not append a fourth condition for customer problem selection; combine it with the design rationale condition. Before responding, count the conditions for each task and check rules and validationError. Keep work within the supplied role purpose and availability. If selecting a customer problem requires a decision, express it as a flow handoff condition, never as another task. Do not invent members or capabilities. Handoff conditions must be verifiable solely from artifact contents. For research, require the covered subjects, a cited source (URL or document name) per item and a separate limitations section for anything not directly checked; never require that sources were actually opened, accessed or verified live, because a reviewer cannot observe that from the artifact and the agent may have no web access. Never require delivery, sharing, upload, notification, or evidence that someone received a document (전달, 공유, 업로드, 알림): those are system responsibilities. State required content, not communication actions.',
        messages: [{ role: 'user', content: JSON.stringify(facts) }] });
      const call = response.toolCalls.length === 1 ? response.toolCalls[0] : undefined;
      const value = call?.input;
      if (call?.name !== tool.name || !value || !Array.isArray(value.tasks) || value.tasks.length !== taskIds.length || Object.keys(value).some(k => k !== 'tasks')) throw new Error('Invalid plan draft');
      const tasks: TaskSpec[] = [];
      const estimates: PlanDraft['estimates'] = [];
      for (const raw of value.tasks) {
        const t = raw as Record<string, unknown>;
        if (!t || !taskIds.includes(String(t.templateKey)) || !nonempty(t.title)) throw new Error('Invalid template key or title');
        if (Object.keys(t).some(k => !['templateKey', 'title', 'handoffConditions', 'hours', 'subtasks'].includes(k))) throw new Error('Fields outside the role template are forbidden');
        const slot = template.find(slot => slot.id === t.templateKey)!;
        const member = input.members.find(m => m.memberId === slot.assignee);
        if (!member || member.kind !== slot.kind || (member.kind === 'agent' && !nonempty(member.role))) throw new Error('Unknown assignee or incompatible agent role');
        if (!Array.isArray(t.handoffConditions) || t.handoffConditions.length < 1 || t.handoffConditions.length > 3 || !t.handoffConditions.every(nonempty)) throw new Error(`Task ${slot.id}: handoffConditions must contain 1–3 nonempty strings; received ${Array.isArray(t.handoffConditions) ? t.handoffConditions.length : typeof t.handoffConditions}. Combine related requirements without dropping any scope or constraints.`);
        if (t.handoffConditions.some(unobservableHandoffCondition)) {
          if (attempt === 0) throw new Error('Handoff conditions must be verifiable in artifact contents; remove delivery/sharing/upload/notification requirements and regenerate');
          const observable = t.handoffConditions.filter(c => !unobservableHandoffCondition(c));
          if (!observable.length) throw new AttemptFailure('No observable handoff condition remains', '모델이 만든 인계 조건에 결과물 내용으로 확인 가능한 요구가 없습니다');
          t.handoffConditions = observable;
        }
        const h = t.hours as { min: number; max: number } | undefined;
        if (!h || !Number.isFinite(h.min) || !Number.isFinite(h.max) || h.min < 0 || h.max < h.min) throw new Error(`Task ${slot.id}: Invalid estimate ${JSON.stringify(h)}; hours must satisfy finite 0 <= min <= max.`);
        tasks.push({ id: slot.id, title: t.title, baseTitle: t.title, exclusions: [], limits: [], assignee: member.memberId, dependsOn: [...slot.dependsOn], handoffConditions: t.handoffConditions as string[] });
        estimates.push({ taskId: slot.id, hours: { min: h.min, max: h.max } });
        // Subtasks keep the slot's assignee and inherit its dependencies (projection reads each task's own dependsOn).
        const subtasks = t.subtasks ?? [];
        if (!Array.isArray(subtasks) || subtasks.length > MAX_SUBTASKS) throw new Error(`Task ${slot.id}: subtasks must be an array of at most ${MAX_SUBTASKS}`);
        for (const [n, raw] of subtasks.entries()) {
          const sub = raw as Record<string, unknown>;
          const subId = `${slot.id}-${n + 1}`;
          if (!sub || !nonempty(sub.title) || Object.keys(sub).some(k => !['title', 'handoffConditions', 'hours'].includes(k))) throw new Error(`Subtask ${subId}: needs only a title, conditions and hours`);
          if (!Array.isArray(sub.handoffConditions) || sub.handoffConditions.length < 1 || sub.handoffConditions.length > 3 || !sub.handoffConditions.every(nonempty)) throw new Error(`Subtask ${subId}: handoffConditions must contain 1–3 nonempty strings`);
          if (sub.handoffConditions.some(unobservableHandoffCondition)) throw new Error(`Subtask ${subId}: handoff conditions must be verifiable in artifact contents`);
          const sh = sub.hours as { min: number; max: number } | undefined;
          if (!sh || !Number.isFinite(sh.min) || !Number.isFinite(sh.max) || sh.min < 0 || sh.max < sh.min) throw new Error(`Subtask ${subId}: Invalid estimate ${JSON.stringify(sh)}; hours must satisfy finite 0 <= min <= max.`);
          tasks.push({ id: subId, title: sub.title, baseTitle: sub.title, exclusions: [], limits: [], assignee: member.memberId, dependsOn: [...slot.dependsOn], handoffConditions: sub.handoffConditions as string[], parentId: slot.id });
          estimates.push({ taskId: subId, hours: { min: sh.min, max: sh.max } });
        }
      }
      const byId = new Map(tasks.map(t => [t.id, t]));
      if (byId.size !== tasks.length || taskIds.some(id => !byId.has(id))) throw new Error('Duplicate or missing task ID');
      const visiting = new Set<string>(), visited = new Set<string>();
      const visit = (id: string) => {
        if (visiting.has(id)) throw new Error('Cyclic dependencies');
        if (visited.has(id)) return;
        const task = byId.get(id);
        if (!task) throw new Error('Dependency absent from draft');
        visiting.add(id); task.dependsOn.forEach(visit); visiting.delete(id); visited.add(id);
      };
      tasks.forEach(t => visit(t.id));
      return { tasks: taskIds.flatMap(id => [byId.get(id)!, ...tasks.filter(t => t.parentId === id)]), estimates, reason: 'MVP 역할 템플릿: 조사와 인터뷰 → 사용 흐름 설계 → 프로토타입' };
    } catch (error) {
      failure = error instanceof Error ? error.message : 'Invalid draft';
      reason = error instanceof AttemptFailure ? error.reason : INVALID_DRAFT_REASON;
      const cause = error instanceof Error && error.cause;
      detail = cause ? `${failure}: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}` : failure;
      failures.push(`attempt ${attempt + 1}: ${detail}`);
      console.warn('[planning] draft rejected', { attempt: attempt + 1, detail });
    }
  }
  throw new PlanDraftingError(reason, failures.join('\n'));
}

export function planningNotice(context: EventContext, key: string, memberId: string, text: string, openTopics: string[] = [], reason = '사람이 다음 행동을 결정해야 한다'): NewLedgerEvent[] {
  const actor = { kind: 'system' as const, id: 'pm' };
  return [
    { ...context, actor, type: 'pm_considered', idempotencyKey: `${key}:considered`, payload: { considerationId: key, triggerId: key, whoseAction: memberId, alreadyKnows: 'no', evidence: [key], decision: 'speak', reason, openTopics } },
    { ...context, actor, type: 'pm_spoke', idempotencyKey: `${key}:speech`, payload: { considerationId: key, messageId: `${key}:speech`, text, kind: 'ask' } },
  ];
}

export type FreeStartResult = { proposal: EventPayloads['plan_proposed']; failure?: undefined } | { proposal?: undefined; failure: PlanDraftingError };

/** A final drafting failure is recorded as the goal plus a short PM notice, not thrown to the caller. */
export async function startFreeProject(options: { store: LedgerStore; llm: LlmProvider; model: string; context: EventContext }, goal: string, deadline?: string): Promise<FreeStartResult> {
  const state = project(await options.store.read({ projectId: options.context.projectId }));
  if (state.plan || state.pendingPlans.size) throw new Error('이미 계획이나 승인 대기 중인 초안이 있습니다.');
  if (!state.goal || state.members.get(state.goal.decider)?.kind !== 'human') throw new Error('계획을 결정할 사람을 먼저 지정해 주세요.');
  if (deadline !== undefined && !Number.isFinite(Date.parse(deadline))) throw new Error('올바른 기한을 입력해 주세요.');
  const members = [...state.members.values()].map(m => ({ ...m, weeklyHours: state.availability.get(m.memberId) }));
  const goalSet: NewLedgerEvent = { ...options.context, actor: { kind: 'system', id: 'pm' }, type: 'goal_set', payload: { ...state.goal, text: goal, ...(deadline ? { deadline } : {}) } };
  const record = (append: NewLedgerEvent[]) => options.store.transaction(options.context.projectId, events => {
    if (events.some(e => e.seq > state.lastSeq && !['message_recorded', 'attachment_recorded', 'pm_considered', 'pm_spoke', 'reply_recorded'].includes(e.type))) throw new Error('초안을 만드는 동안 팀 기록이 바뀌었습니다. 다시 시도해 주세요.');
    return { append, result: undefined };
  });
  let draft: PlanDraft;
  try {
    draft = await proposePlan({ goal, deadline, members, decider: state.goal.decider, llm: options.llm, model: options.model });
  } catch (error) {
    if (!(error instanceof PlanDraftingError)) throw error;
    await record([goalSet, ...planningNotice(options.context, `plan-failed:${randomUUID()}`, state.goal.decider,
      error instanceof MissingTemplateRoleError ? `${error.reason}.` : `계획 초안을 만들지 못했습니다: ${error.reason}. 목표를 조금 더 구체적으로 적어 '자유형식'에서 다시 시작해 주세요.`, state.openTopics)]);
    return { failure: error };
  }
  const proposal = { ...draft, proposalId: randomUUID(), version: 1, forMemberId: state.goal.decider };
  await record([goalSet,
    { ...options.context, actor: { kind: 'system', id: 'pm' }, type: 'plan_proposed', payload: proposal },
    ...planningNotice(options.context, proposal.proposalId, proposal.forMemberId, '계획 v1 초안을 확인하고 승인해 주세요.', state.openTopics, '계획 초안에 대한 결정권자 승인이 필요하다')]);
  return { proposal };
}

/**
 * Metadata of a first-plan task, recorded with its commit (§3 B2). The role template fixes who does
 * what, so routing follows the assignee's kind; the brief says why the work serves the goal.
 */
export function initialTaskMeta(state: ProjectState, tasks: readonly TaskSpec[], task: TaskSpec): EventPayloads['task_meta_set'] {
  const agent = state.members.get(task.assignee)?.kind === 'agent';
  const parent = tasks.find(t => t.id === task.parentId);
  const goal = state.goal?.text ?? '';
  return {
    taskId: task.id, priority: 'normal',
    routing: agent ? { executor: 'agent', reason: 'agent_capable', note: 'Agent 역할로 할 수 있는 일이라 바로 맡겼어요' }
      : { executor: 'human', reason: 'needs_human_judgement', note: '사람의 판단과 접촉이 필요한 일이라 사람이 맡아요' },
    brief: { why: parent ? `목표 "${goal}"를 위한 ${parent.title}의 하위 작업이에요` : `목표 "${goal}"를 위해 필요한 일이에요`, sourceMessageIds: [], decisionIds: [], attachmentIds: [], constraints: [] },
    origin: { createdBy: 'pm', planVersion: 1, sourceMessageIds: [] },
  };
}

export async function decidePlan(options: { store: LedgerStore; context: EventContext; dispatcher: Dispatcher }, proposalId: string, memberId: string, approve: boolean): Promise<PmPost[]> {
  const tx = await options.store.transaction(options.context.projectId, events => {
    const state = project(events), proposal = state.pendingPlans.get(proposalId);
    if (!proposal) {
      const original = events.find(e => e.type === 'plan_proposed' && (e.payload as EventPayloads['plan_proposed']).proposalId === proposalId)?.payload as EventPayloads['plan_proposed'] | undefined;
      if (original && (memberId !== original.forMemberId || state.members.get(memberId)?.kind !== 'human')) throw new Error('계획은 결정권자만 승인할 수 있습니다.');
      if (events.some(e => e.type === 'plan_decided' && (e.payload as EventPayloads['plan_decided']).proposalId === proposalId)) return { append: [], result: false };
      throw new Error('해당 계획 초안을 찾지 못했습니다.');
    }
    if (memberId !== proposal.forMemberId || memberId !== state.goal?.decider || state.members.get(memberId)?.kind !== 'human') throw new Error('계획은 결정권자만 승인할 수 있습니다.');
    if (state.plan) throw new Error('초기 계획이 이미 확정됐습니다.');
    const base = { ...options.context, actor: { kind: 'human' as const, id: memberId } };
    const append: NewLedgerEvent[] = [{ ...base, type: 'plan_decided', payload: { proposalId, memberId, approved: approve } }];
    if (approve) append.push({ ...base, type: 'plan_committed', payload: { version: 1, basedOn: null, tasks: proposal.tasks, reason: proposal.reason, approvedBy: memberId, sourceMessageIds: [] } }, ...proposal.estimates.map(e => ({ ...base, type: 'estimate_updated', payload: { ...e, source: 'pm' } })),
      // Work metadata goes in with the commit, so every first-plan task has its routing and brief from the start.
      ...proposal.tasks.map((task): NewLedgerEvent => ({ ...options.context, actor: { kind: 'system', id: 'pm' }, type: 'task_meta_set', idempotencyKey: `plan-meta:${proposalId}:${task.id}`, payload: initialTaskMeta(state, proposal.tasks, task) })));
    else append.push(...planningNotice(options.context, `reject:${proposalId}`, memberId, '계획에서 무엇을 바꾸면 좋을까요?', state.openTopics));
    return { append, result: true };
  });
  if (!tx.result) return [];
  if (!approve) return [{ text: '계획에서 무엇을 바꾸면 좋을까요?', kind: 'ask' }];
  const starts = await options.dispatcher.startReady(proposalId);
  const posts: PmPost[] = [...starts.notices, ...starts.failures].map(text => ({ text, kind: 'ask' }));
  for (const [i, post] of posts.entries()) await options.store.append(planningNotice(options.context, `start:${proposalId}:${i}`, memberId, post.text, [], '승인된 계획에서 다음 작업을 시작할 수 있다'));
  return posts;
}
