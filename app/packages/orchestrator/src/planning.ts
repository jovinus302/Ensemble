import { randomUUID } from 'node:crypto';
import { project, type EventContext, type EventPayloads, type NewLedgerEvent, type TaskSpec } from '@ensemble/core';
import type { LlmProvider, ToolSpec } from '@ensemble/llm';
import type { LedgerStore } from '@ensemble/store';
import type { Dispatcher } from './dispatch.ts';
import type { PmPost } from './pm.ts';

export type PlanningMember = EventPayloads['member_joined'] & { weeklyHours?: number };
export interface PlanInput { goal: string; deadline?: string; members: PlanningMember[]; roleTemplate: Record<string, string>; }
export interface PlanDraft { tasks: TaskSpec[]; estimates: EventPayloads['plan_proposed']['estimates']; reason: string }
const nonempty = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
/** Final drafting failure: `reason` is shown to people, `detail` is for server logs only. */
export class PlanDraftingError extends Error {
  constructor(readonly reason: string, readonly detail: string) { super(`Plan drafting failed after two attempts: ${detail}`); this.name = 'PlanDraftingError'; }
}
/** One rejected attempt whose cause is known: `message` goes back to the model, `reason` to people. */
class AttemptFailure extends Error {
  constructor(message: string, readonly reason: string, options?: ErrorOptions) { super(message, options); }
}
const INVALID_DRAFT_REASON = '모델이 만든 초안이 계획 규칙(담당자, 의존 관계, 예상 시간)을 지키지 못했습니다';
// A full draft carries ids, titles, conditions and estimates for every task; 2048 tokens cut off 14 Korean tasks.
const DRAFT_MAX_TOKENS = 8192;

/** SOUND / COMMITTED CHANGE: bounded model draft, code validates identities and DAG;
 * only the human decider commits it. Fake-provider tests observe retries and zero early starts.
 * Roles are explicit capabilities supplied by the caller, never inferred from task title words.
 */
export async function proposePlan(input: PlanInput & { llm: LlmProvider; model: string }): Promise<PlanDraft> {
  if (!nonempty(input.goal) || !input.members.length) throw new Error('Goal and members are required');
  const roles = [...new Set(input.members.map(m => m.role).filter(nonempty))];
  let failure = '', reason = INVALID_DRAFT_REASON, detail = '';
  const complete = async (request: Parameters<LlmProvider['complete']>[0]) => {
    let response;
    try { response = await input.llm.complete(request); } catch (error) { throw new AttemptFailure('Model call failed', 'PM 모델을 호출하지 못했습니다', { cause: error }); }
    if (response.stopReason === 'max_tokens') throw new AttemptFailure(`The ${request.forceTool} response was cut off by the output token limit; keep titles and handoff conditions short`, '초안이 너무 길어 모델 응답이 중간에 잘렸습니다');
    return response;
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // Obtain the draft's task inventory first so the dependency enum contains exactly
      // its IDs, rather than an arbitrary finite pool or references invented by the model.
      const facts = { goal: input.goal, deadline: input.deadline, members: input.members, roleTemplate: input.roleTemplate, ...(failure ? { validationError: failure } : {}) };
      const inventory = await complete({ model: input.model, forceTool: 'outline_plan',
        system: 'List the tasks needed for this goal, using only the supplied team capabilities and availability.',
        tools: [{ name: 'outline_plan', description: 'Draft task inventory', inputSchema: { type: 'object', additionalProperties: false, required: ['tasks'], properties: { tasks: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } } } } }],
        messages: [{ role: 'user', content: JSON.stringify(facts) }] });
      const outline = inventory.toolCalls.length === 1 && inventory.toolCalls[0]?.name === 'outline_plan' ? inventory.toolCalls[0].input.tasks : undefined;
      if (!Array.isArray(outline) || !outline.length || !outline.every(nonempty)) throw new Error('Invalid task inventory');
      const taskIds = outline.map((_, i) => `task-${i + 1}`);
  const tool: ToolSpec = { name: 'propose_plan', description: 'Draft the first plan for human approval', inputSchema: {
    type: 'object', additionalProperties: false, required: ['tasks', 'reason'], properties: {
      reason: { type: 'string', minLength: 1 }, tasks: { type: 'array', minItems: taskIds.length, maxItems: taskIds.length, items: {
        type: 'object', additionalProperties: false, required: ['id', 'title', 'assignee', 'role', 'dependsOn', 'handoffConditions', 'hours'], properties: {
          id: { enum: taskIds }, title: { type: 'string', minLength: 1 }, assignee: { enum: input.members.map(m => m.memberId) },
          role: { enum: [...roles, 'human'] }, dependsOn: { type: 'array', uniqueItems: true, items: { enum: taskIds } },
          handoffConditions: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', minLength: 1 } },
          hours: { type: 'object', additionalProperties: false, required: ['min', 'max'], properties: { min: { type: 'number', minimum: 0 }, max: { type: 'number', minimum: 0 } } },
        },
      } },
    },
  } };
      const response = await complete({ model: input.model, forceTool: tool.name, tools: [tool], maxTokens: DRAFT_MAX_TOKENS,
        system: 'Draft a feasible plan using only the supplied goal, team roles and availability. Select unique task IDs from the enum; dependencies must reference tasks included in this draft. Assign agents only work within their declared role. Each task needs 1–3 concrete handoff conditions and an hour range. Do not invent members or capabilities.',
        messages: [{ role: 'user', content: JSON.stringify({ ...facts, taskInventory: outline.map((title, i) => ({ id: taskIds[i], title })) }) }] });
      const call = response.toolCalls.length === 1 ? response.toolCalls[0] : undefined;
      const value = call?.input;
      if (call?.name !== tool.name || !value || !nonempty(value.reason) || !Array.isArray(value.tasks) || !value.tasks.length || value.tasks.length > taskIds.length) throw new Error('Invalid plan draft');
      const tasks: TaskSpec[] = [];
      const estimates: PlanDraft['estimates'] = [];
      for (const raw of value.tasks) {
        const t = raw as Record<string, unknown>;
        if (!t || !taskIds.includes(String(t.id)) || !nonempty(t.title)) throw new Error('Invalid task identity');
        const member = input.members.find(m => m.memberId === t.assignee);
        if (!member || (member.kind === 'agent' && (!member.role || t.role !== member.role))) throw new Error('Unknown assignee or incompatible agent role');
        if (!Array.isArray(t.dependsOn) || !t.dependsOn.every(nonempty) || new Set(t.dependsOn).size !== t.dependsOn.length) throw new Error('Invalid dependencies');
        if (!Array.isArray(t.handoffConditions) || t.handoffConditions.length < 1 || t.handoffConditions.length > 3 || !t.handoffConditions.every(nonempty)) throw new Error('Invalid handoff conditions');
        const h = t.hours as { min: number; max: number } | undefined;
        if (!h || !Number.isFinite(h.min) || !Number.isFinite(h.max) || h.min < 0 || h.max < h.min) throw new Error('Invalid estimate');
        tasks.push({ id: String(t.id), title: t.title, assignee: member.memberId, dependsOn: t.dependsOn, handoffConditions: t.handoffConditions });
        estimates.push({ taskId: String(t.id), hours: { min: h.min, max: h.max } });
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
      return { tasks, estimates, reason: value.reason };
    } catch (error) {
      failure = error instanceof Error ? error.message : 'Invalid draft';
      reason = error instanceof AttemptFailure ? error.reason : INVALID_DRAFT_REASON;
      const cause = error instanceof Error && error.cause;
      detail = cause ? `${failure}: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}` : failure;
    }
  }
  throw new PlanDraftingError(reason, detail);
}

export function planningNotice(context: EventContext, key: string, memberId: string, text: string, openTopics: string[] = []): NewLedgerEvent[] {
  const actor = { kind: 'system' as const, id: 'pm' };
  return [
    { ...context, actor, type: 'pm_considered', idempotencyKey: `${key}:considered`, payload: { considerationId: key, triggerId: key, whoseAction: memberId, alreadyKnows: 'no', evidence: [key], decision: 'speak', reason: 'A person must decide the next action', openTopics } },
    { ...context, actor, type: 'pm_spoke', idempotencyKey: `${key}:speech`, payload: { considerationId: key, messageId: `${key}:speech`, text, kind: 'ask' } },
  ];
}

export type FreeStartResult = { proposal: EventPayloads['plan_proposed']; failure?: undefined } | { proposal?: undefined; failure: PlanDraftingError };

/** A final drafting failure is recorded as the goal plus a short PM notice, not thrown to the caller. */
export async function startFreeProject(options: { store: LedgerStore; llm: LlmProvider; model: string; context: EventContext }, goal: string, deadline?: string): Promise<FreeStartResult> {
  const state = project(await options.store.read({ projectId: options.context.projectId }));
  if (state.plan || state.pendingPlans.size) throw new Error('A plan or proposal already exists');
  if (!state.goal || state.members.get(state.goal.decider)?.kind !== 'human') throw new Error('A human decider must be configured');
  if (deadline !== undefined && !Number.isFinite(Date.parse(deadline))) throw new Error('Invalid deadline');
  const members = [...state.members.values()].map(m => ({ ...m, weeklyHours: state.availability.get(m.memberId) }));
  const goalSet: NewLedgerEvent = { ...options.context, actor: { kind: 'system', id: 'pm' }, type: 'goal_set', payload: { ...state.goal, text: goal, ...(deadline ? { deadline } : {}) } };
  const record = (append: NewLedgerEvent[]) => options.store.transaction(options.context.projectId, events => {
    if (project(events).lastSeq !== state.lastSeq) throw new Error('Team changed while drafting; retry');
    return { append, result: undefined };
  });
  let draft: PlanDraft;
  try {
    draft = await proposePlan({ goal, deadline, members, roleTemplate: Object.fromEntries(members.filter(m => m.role).map(m => [m.memberId, m.role!])), llm: options.llm, model: options.model });
  } catch (error) {
    if (!(error instanceof PlanDraftingError)) throw error;
    await record([goalSet, ...planningNotice(options.context, `plan-failed:${randomUUID()}`, state.goal.decider,
      `계획 초안을 만들지 못했습니다: ${error.reason}. 목표를 조금 더 구체적으로 적어 '자유형식'에서 다시 시작해 주세요.`, state.openTopics)]);
    return { failure: error };
  }
  const proposal = { ...draft, proposalId: randomUUID(), version: 1, forMemberId: state.goal.decider };
  await record([goalSet,
    { ...options.context, actor: { kind: 'system', id: 'pm' }, type: 'plan_proposed', payload: proposal },
    ...planningNotice(options.context, proposal.proposalId, proposal.forMemberId, '계획 v1 초안을 확인하고 승인해 주세요.', state.openTopics)]);
  return { proposal };
}

export async function decidePlan(options: { store: LedgerStore; context: EventContext; dispatcher: Dispatcher }, proposalId: string, memberId: string, approve: boolean): Promise<PmPost[]> {
  const tx = await options.store.transaction(options.context.projectId, events => {
    const state = project(events), proposal = state.pendingPlans.get(proposalId);
    if (!proposal) {
      const original = events.find(e => e.type === 'plan_proposed' && (e.payload as EventPayloads['plan_proposed']).proposalId === proposalId)?.payload as EventPayloads['plan_proposed'] | undefined;
      if (original && (memberId !== original.forMemberId || state.members.get(memberId)?.kind !== 'human')) throw new Error('Only the decider may approve the plan');
      if (events.some(e => e.type === 'plan_decided' && (e.payload as EventPayloads['plan_decided']).proposalId === proposalId)) return { append: [], result: false };
      throw new Error('Unknown plan proposal');
    }
    if (memberId !== proposal.forMemberId || memberId !== state.goal?.decider || state.members.get(memberId)?.kind !== 'human') throw new Error('Only the decider may approve the plan');
    if (state.plan) throw new Error('Initial plan already committed');
    const base = { ...options.context, actor: { kind: 'human' as const, id: memberId } };
    const append: NewLedgerEvent[] = [{ ...base, type: 'plan_decided', payload: { proposalId, memberId, approved: approve } }];
    if (approve) append.push({ ...base, type: 'plan_committed', payload: { version: 1, basedOn: null, tasks: proposal.tasks, reason: proposal.reason, approvedBy: memberId, sourceMessageIds: [] } }, ...proposal.estimates.map(e => ({ ...base, type: 'estimate_updated', payload: { ...e, source: 'pm' } })));
    else append.push(...planningNotice(options.context, `reject:${proposalId}`, memberId, '계획에서 무엇을 바꾸면 좋을까요?', state.openTopics));
    return { append, result: true };
  });
  if (!tx.result) return [];
  if (!approve) return [{ text: '계획에서 무엇을 바꾸면 좋을까요?', kind: 'ask' }];
  const starts = await options.dispatcher.startReady(proposalId);
  const posts: PmPost[] = [...starts.notices, ...starts.failures].map(text => ({ text, kind: 'ask' }));
  for (const [i, post] of posts.entries()) await options.store.append(planningNotice(options.context, `start:${proposalId}:${i}`, memberId, post.text));
  return posts;
}
