import { expect, it } from 'vitest';
import { project, type LedgerEvent } from '@ensemble/core';
import type { LlmProvider, LlmRequest, LlmResponse, ToolCall } from '@ensemble/llm';
import { checkCitation, handoffEvents, judgeHandoff, quoteInText, REVIEW_TOOL, type Decision, type SubmittedResult } from '../src/handoff.ts';

const ctx = { projectId: 'handoff-tests', targetProductId: 'product' };
let seq = 0;
const ev = (type: string, payload: unknown, kind: 'human' | 'agent' | 'pm' = 'human'): LedgerEvent =>
  ({ ...ctx, id: `e${++seq}`, seq, at: '', type, actor: { kind, id: kind }, payload });
const result: SubmittedResult = { taskId: 'T3', resultId: 'r1', planVersion: 1, summary: '흐름 초안', artifactIds: ['flow.md'] };
const decisions: Decision[] = [{ decisionId: 'D2', summary: '결제는 제외', sourceMessageIds: [], approvedBy: 'lead', changeKinds: ['scope_reduce'] }];
const content = { 'flow.md': '# 흐름\n가입 단계 이탈(문제 ①)을\n  줄이기 위해 소셜 로그인을 둔다.\n결제 화면을 추가한다.' };

function state(extra: LedgerEvent[] = [], submitted: SubmittedResult = result) {
  return project([
    ev('member_joined', { memberId: 'designer', kind: 'human', displayName: '디자이너' }),
    ev('plan_committed', { version: 1, basedOn: null, reason: 'r', approvedBy: 'lead', sourceMessageIds: [], tasks: [
      { id: 'T3', title: '흐름 초안', assignee: 'designer', dependsOn: [], handoffConditions: ['D1의 문제 ①을 다룬다', '화면 목록이 있다'] }] }),
    ev('result_submitted', submitted, 'agent'),
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
    missing: [expect.stringContaining('"화면 목록이 있다"의 근거를 결과에서 확인하지 못했습니다'), expect.stringContaining('확정 결정 "결제는 제외"')] } });
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
    '인계 조건 "D1의 문제 ①을 다룬다"가 충족되지 않았습니다. 문제 ①의 흐름이 없습니다.',
    expect.stringContaining('인계 조건 "화면 목록이 있다"가 충족되지 않았습니다.'),
  ]);
});

it('retries once on an empty or malformed reply and returns an error, not a verdict, if both fail', async () => {
  const good = call({ conditions: [
    { index: 1, met: true, file: 'flow.md', quote: '소셜 로그인을 둔다' }, { index: 2, met: true, file: 'flow.md', quote: '# 흐름' }], decisionConflicts: [] });
  const recovered = new FakeLlm([call({ conditions: 'oops' }), good]);
  expect(await judgeHandoff({ state: state(), result, resultContent: content, decisions: [], llm: recovered, model: 'm' }))
    .toMatchObject({ ok: true, llmCalls: 2, review: { verdict: 'sufficient' } });
  const empty = new FakeLlm([[], []]);
  expect(await judge(empty)).toMatchObject({ ok: false, llmCalls: 2, error: expect.stringContaining('판단을 마치지 못했습니다') });
  const failing = new FakeLlm([new Error('proxy 502'), new Error('proxy 502')]);
  expect(await judge(failing)).toMatchObject({ ok: false, error: expect.stringContaining('판단을 마치지 못했습니다') });
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


it('normalizes markdown and whitespace but records original failed citations without semantic relaxation', async () => {
  const llm = new FakeLlm([call({ conditions: [
    { index: 1, met: true, file: 'flow.md', quote: '가입 흐름을 확인한다.' },
    { index: 2, met: true, file: 'flow.md', quote: '**화면 목록** 세 개' },
  ], decisionConflicts: [] })]);
  const outcome = await judge(llm, state(), { 'flow.md': '# 안내\n- **가입**\n 흐름을 확인한다.\n화면 목록이 없다.' });
  expect(outcome).toMatchObject({ ok: true, llmCalls: 1, review: { met: ['D1의 문제 ①을 다룬다'], citationFailures: [{ file: 'flow.md', quote: '**화면 목록** 세 개', reason: '정규화 후에도 인용문이 결과 파일에 없음' }] } });
  const invented = new FakeLlm([call({ conditions: [
    { index: 1, met: true, file: 'flow.md', quote: '화면 목록이 있다.' },
    { index: 2, met: true, file: 'flow.md', quote: '가격 10원' },
  ], decisionConflicts: [] })]);
  const rejected = await judge(invented, state(), { 'flow.md': '화면 목록이 없다. 가격 100원' });
  expect(rejected).toMatchObject({ ok: true, llmCalls: 1, review: { met: [], verdict: 'insufficient', citationFailures: [expect.objectContaining({ quote: '화면 목록이 있다.' }), expect.objectContaining({ quote: '가격 10원' })] } });
});

// R5: the file is identified from the submission when the model leaves it out or names another one.
const twoFiles: SubmittedResult = { ...result, resultId: 'r2', artifactIds: ['notes/interviews.txt', 'notes/summary.md'] };
const twoContents = { 'notes/interviews.txt': '회원 4명 인터뷰\n## 핵심 예약 시나리오 (3화면 이내)', 'notes/summary.md': '요약: 화면 목록은 홈, 예약, 확인' };
const judgeTwo = (llm: FakeLlm) => judgeHandoff({ state: state([], twoFiles), result: twoFiles, resultContent: twoContents, decisions: [], llm, model: 'fake-pm' });

it('resolves an empty file name to the only result file when the quote is in it (QA N6/C7)', async () => {
  const llm = new FakeLlm([call({ conditions: [
    { index: 1, met: true, file: '', quote: '가입 단계 이탈(문제 ①)을 줄이기 위해' },
    { index: 2, met: true, file: '', quote: '# 흐름' },
  ], decisionConflicts: [] })]);
  const outcome = await judgeHandoff({ state: state(), result, resultContent: content, decisions: [], llm, model: 'm' });
  expect(outcome).toMatchObject({ ok: true, llmCalls: 1, review: { verdict: 'sufficient', missing: [], evidence: [expect.stringContaining('← flow.md:'), expect.stringContaining('← flow.md:')] } });
  expect(outcome.ok && outcome.review.citationFailures).toBeUndefined();
});

it('resolves a missing or wrong file name to the one result file that contains the quote', async () => {
  const llm = new FakeLlm([call({ conditions: [
    { index: 1, met: true, file: 'interviews.txt', quote: '핵심 예약 시나리오 (3화면 이내)' },
    { index: 2, met: true, file: 'notes/interviews.txt', quote: '화면 목록은 홈, 예약, 확인' },
  ], decisionConflicts: [] })]);
  const outcome = await judgeTwo(llm);
  expect(outcome).toMatchObject({ ok: true, llmCalls: 1, review: { verdict: 'sufficient', evidence: [
    expect.stringContaining('← notes/interviews.txt:'), expect.stringContaining('← notes/summary.md:')] } });
});

it('re-judges a technical citation failure once and keeps it out of the revision request', async () => {
  const llm = new FakeLlm([
    call({ conditions: [{ index: 1, met: true, file: '', quote: '인터뷰에서 확인한 핵심 시나리오' }, { index: 2, met: true, file: 'notes/summary.md', quote: '화면 목록은 홈, 예약, 확인' }], decisionConflicts: [] }),
    call({ conditions: [{ index: 1, met: true, file: 'notes/interviews.txt', quote: '핵심 예약 시나리오 (3화면 이내)' }], decisionConflicts: [] }),
  ]);
  const outcome = await judgeTwo(llm);
  expect(outcome).toMatchObject({ ok: true, llmCalls: 2, review: { verdict: 'sufficient', missing: [], met: ['D1의 문제 ①을 다룬다', '화면 목록이 있다'],
    citationFailures: [{ condition: 'D1의 문제 ①을 다룬다', file: '', reason: expect.stringMatching(/^기술적 검증 실패\(재판단\): 결과 파일을 지정하지 않았고/) }] } });
  const retry = llm.requests[1]!.messages[0]!.content;
  expect(retry).toContain('인용 확인 실패');
  expect(retry).toContain('1. D1의 문제 ①을 다룬다');
  expect(retry).not.toContain('2. 화면 목록이 있다 —');
});

it('treats an empty quote on a met condition as a technical failure, not missing content', async () => {
  const llm = new FakeLlm([
    call({ conditions: [{ index: 1, met: true, file: 'flow.md', quote: '' }, { index: 2, met: true, file: 'flow.md', quote: '# 흐름' }], decisionConflicts: [] }),
    call({ conditions: [{ index: 1, met: true, file: 'flow.md', quote: '소셜 로그인을 둔다' }], decisionConflicts: [] }),
  ]);
  expect(await judgeHandoff({ state: state(), result, resultContent: content, decisions: [], llm, model: 'm' }))
    .toMatchObject({ ok: true, llmCalls: 2, review: { verdict: 'sufficient', citationFailures: [expect.objectContaining({ reason: '기술적 검증 실패(재판단): 인용문이 비어 있음' })] } });
});

it('sends a persistent technical failure to a person without asking for more content', async () => {
  const unverifiable = { index: 1, met: true, file: '', quote: '어디에도 없는 문장' };
  const llm = new FakeLlm([
    call({ conditions: [unverifiable, { index: 2, met: true, file: 'notes/summary.md', quote: '화면 목록은 홈, 예약, 확인' }], decisionConflicts: [] }),
    call({ conditions: [unverifiable], decisionConflicts: [] }),
  ]);
  const outcome = await judgeTwo(llm);
  expect(outcome).toMatchObject({ ok: false, llmCalls: 2, error: expect.stringContaining('결과 내용의 문제가 아니라'), citationFailures: [
    expect.objectContaining({ reason: expect.stringContaining('기술적 검증 실패(재판단)') }),
    expect.objectContaining({ reason: expect.stringContaining('재판단 후에도 기술적 검증 실패') })] });
  expect(!outcome.ok && outcome.error).not.toMatch(/보완|적어 주세요/);
});

it('with a real gap as well, asks only for the gap and keeps the technical failure in the PM record', async () => {
  const unverifiable = { index: 1, met: true, file: 'other.md', quote: '어디에도 없는 문장' };
  const llm = new FakeLlm([
    call({ conditions: [unverifiable, { index: 2, met: false, missing: '화면 목록을 추가해 주세요.' }], decisionConflicts: [] }),
    call({ conditions: [], decisionConflicts: [] }),
  ]);
  const outcome = await judgeTwo(llm);
  expect(outcome).toMatchObject({ ok: true, llmCalls: 2, review: { verdict: 'insufficient', met: [],
    missing: ['인계 조건 "화면 목록이 있다"가 충족되지 않았습니다. 화면 목록을 추가해 주세요.'],
    citationFailures: [expect.objectContaining({ file: 'other.md' }), expect.objectContaining({ reason: expect.stringContaining('재판단 후에도') })] } });
});

it('does not re-judge a content failure in an identified file', async () => {
  const llm = new FakeLlm([call({ conditions: [
    { index: 1, met: true, file: '', quote: '결제 없이 예약을 확정한다' }, { index: 2, met: true, file: 'flow.md', quote: '# 흐름' }], decisionConflicts: [] })]);
  const outcome = await judgeHandoff({ state: state(), result, resultContent: content, decisions: [], llm, model: 'm' });
  expect(outcome).toMatchObject({ ok: true, llmCalls: 1, review: { verdict: 'insufficient',
    missing: [expect.stringContaining('이 조건을 다루는 내용을 flow.md에 분명히 적어 주세요')],
    citationFailures: [{ file: '', reason: '정규화 후에도 인용문이 결과 파일에 없음' }] } });
  expect(llm.requests).toHaveLength(1);
});

it('accepts a quote joined with ellipses only when every long-enough piece is in the file in order', () => {
  const file = '가입 단계 이탈을 줄이기 위해 소셜 로그인을 둔다. 화면은 모두 다섯 개다. 결제 화면은 이번 범위에서 뺀다.';
  // Pieces from different sentences, joined with "..." or "…", in file order.
  expect(quoteInText('가입 단계 이탈을 줄이기 위해 ... 결제 화면은 이번 범위에서 뺀다.', file)).toBe(true);
  expect(quoteInText('소셜 로그인을 둔다.…화면은 모두 다섯 개다.', file)).toBe(true);
  expect(quoteInText('…화면은 모두 다섯 개다...', file)).toBe(true);
  // Out of order, a piece not in the file, or a piece too short to be evidence all fail.
  expect(quoteInText('결제 화면은 이번 범위에서 뺀다. ... 가입 단계 이탈을 줄이기 위해', file)).toBe(false);
  expect(quoteInText('가입 단계 이탈을 줄이기 위해 ... 결제 화면을 추가한다', file)).toBe(false);
  expect(quoteInText('가입 단계 이탈을 줄이기 위해 ... 결제 화면', file)).toBe(false);
  expect(quoteInText('가입 단계 ... 결제 화면은', file)).toBe(false);
  expect(quoteInText('...', file)).toBe(false);
  // Exactly eight characters is the shortest accepted piece; seven is not.
  expect(quoteInText('가입 단계 이탈을 ... 로그인을 둔다.', file)).toBe(true);
  expect(quoteInText('가입 단계 이탈을 ... 로그인을 둔다', file)).toBe(false);
  // A literal ellipsis in the file still matches exactly.
  expect(quoteInText('기다리는 중... 끝', '상태: 기다리는 중... 끝')).toBe(true);
});

it('verifies an elided citation against the normalized result file', () => {
  expect(checkCitation('flow.md', '가입 단계 이탈(문제 ①)을 줄이기 위해 … 결제 화면을 추가한다.', content, ['flow.md'])).toEqual({ kind: 'verified', file: 'flow.md' });
  expect(checkCitation('flow.md', '결제 화면을 추가한다. … 가입 단계 이탈(문제 ①)을', content, ['flow.md'])).toMatchObject({ kind: 'content', file: 'flow.md' });
});
