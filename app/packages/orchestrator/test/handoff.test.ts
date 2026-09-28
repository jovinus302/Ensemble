import { expect, it } from 'vitest';
import { project, type LedgerEvent } from '@ensemble/core';
import type { LlmProvider, LlmRequest, LlmResponse, ToolCall } from '@ensemble/llm';
import { handoffEvents, judgeHandoff, REVIEW_TOOL, type Decision, type SubmittedResult } from '../src/handoff.ts';

const ctx = { projectId: 'handoff-tests', targetProductId: 'product' };
let seq = 0;
const ev = (type: string, payload: unknown, kind: 'human' | 'agent' | 'pm' = 'human'): LedgerEvent =>
  ({ ...ctx, id: `e${++seq}`, seq, at: '', type, actor: { kind, id: kind }, payload });
const result: SubmittedResult = { taskId: 'T3', resultId: 'r1', planVersion: 1, summary: '흐름 초안', artifactIds: ['flow.md'] };
const decisions: Decision[] = [{ decisionId: 'D2', summary: '결제는 제외', sourceMessageIds: [], approvedBy: 'lead', changeKinds: ['scope_reduce'] }];
const content = { 'flow.md': '# 흐름\n가입 단계 이탈(문제 ①)을\n  줄이기 위해 소셜 로그인을 둔다.\n결제 화면을 추가한다.' };

function state(extra: LedgerEvent[] = []) {
  return project([
    ev('member_joined', { memberId: 'designer', kind: 'human', displayName: '디자이너' }),
    ev('plan_committed', { version: 1, basedOn: null, reason: 'r', approvedBy: 'lead', sourceMessageIds: [], tasks: [
      { id: 'T3', title: '흐름 초안', assignee: 'designer', dependsOn: [], handoffConditions: ['D1의 문제 ①을 다룬다', '화면 목록이 있다'] }] }),
    ev('result_submitted', result, 'agent'),
    ...extra,
  ]);
}
class FakeLlm implements LlmProvider {
  requests: LlmRequest[] = [];
  constructor(private readonly replies: (ToolCall[] | Error)[]) {}
  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    const reply = this.replies.shift() ?? [];
    if (reply instanceof Error) throw reply;
    return { text: '', toolCalls: reply, model: request.model, responseId: 'r', usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
const call = (input: Record<string, unknown>): ToolCall[] => [{ name: REVIEW_TOOL, input }];
const judge = (llm: FakeLlm, s = state(), resultContent: Record<string, string | null> = content) =>
  judgeHandoff({ state: s, result, resultContent, decisions, llm, model: 'fake-pm' });

it('checks structure in code first: missing file, stale result and unconfirmed update skip the model', async () => {
  const llm = new FakeLlm([]);
  expect(await judge(llm, state(), { 'flow.md': null })).toMatchObject({ ok: true, llmCalls: 0, review: { verdict: 'insufficient', missing: [expect.stringContaining('flow.md')] } });
  const stale = state([ev('plan_committed', { version: 2, basedOn: 1, reason: 'r', approvedBy: 'lead', sourceMessageIds: [], tasks: [
    { id: 'T3', title: '흐름 초안 v2', assignee: 'designer', dependsOn: [], handoffConditions: [] }] })]);
  expect(await judge(llm, stale)).toMatchObject({ ok: true, review: { verdict: 'insufficient', missing: [expect.stringContaining('Stale result')] } });
  const pending = state([ev('update_sent', { updateId: 'u1', taskId: 'T3', fromVersion: 1, toVersion: 1 }, 'agent')]);
  expect(await judge(llm, pending)).toMatchObject({ ok: true, review: { verdict: 'insufficient', missing: [expect.stringContaining('not yet acknowledged')] } });
  expect(llm.requests).toHaveLength(0);
});

it('counts a condition as met only when the quoted evidence is really in the result', async () => {
  const llm = new FakeLlm([call({ conditions: [
    { index: 1, met: true, file: 'flow.md', quote: '가입 단계 이탈(문제 ①)을 줄이기 위해' },
    { index: 2, met: true, file: 'flow.md', quote: '화면 목록: 홈, 가입' },
  ], decisionConflicts: [{ decisionId: 'D2', detail: '결제 화면이 들어 있음' }, { decisionId: 'D404', detail: '모르는 결정' }] })]);
  const outcome = await judge(llm);
  expect(outcome).toMatchObject({ ok: true, llmCalls: 1, review: {
    verdict: 'insufficient', met: ['D1의 문제 ①을 다룬다'], evidence: [expect.stringContaining('flow.md')],
    missing: [expect.stringContaining('"화면 목록이 있다"의 근거를 결과에서 확인하지 못했습니다'), expect.stringContaining('확정 결정 D2')] } });
  expect(outcome.ok && outcome.review.missing).toHaveLength(2);
  const request = llm.requests[0]!;
  expect(request).toMatchObject({ model: 'fake-pm', forceTool: REVIEW_TOOL, tools: [expect.objectContaining({ name: REVIEW_TOOL })] });
  expect(request.messages[0]!.content).toContain('taskId: T3 · resultId: r1 · planVersion: 1');
  expect(request.messages[0]!.content).toContain('D2: 결제는 제외');
});

it('treats conditions the model skipped as missing, with the model reason when it gave one', async () => {
  const llm = new FakeLlm([call({ conditions: [{ index: 1, met: false, missing: '문제 ①의 흐름이 없습니다.' }], decisionConflicts: [] })]);
  const outcome = await judge(llm);
  expect(outcome.ok && outcome.review.missing).toEqual([
    '인계 조건 "D1의 문제 ①을 다룬다"이(가) 충족되지 않았습니다. 문제 ①의 흐름이 없습니다.',
    expect.stringContaining('인계 조건 "화면 목록이 있다"이(가) 충족되지 않았습니다.'),
  ]);
});

it('retries once on an empty or malformed reply and returns an error, not a verdict, if both fail', async () => {
  const good = call({ conditions: [
    { index: 1, met: true, file: 'flow.md', quote: '소셜 로그인을 둔다' }, { index: 2, met: true, file: 'flow.md', quote: '# 흐름' }], decisionConflicts: [] });
  const recovered = new FakeLlm([call({ conditions: 'oops' }), good]);
  expect(await judgeHandoff({ state: state(), result, resultContent: content, decisions: [], llm: recovered, model: 'm' }))
    .toMatchObject({ ok: true, llmCalls: 2, review: { verdict: 'sufficient' } });
  const empty = new FakeLlm([[], []]);
  expect(await judge(empty)).toMatchObject({ ok: false, llmCalls: 2, error: expect.stringContaining('비어 있음') });
  const failing = new FakeLlm([new Error('proxy 502'), new Error('proxy 502')]);
  expect(await judge(failing)).toMatchObject({ ok: false, error: expect.stringContaining('proxy 502') });
});

it('turns a verdict into handoff_reviewed plus task_checked or revision_requested', () => {
  const s = state();
  const base = { taskId: 'T3', resultId: 'r1', evidence: [] };
  expect(handoffEvents(s, { ...base, verdict: 'sufficient', met: ['a'], missing: [] }, ctx).map((e) => [e.type, e.idempotencyKey]))
    .toEqual([['handoff_reviewed', 'handoff:r1'], ['task_checked', 'checked:r1']]);
  const revision = handoffEvents(s, { ...base, verdict: 'insufficient', met: [], missing: ['보완할 점'] }, ctx);
  expect(revision.map((e) => e.type)).toEqual(['handoff_reviewed', 'revision_requested']);
  expect(revision[1]!.payload).toMatchObject({ missing: ['보완할 점'] });
});
