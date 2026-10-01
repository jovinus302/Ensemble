import { afterEach, expect, it, vi } from 'vitest';
import { MemoryLedgerStore } from '@ensemble/store';
import { DEFAULT_PM_MAY_APPLY, project, taskActivity } from '@ensemble/core';
import type { AnyEvent, EventPayloads, EventType, LedgerEvent, PlanOp, TaskSpec } from '@ensemble/core';
import type { LlmProvider, LlmRequest, LlmResponse } from '@ensemble/llm';
import type { ContinueTaskInput, SessionConnector, SessionEvent, TaskInstructionsInput, UpdateInstructionsInput } from '@ensemble/agents';
import { Coordinator, specChangeLines } from '../src/coordination.ts';
import type { CoordinationInterpretation, CoordinationJudgement } from '../src/coordination.ts';
import { ProjectManager } from '../src/pm.ts';

// QA fixes on the coordinator: agents get readable change lines (never a serialized spec), the conversation that
// changed work joins its context, a turn that put a card in front of someone is recorded as speaking to them, and a
// change asked for on finished agent work becomes follow-up work.
const ctx = { projectId: 'qa', targetProductId: 'product', clock: () => new Date('2026-10-01T00:00:00Z') };
const spec = (id: string, assignee: string, dependsOn: string[] = []): TaskSpec => ({ id, title: id === 'prototype' ? '클릭 가능한 프로토타입' : id, baseTitle: id === 'prototype' ? '클릭 가능한 프로토타입' : id, assignee, dependsOn, handoffConditions: [`${id} 결과`], exclusions: [], limits: [] });
const plan = [spec('research', 'research-agent'), spec('flow', 'designer', ['research']), spec('prototype', 'prototype-agent', ['flow'])];
const interpret = (ops: unknown[]): CoordinationInterpretation => ({ category: 'work', summary: '요청', ops: ops as PlanOp[], conflicts: [], conversation: { questionMessageId: null, waitingOnMemberIds: [], directedToPm: false }, factMentions: [] });
const judge = (patch: Partial<CoordinationJudgement> = {}): CoordinationJudgement => ({ whoseAction: null, alreadyKnows: 'yes', evidence: [], decision: 'silent', reason: '작업 기록과 카드로 충분해 따로 말하지 않는다', openTopics: [], text: '', targetMemberIds: [], changesOpenQuestionAnswer: false, answerFactIds: [], ...patch });
const JSONISH = /\{"|"\w+":/;

/** Answers each structured tool from a table, so a test does not depend on the call order. */
function scripted(answers: Record<string, unknown>) {
  const calls: LlmRequest[] = [];
  const llm: LlmProvider = { async complete(request): Promise<LlmResponse> {
    calls.push(request);
    const input = answers[request.forceTool!];
    return { text: '', toolCalls: input ? [{ name: request.forceTool!, input: input as Record<string, unknown> }] : [], model: 'fake', responseId: `r${calls.length}`, usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  return { llm, calls };
}
type Add = <K extends EventType>(type: K, payload: EventPayloads[K], actor?: LedgerEvent['actor']) => Promise<unknown>;
async function ledger(prototype: 'running' | 'checked' | 'waiting') {
  const store = new MemoryLedgerStore();
  const add: Add = async (type, payload, actor = { kind: 'human', id: 'owner' }) => store.append([{ projectId: ctx.projectId, targetProductId: ctx.targetProductId, actor, type, payload }]);
  await add('member_joined', { memberId: 'owner', kind: 'human', displayName: '사용자' });
  await add('member_joined', { memberId: 'designer', kind: 'human', displayName: '디자이너' });
  await add('member_joined', { memberId: 'research-agent', kind: 'agent', displayName: '조사 Agent', role: 'research' });
  await add('member_joined', { memberId: 'prototype-agent', kind: 'agent', displayName: '프로토타입 Agent', role: 'build' });
  await add('goal_set', { text: '예약 서비스 시제품', deadline: '2026-10-20T00:00:00Z', decider: 'owner', delegation: { pmMayApply: [...DEFAULT_PM_MAY_APPLY] } });
  await add('message_recorded', { messageId: 'goal', authorId: 'owner', text: '예약 서비스 시제품', attachmentIds: [] });
  await add('plan_committed', { version: 1, basedOn: null, tasks: plan, reason: '초기 합의', approvedBy: 'owner', sourceMessageIds: ['goal'] });
  for (const t of plan) await add('task_meta_set', { taskId: t.id, brief: { why: `${t.id}가 목표에 필요해요`, sourceMessageIds: ['goal'], decisionIds: [], attachmentIds: [], constraints: [] } }, { kind: 'system', id: 'pm' });
  if (prototype !== 'waiting') {
    for (const id of ['research', 'flow']) {
      await add('task_started', { taskId: id });
      await add('result_submitted', { taskId: id, resultId: `${id}-r`, planVersion: 1, summary: '완료', artifactIds: [] });
      await add('task_checked', { taskId: id, resultId: `${id}-r`, reason: '충족' });
    }
    await add('task_start_reserved', { taskId: 'prototype', specVersion: 1, trigger: 'flow-r' }, { kind: 'pm', id: 'pm' });
    await add('task_started', { taskId: 'prototype', turnId: 'turn-1' }, { kind: 'agent', id: 'prototype-agent' });
  }
  if (prototype === 'checked') {
    await add('result_submitted', { taskId: 'prototype', resultId: 'proto-r', planVersion: 1, summary: '완료', artifactIds: [] }, { kind: 'agent', id: 'prototype-agent' });
    await add('turn_observed', { agentId: 'prototype-agent', taskId: 'prototype', turnId: 'turn-1', status: 'completed' }, { kind: 'agent', id: 'prototype-agent' });
    await add('task_checked', { taskId: 'prototype', resultId: 'proto-r', reason: '충족' }, { kind: 'pm', id: 'pm' });
  }
  const read = async () => await store.read() as AnyEvent[];
  const of = <K extends EventType>(events: AnyEvent[], type: K) => events.filter((e): e is Extract<AnyEvent, { type: K }> => e.type === type);
  return { store, add, read, of };
}

it('a scope change reaches the running agent as readable lines, and the conversation joins the work\'s context and activity', async () => {
  const f = await ledger('running');
  expect(project(await f.read()).activeTurn.get('prototype-agent')).toBe('prototype');
  await f.add('message_recorded', { messageId: 'm-designer', authorId: 'designer', text: '결제 쪽은 아직 애매해서 빼면 좋겠어요', attachmentIds: [] }, { kind: 'human', id: 'designer' });
  await f.add('message_recorded', { messageId: 'm1', authorId: 'owner', text: 'ㅇㅋ 결제는 이번엔 빼자', attachmentIds: [] });
  const { llm } = scripted({ interpret_coordination: interpret([{ type: 'exclude_scope', taskId: 'prototype', item: '결제', sourceMessageIds: ['m-designer', 'm1'] }]), judge_coordination: judge() });
  const connector = { sendUpdate: vi.fn(async (_agentId: string, _input: UpdateInstructionsInput) => ({ sent: true as const })) };
  await new Coordinator(f.store, llm, connector, ctx).onMessage('m1');

  expect(connector.sendUpdate).toHaveBeenCalledTimes(1);
  const update = connector.sendUpdate.mock.calls[0]![1];
  expect(update.change).toEqual(['범위에서 제외: 결제']);
  expect(update.drop).toEqual(['결제']);
  for (const line of [...update.change, update.reason]) expect(line).not.toMatch(JSONISH);
  const events = await f.read();
  const state = project(events);
  // Context: the sources, the recorded decision and the settled scope join the work's brief (no spec version moves for it).
  const decision = f.of(events, 'decision_recorded').at(-1)!.payload.decisionId;
  expect(state.tasks.get('prototype')!.meta?.brief).toMatchObject({ why: 'prototype가 목표에 필요해요', sourceMessageIds: ['goal', 'm-designer', 'm1'], decisionIds: [decision], constraints: ['결제 제외'] });
  // Activity: the change links to the conversation that made it.
  expect(taskActivity(events, 'prototype').filter(a => a.kind === 'changed' && a.event === 'plan_committed').at(-1)).toMatchObject({ source: { sourceMessageIds: ['m-designer', 'm1'] } });
});

it('describes a task change in words, field by field', () => {
  const state = { tasks: new Map([['flow', { spec: { title: '사용 흐름 설계' } }]]), members: new Map([['designer', { displayName: '디자이너' }]]) } as unknown as Parameters<typeof specChangeLines>[2];
  const prev = spec('prototype', 'prototype-agent', ['flow']);
  expect(specChangeLines(prev, { ...prev, title: '클릭 가능한 프로토타입 (결제 제외, 가입·예약까지)', exclusions: ['결제'], limits: ['가입', '예약'], handoffConditions: ['가입 화면', '초안 단계에서 인계 가능'] }, state))
    .toEqual(['범위에서 제외: 결제', '범위 한정: 가입 · 예약까지만', '인계 조건: 가입 화면; 초안 단계에서 인계 가능']);
  expect(specChangeLines(prev, { ...prev, assignee: 'designer', dependsOn: [] }, state)).toEqual(['선행 작업 없음', '담당: 디자이너']);
  expect(specChangeLines({ ...prev, dependsOn: [] }, prev, state)).toEqual(['선행 작업: "사용 흐름 설계"']);
  for (const line of specChangeLines(prev, { ...prev, exclusions: ['결제'] }, state)) expect(line).not.toMatch(JSONISH);
});

it('a turn that puts a card in front of the decider is recorded as speaking to them, not as silence', async () => {
  const f = await ledger('waiting');
  await f.add('message_recorded', { messageId: 'm1', authorId: 'designer', text: '로그인 화면도 만들어 줘', attachmentIds: [] }, { kind: 'human', id: 'designer' });
  const draft = { type: 'create_task', sourceMessageIds: ['m1'], tempId: 'login', title: '로그인 화면', assignee: 'prototype-agent', handoffConditions: ['로그인 화면 시안'], dependsOn: [], priority: 'normal',
    routing: { executor: 'agent', reason: 'agent_capable', note: '구현은 Agent가 할 수 있어요' }, brief: { why: '가입 흐름에 필요해요', decisionIds: [], attachmentIds: [], constraints: [] } };
  const { llm } = scripted({ interpret_coordination: interpret([draft]), judge_coordination: judge() });
  await new Coordinator(f.store, llm, { sendUpdate: vi.fn() }, ctx).onMessage('m1');
  const events = await f.read();
  const request = f.of(events, 'decision_requested').at(-1)!;
  const record = f.of(events, 'pm_considered').find(e => e.payload.triggerId === 'm1')!;
  expect(record.payload).toMatchObject({ decision: 'speak', alreadyKnows: 'no', whoseAction: 'owner: 결정 카드에 답하기' });
  expect(record.payload.evidence).toEqual(expect.arrayContaining(['msg:m1', request.payload.requestId]));
  expect(f.of(events, 'pm_spoke').some(e => e.payload.considerationId === record.payload.considerationId && e.payload.requestId === request.payload.requestId)).toBe(true);
});

it.each([
  ['the decider', 'owner', true],
  ['someone else', 'designer', false],
] as const)('a change asked for in the thread of finished agent work becomes follow-up work, not a reopened result (%s)', async (_who, authorId, applies) => {
  const f = await ledger('checked');
  await f.add('message_recorded', { messageId: 'm1', authorId, text: '캘린더에 추가 버튼도 넣어 주세요', threadId: 'task:prototype', attachmentIds: [] }, { kind: 'human', id: authorId });
  // The model reads it as reopening the checked result; code turns that into follow-up work for the same agent.
  const { llm } = scripted({ interpret_coordination: interpret([{ type: 'reopen_task', taskId: 'prototype', reason: '캘린더에 추가 버튼도 넣어 주세요', sourceMessageIds: ['m1'] }]), judge_coordination: judge() });
  const result = await new Coordinator(f.store, llm, { sendUpdate: vi.fn() }, ctx).onMessage('m1');
  const events = await f.read();
  const state = project(events);
  expect(result.reopens ?? []).toEqual([]);
  expect(f.of(events, 'revision_requested')).toEqual([]);
  expect(state.tasks.get('prototype')!.status).toBe('checked');
  if (applies) {
    const followUp = state.plan!.tasks.find(t => t.id === 'follow-up-1')!;
    expect(followUp).toMatchObject({ title: '클릭 가능한 프로토타입 보완', assignee: 'prototype-agent', dependsOn: ['prototype'], handoffConditions: ['캘린더에 추가 버튼도 넣어 주세요'] });
    expect(state.tasks.get('follow-up-1')!.meta).toMatchObject({ origin: { createdBy: 'owner', sourceMessageIds: ['m1'] }, brief: { sourceMessageIds: ['m1'] }, routing: { executor: 'agent' } });
    expect(result.starts).toEqual(['follow-up-1']);
  } else {
    expect(state.plan!.version).toBe(1);
    const request = f.of(events, 'decision_requested').at(-1)!.payload;
    expect(request).toMatchObject({ kind: 'plan_change', targetMemberId: 'owner', recommendation: { optionId: 'apply' } });
    expect(request.recommendation.rationale).toContain('디자이너');
    expect(result.requests).toEqual([request.requestId]);
  }
});

class Sessions implements SessionConnector {
  starts: { agentId: string; input: TaskInstructionsInput }[] = [];
  async startSession(agentId: string) { return { threadId: `thread-${agentId}`, workspace: `/workspace/${agentId}` }; }
  async startTask(agentId: string, input: TaskInstructionsInput) { this.starts.push({ agentId, input }); return `turn-${this.starts.length + 1}`; }
  async sendUpdate(_agentId: string, _input: UpdateInstructionsInput) { return { sent: true as const }; }
  async continueTask(_agentId: string, _input: ContinueTaskInput) { return 'turn-c'; }
  onEvent(_handler: (event: SessionEvent) => void) { return () => undefined; }
  async stop() { /* nothing */ }
}
const stops: (() => Promise<void>)[] = [];
afterEach(async () => { for (const stop of stops.splice(0)) await stop(); });

it('the PM replies in the work thread with what it did about the comment: new follow-up work started, or whom it asked', async () => {
  const f = await ledger('checked');
  let made = 0;
  const followUp = (messageId: string) => ({ type: 'create_task', sourceMessageIds: [messageId], tempId: made++ ? 'mobile-button' : 'calendar-button', title: made > 1 ? '모바일 버튼 키우기' : '캘린더 추가 버튼', assignee: 'prototype-agent', handoffConditions: ['요청한 버튼이 보인다'], dependsOn: ['prototype'], priority: 'normal',
    routing: { executor: 'agent', reason: 'agent_capable', note: '같은 Agent가 이어서 해요' }, brief: { why: '완료된 프로토타입에 남긴 요청', decisionIds: [], attachmentIds: [], constraints: [] } });
  const llm: LlmProvider = { async complete(request) {
    const facts = JSON.parse(request.messages[0]!.content).facts as { messageId: string; messages: { messageId: string; text: string }[] };
    const text = facts.messages.find(m => m.messageId === facts.messageId)?.text ?? '';
    const input = request.forceTool === 'interpret_coordination' ? interpret(/버튼/.test(text) ? [followUp(facts.messageId)] : []) : judge();
    return { text: '', toolCalls: [{ name: request.forceTool!, input: input as unknown as Record<string, unknown> }], model: 'fake', responseId: 'r', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  const sessions = new Sessions();
  const pm = new ProjectManager({ projectId: ctx.projectId, targetProductId: ctx.targetProductId, store: f.store, llm, connector: sessions, model: 'fake' });
  stops.push(() => pm.stop());

  await pm.postComment('prototype', 'owner', '캘린더에 추가 버튼도 넣어 주세요');
  let events = await f.read();
  const reply = f.of(events, 'pm_spoke').filter(e => e.payload.threadId === 'task:prototype');
  expect(reply).toHaveLength(1);
  expect(reply[0]!.payload).toMatchObject({ kind: 'fact', taskIds: ['prototype', 'calendar-button'] });
  expect(reply[0]!.payload.text).toBe('이 댓글 요청을 후속 작업 "캘린더 추가 버튼"으로 만들어 프로토타입 Agent에게 맡겼어요.');
  expect(sessions.starts.map(s => s.input.taskId)).toContain('calendar-button');
  // The reply is part of the finished work's thread (its activity), never the channel.
  expect(taskActivity(events, 'prototype').filter(a => a.kind === 'comment').map(a => a.text)).toContain(reply[0]!.payload.text);

  await pm.postComment('prototype', 'designer', '모바일 버튼도 키워 주세요');
  events = await f.read();
  const second = f.of(events, 'pm_spoke').filter(e => e.payload.threadId === 'task:prototype').at(-1)!;
  expect(second.payload.text).toBe('이 댓글 요청을 반영할지 사용자님께 추천안과 함께 결정을 요청했어요.');
  // A comment that changed nothing gets no reply.
  await pm.postComment('prototype', 'owner', '좋네요');
  expect(f.of(await f.read(), 'pm_spoke').filter(e => e.payload.threadId === 'task:prototype')).toHaveLength(2);
});
