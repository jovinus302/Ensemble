import { expect, it } from 'vitest';
import { project, type NewLedgerEvent } from '@ensemble/core';
import { MemoryLedgerStore } from '@ensemble/store';
import type { LlmProvider, LlmRequest, LlmResponse, ToolCall } from '@ensemble/llm';
import type { SendUpdateResult, TaskInstructionsInput, UpdateInstructionsInput } from '@ensemble/agents';
import { Dispatcher, type TaskStarter } from '../src/dispatch.ts';
import { buildTaskContext } from '../src/context.ts';
import { REVIEW_TOOL, type SubmittedResult } from '../src/handoff.ts';

const ctx = { projectId: 'dispatch-tests', targetProductId: 'product' };
const human = (type: NewLedgerEvent['type'], payload: unknown, id = 'lead'): NewLedgerEvent => ({ ...ctx, type, actor: { kind: 'human', id }, payload });
const agentEvent = (type: NewLedgerEvent['type'], payload: unknown, id: string): NewLedgerEvent => ({ ...ctx, type, actor: { kind: 'agent', id }, payload });

class FakeLlm implements LlmProvider {
  requests: LlmRequest[] = [];
  constructor(private readonly replies: (ToolCall[] | Error)[]) {}
  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    const reply = this.replies.shift() ?? [];
    if (reply instanceof Error) throw reply;
    return { text: '', toolCalls: reply, model: request.model, responseId: `resp-${this.requests.length}`, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
class FakeConnector implements TaskStarter {
  starts: { agentId: string; input: TaskInstructionsInput }[] = [];
  updates: { agentId: string; input: UpdateInstructionsInput }[] = [];
  async startTask(agentId: string, input: TaskInstructionsInput): Promise<string> {
    this.starts.push({ agentId, input: structuredClone(input) });
    return `turn-${this.starts.length}`;
  }
  async sendUpdate(agentId: string, input: UpdateInstructionsInput): Promise<SendUpdateResult> {
    this.updates.push({ agentId, input });
    return { sent: true };
  }
}
const verdict = (conditions: unknown[], decisionConflicts: unknown[] = []): ToolCall[] => [{ name: REVIEW_TOOL, input: { conditions, decisionConflicts } }];
const missingIssue = verdict([{ index: 1, met: false, missing: '문제 ① 가입 단계 이탈을 줄이는 흐름이 없습니다.' }]);
const metIssue = verdict([{ index: 1, met: true, file: 'flow-v2.md', quote: '가입 단계 이탈(문제 ①)을 줄이기 위해' }]);
const files: Record<string, string> = {
  'research.md': '인터뷰 5건 요약',
  'flow-v1.md': '# 흐름 초안\n홈 → 상품 목록 → 상세',
  'flow-v2.md': '# 흐름 초안 v2\n가입 단계 이탈(문제 ①)을 줄이기 위해 소셜 로그인을 첫 화면에 둔다.',
};
const submit = (taskId: string, resultId: string, artifactIds: string[], by: string, planVersion = 1) =>
  agentEvent('result_submitted', { taskId, resultId, planVersion, summary: `${taskId} 결과`, artifactIds }, by);

async function fixture(replies: (ToolCall[] | Error)[], extra: NewLedgerEvent[] = []) {
  const store = new MemoryLedgerStore();
  const llm = new FakeLlm(replies);
  const connector = new FakeConnector();
  const reads: SubmittedResult[] = [];
  const dispatcher = new Dispatcher({ store, connector, llm, model: 'fake-pm', context: ctx,
    readResult: async (result) => { reads.push(result); return Object.fromEntries(result.artifactIds.map((path) => [path, files[path] ?? null])); } });
  await store.append([
    human('member_joined', { memberId: 'lead', kind: 'human', displayName: '리드' }),
    human('member_joined', { memberId: 'designer', kind: 'human', displayName: '디자이너' }),
    human('member_joined', { memberId: 'research', kind: 'agent', displayName: '조사 Agent' }),
    human('member_joined', { memberId: 'proto', kind: 'agent', displayName: '프로토타입 Agent' }),
    human('goal_set', { text: '2주 안에 고객 반응 확인', deadline: '2026-10-12', decider: 'lead', delegation: { pmMayApply: [] } }),
    human('plan_committed', { version: 1, basedOn: null, reason: 'kickoff', approvedBy: 'lead', sourceMessageIds: [], tasks: [
      { id: 'T1', title: '고객 인터뷰 조사', assignee: 'research', dependsOn: [], handoffConditions: [] },
      { id: 'T3', title: '흐름 초안', assignee: 'designer', dependsOn: ['T1'], handoffConditions: ['D1의 문제 ①을 다룬다'] },
      { id: 'T4', title: '프로토타입', assignee: 'proto', dependsOn: ['T1', 'T3'], handoffConditions: ['클릭 가능한 화면'] },
      { id: 'T5', title: '사용성 테스트 준비', assignee: 'lead', dependsOn: ['T3'], handoffConditions: [] },
    ] }),
    human('decision_recorded', { decisionId: 'D1', summary: '문제 ① 가입 단계 이탈, 문제 ② 알림 과다를 우선 다룬다', sourceMessageIds: ['m0'], approvedBy: 'lead', changeKinds: [] }),
    human('decision_recorded', { decisionId: 'D9', summary: '사내 워크숍 일정은 다음 달', sourceMessageIds: ['m9'], approvedBy: 'lead', changeKinds: [] }),
    human('message_recorded', { messageId: 'm1', authorId: 'lead', text: 'T4는 모바일 화면 우선으로 가죠', attachmentIds: [] }),
    human('message_recorded', { messageId: 'm2', authorId: 'designer', text: '점심 뭐 먹을까요', attachmentIds: [] }, 'designer'),
    submit('T1', 'r-t1', ['research.md'], 'research'),
    { ...ctx, type: 'task_checked', actor: { kind: 'pm', id: 'pm' }, payload: { taskId: 'T1', resultId: 'r-t1', reason: 'ok' } },
    ...extra,
  ]);
  return { store, llm, connector, dispatcher, reads };
}
const types = async (store: MemoryLedgerStore, type: string) => (await store.read()).filter((e) => e.type === type);

it('requests a concrete revision for an insufficient draft, then starts T4 exactly once after the fix', async () => {
  const { store, llm, connector, dispatcher } = await fixture([missingIssue, metIssue]);
  await store.append([submit('T3', 'r1', ['flow-v1.md'], 'designer')]);
  const first = await dispatcher.onResultSubmitted('T3', 'r1');
  expect(first).toMatchObject({ kind: 'revision', review: { verdict: 'insufficient', met: [] } });
  expect(first.kind === 'revision' && first.notice).toContain('@디자이너');
  expect((await types(store, 'revision_requested'))[0]?.payload).toMatchObject({ taskId: 'T3', resultId: 'r1', missing: [expect.stringContaining('가입 단계 이탈')] });
  expect(connector.starts).toHaveLength(0);

  await store.append([submit('T3', 'r2', ['flow-v2.md'], 'designer')]);
  // The same result event delivered twice, concurrently and again later.
  const [second, duplicate] = await Promise.all([dispatcher.onResultSubmitted('T3', 'r2'), dispatcher.onResultSubmitted('T3', 'r2')]);
  const late = await dispatcher.onResultSubmitted('T3', 'r2');
  expect(second).toMatchObject({ kind: 'checked', review: { verdict: 'sufficient', met: ['D1의 문제 ①을 다룬다'] } });
  expect(duplicate.kind).toBe('skipped');
  expect(late.kind).toBe('skipped');
  expect(llm.requests).toHaveLength(2);
  expect(llm.requests[1]?.messages[0]?.content).toContain('taskId: T3 · resultId: r2 · planVersion: 1');
  expect(llm.requests[1]?.forceTool).toBe(REVIEW_TOOL);

  expect(connector.starts).toHaveLength(1);
  const { agentId, input } = connector.starts[0]!;
  expect(agentId).toBe('proto');
  expect(input).toMatchObject({ taskId: 'T4', planVersion: 1, handoffConditions: [{ text: '클릭 가능한 화면' }] });
  expect(input.decisions).toEqual([{ text: expect.stringContaining('문제 ①'), sourceId: 'D1' }]);
  expect(input.inputs).toEqual(expect.arrayContaining([
    { text: expect.stringContaining('T1'), sourceId: 'r-t1' },
    { text: expect.stringContaining('research.md'), sourceId: 'r-t1:research.md' },
    { text: expect.stringContaining('flow-v2.md'), sourceId: 'r2:flow-v2.md' },
    { text: expect.stringContaining('모바일'), sourceId: 'm1' },
  ]));
  expect(JSON.stringify(input)).not.toContain('점심');
  expect(JSON.stringify(input)).not.toContain('flow-v1.md');

  expect(second.kind === 'checked' && second.notices).toEqual([expect.stringMatching(/^@리드 T5 /)]);
  expect(second.kind === 'checked' && second.started).toEqual([{ taskId: 'T4', agentId: 'proto', turnId: 'turn-1' }]);
  const events = await store.read();
  expect(events.filter((e) => e.type === 'handoff_reviewed')).toHaveLength(2);
  expect(events.filter((e) => e.type === 'task_checked' && (e.payload as { taskId: string }).taskId === 'T3')).toHaveLength(1);
  expect(events.filter((e) => e.type === 'task_start_reserved')).toHaveLength(2);
  expect(events.filter((e) => e.type === 'task_started')).toHaveLength(1);
  expect(project(events).tasks.get('T4')?.status).toBe('running');
});

it('rejects a stale result without calling the model', async () => {
  const { store, llm, dispatcher } = await fixture([metIssue]);
  await store.append([
    submit('T3', 'r1', ['flow-v2.md'], 'designer'),
    human('plan_committed', { version: 2, basedOn: 1, reason: 'scope', approvedBy: 'lead', sourceMessageIds: [], tasks: [
      { id: 'T1', title: '고객 인터뷰 조사', assignee: 'research', dependsOn: [], handoffConditions: [] },
      { id: 'T3', title: '흐름 초안', assignee: 'designer', dependsOn: ['T1'], handoffConditions: ['D1의 문제 ①을 다룬다', '결제 제외'] },
    ] }),
  ]);
  const outcome = await dispatcher.onResultSubmitted('T3', 'r1');
  expect(outcome).toMatchObject({ kind: 'revision', review: { missing: [expect.stringContaining('Stale result r1')] } });
  expect(llm.requests).toHaveLength(0);
});

it('rejects a result submitted before a plan update was confirmed, without calling the model', async () => {
  const { store, llm, connector, dispatcher } = await fixture([metIssue]);
  await store.append([
    agentEvent('update_sent', { updateId: 'u1', taskId: 'T3', fromVersion: 1, toVersion: 1 }, 'designer'),
    submit('T3', 'r1', ['flow-v2.md'], 'designer'),
  ]);
  const outcome = await dispatcher.onResultSubmitted('T3', 'r1');
  expect(outcome).toMatchObject({ kind: 'revision', review: { missing: [expect.stringContaining('not yet acknowledged')] } });
  expect(llm.requests).toHaveLength(0);
  expect(connector.starts).toHaveLength(0);
});

it('reports an error to a person after one retry when the model returns nothing, and records no verdict', async () => {
  const { store, llm, connector, dispatcher } = await fixture([[], []]);
  await store.append([submit('T3', 'r1', ['flow-v2.md'], 'designer')]);
  const outcome = await dispatcher.onResultSubmitted('T3', 'r1');
  expect(outcome).toMatchObject({ kind: 'error', message: expect.stringContaining('비어 있음') });
  expect(llm.requests).toHaveLength(2);
  expect(await types(store, 'handoff_reviewed')).toHaveLength(0);
  expect(await types(store, 'revision_requested')).toHaveLength(0);
  expect(connector.starts).toHaveLength(0);
});

it('stops at the automation cap: no start, one limit event and notice', async () => {
  const changes = Array.from({ length: 12 }, (_, i): NewLedgerEvent => ({ ...ctx, type: 'change_notified', actor: { kind: 'pm', id: 'pm' },
    payload: { changeId: `c${i}`, planVersion: 1, recipientId: 'designer', text: `변경 ${i}`, via: 'channel' } }));
  const { store, connector, dispatcher } = await fixture([metIssue], changes);
  await store.append([submit('T3', 'r1', ['flow-v2.md'], 'designer')]);
  const outcome = await dispatcher.onResultSubmitted('T3', 'r1');
  expect(outcome).toMatchObject({ kind: 'checked', started: [], notices: [], limitNotice: expect.stringContaining('상한') });
  expect(connector.starts).toHaveLength(0);
  expect(await types(store, 'task_start_reserved')).toHaveLength(0);
  expect(await types(store, 'action_limit_reached')).toHaveLength(1);
  expect(project(await store.read()).tasks.get('T4')?.status).toBe('ready');
});

it('relays agent questions to a person and routes answers by steering or into the next turn', async () => {
  const { store, connector, dispatcher } = await fixture([metIssue]);
  await store.append([submit('T3', 'r1', ['flow-v2.md'], 'designer')]);
  await dispatcher.onResultSubmitted('T3', 'r1');
  expect(project(await store.read()).activeTurn.get('proto')).toBe('T4');

  const asked = await dispatcher.onQuestion('T4', '태블릿도 지원할까요?', { choices: ['모바일만', '둘 다'] });
  expect(asked).toMatchObject({ questionId: 'question:T4:1', to: 'lead' });
  expect(asked.text).toMatch(/^@리드 T4 "프로토타입" 담당 프로토타입 Agent의 질문입니다: 태블릿도 지원할까요\? \(선택지: 모바일만 \/ 둘 다\)$/);
  expect(await types(store, 'pm_considered')).toHaveLength(1);
  expect(buildTaskContext(project(await store.read()), 'T4', await store.read()).openQuestions).toEqual([{ text: asked.text, sourceId: 'question:T4:1' }]);

  expect(await dispatcher.onAnswer('T4', '모바일만 합니다')).toEqual({ via: 'steer', questionId: 'question:T4:1' });
  expect(connector.updates).toEqual([{ agentId: 'proto', input: expect.objectContaining({ updateId: 'answer:question:T4:1', change: [expect.stringContaining('모바일만 합니다')] }) }]);

  // The turn ends; the next answer waits for the next turn input.
  await store.append([agentEvent('turn_observed', { agentId: 'proto', taskId: 'T4', turnId: 'turn-1', status: 'completed' }, 'proto')]);
  await dispatcher.onQuestion('T4', '색상은?');
  expect(await dispatcher.onAnswer('T4', '브랜드 파란색')).toEqual({ via: 'next_turn', questionId: 'question:T4:2' });
  expect(connector.updates).toHaveLength(1);
  const events = await store.read();
  const next = buildTaskContext(project(events), 'T4', events);
  expect(next.openQuestions).toEqual([]);
  expect(next.inputs).toContainEqual({ text: '[대화] 답변: 브랜드 파란색', sourceId: 'answer:question:T4:2' });
  expect(events.filter((e) => e.type === 'change_notified').map((e) => (e.payload as { via: string }).via)).toEqual(['steer', 'next_turn']);
});
