import { expect, it, vi } from 'vitest';
import { MemoryLedgerStore } from '@ensemble/store';
import { DEFAULT_PM_MAY_APPLY, project } from '@ensemble/core';
import type { AnyEvent, EventPayloads, EventType, PlanOp, TaskSpec } from '@ensemble/core';
import type { LlmProvider, LlmRequest, LlmResponse } from '@ensemble/llm';
import { strictSchema, dropStrictNulls } from '@ensemble/llm';
import type { UpdateInstructionsInput } from '@ensemble/agents';
import { Coordinator, MAX_TASKS_PER_MESSAGE } from '../src/coordination.ts';
import type { CoordinationInterpretation, CoordinationJudgement } from '../src/coordination.ts';

// MC1: conversation → work items. The LLM is a scripted fixture; authority, routing and recording are code.
const ctx = { projectId: 'work', targetProductId: 'product', clock: () => new Date('2026-10-01T00:00:00Z') };
const spec = (id: string, assignee: string, dependsOn: string[] = []): TaskSpec => ({ id, title: id, baseTitle: id, assignee, dependsOn, handoffConditions: [`${id} 결과`], exclusions: [], limits: [] });
const plan = [spec('research', 'research-agent'), spec('flow', 'designer', ['research']), spec('prototype', 'prototype-agent', ['flow'])];
const interpret = (ops: unknown[], patch: Partial<CoordinationInterpretation> = {}): CoordinationInterpretation => ({ category: 'work', summary: '작업 요청', ops: ops as PlanOp[], conflicts: [], conversation: { questionMessageId: null, waitingOnMemberIds: [], directedToPm: false }, factMentions: [], ...patch });
const judge = (patch: Partial<CoordinationJudgement> = {}): CoordinationJudgement => ({ whoseAction: null, alreadyKnows: 'no', evidence: ['forecast:current'], decision: 'silent', reason: '작업 연산으로 반영', openTopics: [], text: '', targetMemberIds: [], changesOpenQuestionAnswer: false, answerFactIds: [], ...patch });
/** What the model drafts: routing is a proposal and the brief has no source ids yet. */
const draft = (tempId: string, patch: Record<string, unknown> = {}) => ({
  tempId, title: tempId === 'login' ? '로그인 화면' : `${tempId} 작업`, assignee: 'prototype-agent', handoffConditions: [`${tempId} 화면 시안`], dependsOn: [], priority: 'normal',
  routing: { executor: 'agent', reason: 'agent_capable', note: '화면 구현은 Agent가 할 수 있어요' },
  brief: { why: '가입 흐름을 마치려면 로그인 화면이 필요해요', decisionIds: [], attachmentIds: [], constraints: ['이메일 로그인만'] }, ...patch,
});
const create = (tempId: string, patch: Record<string, unknown> = {}, sourceMessageIds = ['m1']) => ({ type: 'create_task', ...draft(tempId, patch), sourceMessageIds });

function fake(responses: (object | null | ((r: LlmRequest) => object | null))[]) {
  responses = [...responses];
  const calls: LlmRequest[] = [];
  const llm: LlmProvider = { async complete(request): Promise<LlmResponse> {
    calls.push(request);
    const next = responses.shift();
    const input = typeof next === 'function' ? next(request) : next;
    return { text: '', toolCalls: input ? [{ name: request.forceTool!, input: input as Record<string, unknown> }] : [], model: 'fake', responseId: `r${calls.length}`, usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  return { llm, calls };
}
async function fixture(responses: Parameters<typeof fake>[0], text = '로그인 화면도 만들어 줘', authorId = 'owner', attachmentIds: string[] = []) {
  const store = new MemoryLedgerStore();
  const add = async <K extends EventType>(type: K, payload: EventPayloads[K]) => store.append([{ projectId: ctx.projectId, targetProductId: ctx.targetProductId, actor: { kind: 'human', id: 'owner' }, type, payload }]);
  await add('member_joined', { memberId: 'owner', kind: 'human', displayName: '대표' });
  await add('member_joined', { memberId: 'designer', kind: 'human', displayName: '디자이너' });
  await add('member_joined', { memberId: 'research-agent', kind: 'agent', displayName: '조사 Agent', role: 'research' });
  await add('member_joined', { memberId: 'prototype-agent', kind: 'agent', displayName: '프로토타입 Agent', role: 'build' });
  await add('goal_set', { text: '예약 서비스 시제품', deadline: '2026-10-20T00:00:00Z', decider: 'owner', delegation: { pmMayApply: [...DEFAULT_PM_MAY_APPLY] } });
  await add('plan_committed', { version: 1, basedOn: null, tasks: plan, reason: '초기 합의', approvedBy: 'owner', sourceMessageIds: [] });
  for (const t of plan) await add('estimate_updated', { taskId: t.id, hours: { min: 4, max: 6 }, source: 'human' });
  for (const id of ['owner', 'designer']) await add('availability_updated', { memberId: id, weeklyHours: 10 });
  for (const id of attachmentIds) await add('attachment_recorded', { attachmentId: id, name: `${id}.png`, mimeType: 'image/png', uri: `mem://${id}` });
  await add('message_recorded', { messageId: 'm1', authorId, text, attachmentIds });
  const { llm, calls } = fake(responses);
  const connector = { sendUpdate: vi.fn(async (_agentId: string, _input: UpdateInstructionsInput) => ({ sent: true as boolean, reason: 'finished' })) };
  const coordinator = new Coordinator(store, llm, connector, ctx);
  const read = async () => await store.read() as AnyEvent[];
  const of = <K extends EventType>(events: AnyEvent[], type: K) => events.filter((e): e is Extract<AnyEvent, { type: K }> => e.type === type);
  return { store, add, calls, connector, coordinator, read, of };
}

it('(1) the decider asks for new work: plan v+1, meta harvested from the conversation, start reserved', async () => {
  const f = await fixture([interpret([create('login', { brief: { ...draft('login').brief, attachmentIds: [] } })]), judge()], '로그인 화면도 만들어 줘', 'owner', ['a1']);
  const result = await f.coordinator.onMessage('m1');
  const events = await f.read();
  const committed = f.of(events, 'plan_committed').at(-1)!;
  expect(committed.payload.version).toBe(2);
  expect(committed.payload.tasks.find(t => t.id === 'login')).toMatchObject({ title: '로그인 화면', assignee: 'prototype-agent', dependsOn: [] });
  // Other work keeps its spec: no version bump, no change notice for existing assignees.
  expect(project(events).tasks.get('prototype')!.specVersion).toBe(1);
  expect(f.of(events, 'change_notified')).toHaveLength(0);
  const meta = f.of(events, 'task_meta_set').find(e => e.payload.taskId === 'login')!;
  expect(meta.payload.origin).toEqual({ createdBy: 'owner', planVersion: 2, sourceMessageIds: ['m1'] });
  expect(meta.payload.routing).toEqual({ executor: 'agent', reason: 'agent_capable', note: '화면 구현은 Agent가 할 수 있어요' });
  // The brief carries the producing conversation and its file, collected by code.
  expect(meta.payload.brief).toEqual({ why: '가입 흐름을 마치려면 로그인 화면이 필요해요', sourceMessageIds: ['m1'], decisionIds: [], attachmentIds: ['a1'], constraints: ['이메일 로그인만'] });
  // Structure and metadata are one transaction, followed by the start reservation.
  const seqs = [committed.seq, meta.seq];
  const reserved = f.of(events, 'task_start_reserved').find(e => e.payload.taskId === 'login')!;
  expect(reserved.seq).toBeGreaterThan(Math.max(...seqs));
  expect(reserved.actor.kind).toBe('pm');
  expect(result.starts).toEqual(['login']);
  expect(project(events).tasks.get('login')!.status).toBe('reserved');
  expect(project(events).tasks.get('research')!.status).toBe('ready');
  expect(result.posts.map(p => p.text).join('\n')).toContain('정리하면');
  expect(f.of(events, 'decision_requested')).toHaveLength(0);
});

it('routes agent work to the agent whose role fits, whoever the model proposed', async () => {
  const f = await fixture([interpret([create('login', { assignee: 'research-agent', routing: { executor: 'agent', reason: 'agent_capable', note: '구현' } })]), judge()]);
  // The model named the research agent; the role it needs is its own, so it stays. A role-less proposal falls back to a person.
  await f.coordinator.onMessage('m1');
  expect(project(await f.read()).plan!.tasks.find(t => t.id === 'login')!.assignee).toBe('research-agent');
});

it('(2) a designer asks for the same work: no task, a plan_change request to the decider recommending those ops', async () => {
  const f = await fixture([interpret([create('login')]), judge()], '로그인 화면도 만들어 줘', 'designer');
  const result = await f.coordinator.onMessage('m1');
  const events = await f.read();
  expect(f.of(events, 'plan_committed')).toHaveLength(1);
  expect(f.of(events, 'task_start_reserved')).toHaveLength(0);
  expect(f.of(events, 'authority_requested')).toHaveLength(0);
  const [request] = f.of(events, 'decision_requested');
  expect(request!.payload).toMatchObject({ kind: 'plan_change', targetMemberId: 'owner', recommendation: { optionId: 'apply', evidence: ['m1'] }, impact: { taskIds: ['login'], blockedTaskIds: [] }, sourceMessageIds: ['m1'] });
  const recommended = request!.payload.options.find(o => o.optionId === request!.payload.recommendation.optionId)!;
  expect(recommended.effects).toEqual([{ type: 'plan_ops', ops: [expect.objectContaining({ type: 'create_task', tempId: 'login', assignee: 'prototype-agent', brief: expect.objectContaining({ sourceMessageIds: ['m1'] }) })] }]);
  expect(request!.payload.options.some(o => o.effects.every(e => e.type === 'none'))).toBe(true);
  expect(project(events).decisionRequests.get(request!.payload.requestId)!.status).toBe('open');
  expect(result.requests).toEqual([request!.payload.requestId]);
  const ask = f.of(events, 'pm_spoke').find(e => e.payload.requestId === request!.payload.requestId)!;
  expect(ask.payload.kind).toBe('ask');
  expect(result.posts).toEqual([{ text: ask.payload.text, kind: 'ask' }]);
  expect(ask.payload.text).toContain('대표님');

  // The decider approves on the card: the decision flow passes the recorded ops and the answer message.
  await f.add('message_recorded', { messageId: 'answer', authorId: 'owner', text: '승인', attachmentIds: [] });
  const approved = await f.coordinator.onConfirmedOperations('answer', (recommended.effects[0] as { ops: PlanOp[] }).ops, request!.payload.requestId);
  const after = await f.read();
  expect(f.of(after, 'plan_committed').at(-1)!.payload.tasks.map(t => t.id)).toContain('login');
  expect(f.of(after, 'authority_granted')).toHaveLength(0);
  const meta = f.of(after, 'task_meta_set').find(e => e.payload.taskId === 'login')!;
  expect(meta.payload.origin).toEqual({ createdBy: 'designer', planVersion: 2, sourceMessageIds: ['m1', 'answer'], decisionRequestId: request!.payload.requestId });
  expect(approved.starts).toEqual(['login']);
});

it('refuses a card answer from anyone but the request target', async () => {
  const f = await fixture([interpret([create('login')]), judge()], '로그인 화면도 만들어 줘', 'designer');
  await f.coordinator.onMessage('m1');
  const [request] = f.of(await f.read(), 'decision_requested');
  await f.add('message_recorded', { messageId: 'self', authorId: 'designer', text: '승인', attachmentIds: [] });
  const ops = (request!.payload.options[0]!.effects[0] as { ops: PlanOp[] }).ops;
  await expect(f.coordinator.onConfirmedOperations('self', ops, request!.payload.requestId)).rejects.toThrow();
  expect(f.of(await f.read(), 'plan_committed')).toHaveLength(1);
});

it('(3) existing ops outside authority keep the authority_requested card', async () => {
  const f = await fixture([interpret([{ type: 'exclude_scope', taskId: 'prototype', item: '결제', sourceMessageIds: ['m1'] }]), judge({ decision: 'speak', whoseAction: 'owner', evidence: ['forecast:candidate'], targetMemberIds: ['owner'], text: '대표님 확인이 필요해요.' })], '결제는 빼면 좋겠어요', 'designer');
  const result = await f.coordinator.onMessage('m1');
  const events = await f.read();
  expect(f.of(events, 'authority_requested')).toEqual([expect.objectContaining({ payload: expect.objectContaining({ personId: 'owner', changeKinds: ['scope_reduce'] }) })]);
  expect(f.of(events, 'decision_requested')).toHaveLength(0);
  expect(result.posts.some(p => p.kind === 'ask')).toBe(true);
});

it('(6) more than five new tasks from one message become one bundled request, even from the decider', async () => {
  const ids = Array.from({ length: MAX_TASKS_PER_MESSAGE + 1 }, (_, i) => `screen-${i + 1}`);
  const f = await fixture([interpret(ids.map(id => create(id))), judge()], '화면 여섯 개 다 만들어 줘', 'owner');
  const result = await f.coordinator.onMessage('m1');
  const events = await f.read();
  expect(f.of(events, 'plan_committed')).toHaveLength(1);
  const requests = f.of(events, 'decision_requested');
  expect(requests).toHaveLength(1);
  expect(requests[0]!.payload).toMatchObject({ targetMemberId: 'owner', kind: 'plan_change', impact: { taskIds: ids } });
  expect((requests[0]!.payload.options[0]!.effects[0] as { ops: PlanOp[] }).ops).toHaveLength(6);
  expect(result.posts).toHaveLength(1);
});

it('splits work that has not started without asking (Q1 default) and records each subtask origin', async () => {
  const child = (tempId: string) => ({ ...draft(tempId, { assignee: 'research-agent', routing: { executor: 'agent', reason: 'agent_capable', note: '조사' } }) });
  const f = await fixture([interpret([{ type: 'split_task', taskId: 'research', children: [child('research-market'), child('research-cases')], sourceMessageIds: ['m1'] }]), judge()], '조사를 경쟁사와 사례로 나눠 주세요', 'designer');
  const result = await f.coordinator.onMessage('m1');
  const events = await f.read();
  const state = project(events);
  expect(state.plan!.version).toBe(2);
  expect(state.plan!.tasks.filter(t => t.parentId === 'research').map(t => t.id)).toEqual(['research-market', 'research-cases']);
  expect(f.of(events, 'task_meta_set').map(e => e.payload.origin)).toEqual([
    { createdBy: 'designer', planVersion: 2, sourceMessageIds: ['m1'], splitFrom: 'research' },
    { createdBy: 'designer', planVersion: 2, sourceMessageIds: ['m1'], splitFrom: 'research' },
  ]);
  // One agent, one turn: the first subtask starts, the parent never does.
  expect(result.starts).toEqual(['research-market']);
  expect(state.tasks.get('research')!.status).toBe('waiting');
});

it('records a priority change as metadata only', async () => {
  const f = await fixture([interpret([{ type: 'set_priority', taskId: 'prototype', priority: 'high', sourceMessageIds: ['m1'] }]), judge()], '프로토타입을 먼저 하자', 'owner');
  await f.coordinator.onMessage('m1');
  const events = await f.read();
  expect(f.of(events, 'plan_committed')).toHaveLength(1);
  expect(f.of(events, 'task_meta_set').map(e => e.payload)).toEqual([{ taskId: 'prototype', priority: 'high' }]);
  expect(project(events).tasks.get('prototype')!.meta?.priority).toBe('high');
});

it('cancels work on the decider’s word, and asks the decider when someone else asks', async () => {
  const owner = await fixture([interpret([{ type: 'cancel_task', taskId: 'prototype', reason: '이번엔 하지 않음', sourceMessageIds: ['m1'] }]), judge()], '프로토타입은 이번엔 하지 말자', 'owner');
  await owner.coordinator.onMessage('m1');
  const state = project(await owner.read());
  expect(state.plan!.tasks.map(t => t.id)).toEqual(['research', 'flow']);
  expect(state.tasks.get('prototype')!.status).toBe('cancelled');

  const designer = await fixture([interpret([{ type: 'cancel_task', taskId: 'prototype', reason: '이번엔 하지 않음', sourceMessageIds: ['m1'] }]), judge()], '프로토타입은 빼죠', 'designer');
  await designer.coordinator.onMessage('m1');
  const events = await designer.read();
  expect(designer.of(events, 'plan_committed')).toHaveLength(1);
  expect(designer.of(events, 'decision_requested')[0]!.payload).toMatchObject({ targetMemberId: 'owner', impact: { taskIds: ['prototype'] } });
});

it('asks a person to accept new work routed to them instead of assigning it (Q2)', async () => {
  const f = await fixture([interpret([create('login-design', { assignee: 'designer', routing: { executor: 'human', reason: 'needs_human_judgement', note: '디자인 판단' } })]), judge()]);
  await f.coordinator.onMessage('m1');
  const events = await f.read();
  expect(f.of(events, 'plan_committed')).toHaveLength(1);
  expect(f.of(events, 'decision_requested')[0]!.payload).toMatchObject({ kind: 'assignment', targetMemberId: 'designer' });
});

it('sends invalid drafts back to the model: a used id or an unconfirmed decision', async () => {
  const f = await fixture([
    interpret([create('research', { brief: { ...draft('x').brief, decisionIds: ['nope'] } })]),
    interpret([create('login')]), judge(),
  ]);
  await f.coordinator.onMessage('m1');
  const retry = JSON.parse(f.calls[1]!.messages[0]!.content);
  expect(retry.validationError).toContain('research is already used');
  expect(retry.validationError).toContain('unconfirmed decision nope');
  expect(project(await f.read()).plan!.tasks.map(t => t.id)).toContain('login');
});

it('offers the work ops to the model with the decided enums', async () => {
  const f = await fixture([interpret([]), judge()]);
  await f.coordinator.onMessage('m1');
  const ops = (f.calls[0]!.tools![0]!.inputSchema as { properties: { ops: { items: { oneOf: { properties: { type: { const: string } } }[] } } } }).properties.ops.items.oneOf.map(o => o.properties.type.const);
  expect(ops).toEqual(expect.arrayContaining(['create_task', 'split_task', 'cancel_task', 'set_priority']));
  expect(f.calls[0]!.system).toContain('create_task');
});

it('can request independent new work after all existing tasks are checked, for both provider schema forms', async () => {
  for (const strict of [false, true]) {
    const f = await fixture([request => {
      const schema = request.tools![0]!.inputSchema;
      const operation = create('contact');
      const branches = (schema as any).properties.ops.items.oneOf;
      const createSchema = branches.find((o: any) => o.properties.type.const === 'create_task');
      expect(createSchema.required).not.toContain('parentId');
      if (!strict) return interpret([operation]);
      const normalized = strictSchema(schema);
      const strictCreate = (normalized as any).properties.ops.items.anyOf.find((o: any) => o.properties.type.const === 'create_task');
      expect(strictCreate.properties.parentId.anyOf).toContainEqual({ type: 'null' });
      return dropStrictNulls(interpret([{ ...operation, parentId: null }]), schema) as object;
    }, judge()], 'Add a separate contact page', 'designer');
    for (const task of plan) await f.add('task_checked', { taskId: task.id, resultId: `result-${task.id}`, reason: 'Done' });
    const result = await f.coordinator.onMessage('m1');
    expect(result.requests).toHaveLength(1);
    const state = project(await f.read());
    const request = state.decisionRequests.get(result.requests![0]!)!.request;
    const effects = request.options.flatMap(option => option.effects).filter(effect => effect.type === 'plan_ops');
    expect(effects).toContainEqual(expect.objectContaining({ ops: [expect.objectContaining({ type: 'create_task', tempId: 'contact' })] }));
    expect(JSON.stringify(effects)).not.toContain('parentId');
    expect(f.calls).toHaveLength(2);
  }
});
