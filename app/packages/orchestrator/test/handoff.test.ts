import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { project, type LedgerEvent } from '@ensemble/core';
import type { LlmProvider, LlmRequest, LlmResponse, ToolCall } from '@ensemble/llm';
import { checkCitation, handoffEvents, judgeHandoff, normalizeCitation, quoteInText, REVIEW_TOOL, type Decision, type SubmittedResult } from '../src/handoff.ts';

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
  expect(await judge(llm, stale)).toMatchObject({ ok: true, review: { verdict: 'insufficient', missing: [expect.stringContaining('작업 명세가 바뀌기 전에')] } });
  const pending = state([ev('update_sent', { updateId: 'u1', taskId: 'T3', fromVersion: 1, toVersion: 1 }, 'agent')]);
  expect(await judge(llm, pending)).toMatchObject({ ok: true, review: { verdict: 'insufficient', missing: [expect.stringContaining('변경을 아직 확인(acknowledge_update)')] } });
  expect(llm.requests).toHaveLength(0);
});

it('counts a condition as met only when the quoted evidence is really in the result', async () => {
  const llm = new FakeLlm([call({ conditions: [
    { index: 1, met: true, file: 'flow.md', quote: '가입 단계 이탈(문제 ①)을 줄이기 위해' },
    { index: 2, met: true, file: 'flow.md', quote: '화면 목록: 홈, 가입' },
  ], decisionConflicts: [{ decisionId: 'D2', detail: '결제 화면이 들어 있음' }, { decisionId: 'D404', detail: '모르는 결정' }] })]);
  const outcome = await judge(llm);
  // The invented quote is re-judged once (no answer here) and stays out of the request; the real conflict is asked for.
  expect(outcome).toMatchObject({ ok: true, llmCalls: 3, review: {
    verdict: 'insufficient', met: ['D1의 문제 ①을 다룬다'], evidence: [expect.stringContaining('flow.md'), '어긋난 확정 결정 D2: 결제는 제외'],
    missing: ['확정 결정(결제는 제외)과 어긋납니다: 결제 화면이 들어 있음'], citationFailures: [expect.objectContaining({ condition: '화면 목록이 있다' }), expect.objectContaining({ condition: '화면 목록이 있다' })] } });
  expect(outcome.ok && outcome.review.missing).toHaveLength(1);
  const request = llm.requests[0]!;
  expect(request).toMatchObject({ model: 'fake-pm', forceTool: REVIEW_TOOL, tools: [expect.objectContaining({ name: REVIEW_TOOL })] });
  expect(request.messages[0]!.content).toContain('taskId: T3 · resultId: r1 · planVersion: 1');
  expect(request.messages[0]!.content).toContain('D2: 결제는 제외');
});

it('treats conditions the model skipped as missing, with the model reason when it gave one', async () => {
  const llm = new FakeLlm([call({ conditions: [{ index: 1, met: false, missing: '문제 ①의 흐름이 없습니다.' }], decisionConflicts: [] })]);
  const outcome = await judge(llm);
  expect(outcome.ok && outcome.review.missing).toEqual([
    '조건 1(D1의 문제 ①을 다룬다): 문제 ①의 흐름이 없습니다.',
    '조건 2(화면 목록이 있다): 이 조건을 다루는 내용을 결과 파일에 추가해 주세요.',
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


it('normalizes markdown and whitespace; a citation still not in the file is re-judged once, then goes to a person', async () => {
  const llm = new FakeLlm([call({ conditions: [
    { index: 1, met: true, file: 'flow.md', quote: '가입 흐름을 확인한다.' },
    { index: 2, met: true, file: 'flow.md', quote: '**화면 목록** 세 개' },
  ], decisionConflicts: [] }), call({ conditions: [{ index: 2, met: true, file: 'flow.md', quote: '화면 목록 세 개' }], decisionConflicts: [] })]);
  const outcome = await judge(llm, state(), { 'flow.md': '# 안내\n- **가입**\n 흐름을 확인한다.\n화면 목록이 없다.' });
  expect(outcome).toMatchObject({ ok: false, llmCalls: 2, error: expect.stringContaining('결과 내용이 아니라 검토 과정의 문제예요'), citationFailures: [
    { file: 'flow.md', quote: '**화면 목록** 세 개', reason: '기술적 검증 실패(재판단): 정규화 후에도 인용문이 결과 파일에 없음' },
    { file: 'flow.md', quote: '화면 목록 세 개', reason: '재판단 후에도 기술적 검증 실패: 정규화 후에도 인용문이 결과 파일에 없음' }] });
  // Loosening quotation marks, spacing and clipped endings never turns a changed claim into evidence.
  const invented = new FakeLlm([call({ conditions: [
    { index: 1, met: true, file: 'flow.md', quote: '화면 목록이 있다.' },
    { index: 2, met: true, file: 'flow.md', quote: '가격 10원' },
  ], decisionConflicts: [] }), call({ conditions: [{ index: 1, met: false, missing: '화면 목록이 없습니다.' }, { index: 2, met: false, missing: '가격이 다릅니다.' }], decisionConflicts: [] })]);
  const rejected = await judge(invented, state(), { 'flow.md': '화면 목록이 없다. 가격 100원' });
  expect(rejected).toMatchObject({ ok: true, llmCalls: 2, review: { met: [], verdict: 'insufficient', missing: [expect.stringContaining('화면 목록이 없습니다.'), expect.stringContaining('가격이 다릅니다.')],
    citationFailures: [expect.objectContaining({ quote: '화면 목록이 있다.' }), expect.objectContaining({ quote: '가격 10원' })] } });
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
  expect(outcome).toMatchObject({ ok: false, llmCalls: 2, error: expect.stringContaining('결과 내용이 아니라 검토 과정의 문제예요'), citationFailures: [
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
    missing: ['조건 2(화면 목록이 있다): 화면 목록을 추가해 주세요.'],
    citationFailures: [expect.objectContaining({ file: 'other.md' }), expect.objectContaining({ reason: expect.stringContaining('재판단 후에도') })] } });
});

it('never turns a met condition whose quote is not in the identified file into a content request (QA3 C2)', async () => {
  const unverifiable = { index: 1, met: true, file: '', quote: '결제 없이 예약을 확정한다' };
  const llm = new FakeLlm([call({ conditions: [unverifiable, { index: 2, met: true, file: 'flow.md', quote: '# 흐름' }], decisionConflicts: [] }),
    call({ conditions: [unverifiable], decisionConflicts: [] })]);
  const outcome = await judgeHandoff({ state: state(), result, resultContent: content, decisions: [], llm, model: 'm' });
  expect(outcome).toMatchObject({ ok: false, llmCalls: 2, citationFailures: [
    { file: '', reason: '기술적 검증 실패(재판단): 정규화 후에도 인용문이 결과 파일에 없음' },
    { file: '', reason: '재판단 후에도 기술적 검증 실패: 정규화 후에도 인용문이 결과 파일에 없음' }] });
  expect(!outcome.ok && outcome.error).not.toMatch(/적어 주세요|보완/);
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
  expect(checkCitation('flow.md', '결제 화면을 추가한다. … 가입 단계 이탈(문제 ①)을', content, ['flow.md'])).toMatchObject({ kind: 'technical', file: 'flow.md' });
});

// QA3 C2: the virtual interview revisions whose citations failed although the content was there.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const qa3 = JSON.parse(fixture('qa3-citation-failures.json')) as { cf: { condition: string; file: string; quote: string }[]; ev: string[] }[];
const revision1 = fixture('qa3-interview-revision-1.txt');
const revision2 = fixture('qa3-interview-revision-2.txt');
const INTERVIEW = ['가상 고객 5명 각각의 예약 서비스 이용 시 니즈, 불편, 결제 관련 반응을 정리한 인터뷰 노트 제출', '가입, 시간 선택, 예약 확인, 결제 단계에 대한 반응을 구분해 기록'];

it('matches the QA3 C2 quotes that dropped the end of a sentence and closed the quotation mark early', () => {
  const [first, second] = [qa3[0]!.cf[0]!, qa3[1]!.cf[0]!];
  // Revision 1: the last line's second sentence was left out and a closing quote added.
  expect(first.file).toBe('9432180a-1c73-460c-a92c-2062fd0eec5c');
  expect(quoteInText(normalizeCitation(first.quote), normalizeCitation(revision1))).toBe(true);
  expect(checkCitation(first.file, first.quote, { [first.file]: revision1 }, [first.file])).toEqual({ kind: 'verified', file: first.file });
  // Revision 2: no file named, pieces joined with "...", the last one clipped the same way.
  expect(second.file).toBe('');
  expect(checkCitation(second.file, second.quote, { 'revision-2.txt': revision2 }, ['revision-2.txt'])).toEqual({ kind: 'verified', file: 'revision-2.txt' });
});

it('accepts the QA3 C2 revision without asking for more content', async () => {
  const s = project([
    ev('member_joined', { memberId: 'owner', kind: 'human', displayName: '사용자' }),
    ev('plan_committed', { version: 1, basedOn: null, reason: 'r', approvedBy: 'owner', sourceMessageIds: [], tasks: [
      { id: 'interview', title: '고객 인터뷰', assignee: 'owner', dependsOn: [], handoffConditions: INTERVIEW }] }),
    ev('result_submitted', { taskId: 'interview', resultId: 'r-qa3', planVersion: 1, summary: '보완 1회차', artifactIds: ['9432180a-1c73-460c-a92c-2062fd0eec5c'] }),
  ]);
  const submitted: SubmittedResult = { taskId: 'interview', resultId: 'r-qa3', planVersion: 1, summary: '보완 1회차', artifactIds: ['9432180a-1c73-460c-a92c-2062fd0eec5c'] };
  // The model's verdict as recorded at seq 53: condition 1 cited the summary line, condition 2 the clipped block.
  const summaryQuote = qa3[0]!.ev[0]!.split(': "').slice(1).join(': "').replace(/"$/, '');
  const llm = new FakeLlm([call({ conditions: [
    { index: 1, met: true, file: '9432180a-1c73-460c-a92c-2062fd0eec5c', quote: summaryQuote },
    { index: 2, met: true, file: qa3[0]!.cf[0]!.file, quote: qa3[0]!.cf[0]!.quote },
  ], decisionConflicts: [] })]);
  const outcome = await judgeHandoff({ state: s, result: submitted, resultContent: { '9432180a-1c73-460c-a92c-2062fd0eec5c': revision1 }, decisions: [], llm, model: 'm' });
  expect(outcome).toMatchObject({ ok: true, llmCalls: 1, review: { verdict: 'sufficient', met: INTERVIEW, missing: [] } });
  expect(outcome.ok && outcome.review.citationFailures).toBeUndefined();
});

it('lets a clipped or rephrased ending through only when the opening run is long enough', () => {
  const file = '결제 화면에서는 카드 정보를 미리 입력하지 않고 예약을 확정한 뒤에 결제 방법을 선택할 수 있으면 좋겠어요. 요금이 얼마인지 먼저 보여주면 좋아요. 화면 목록이 없다.';
  // A 40+ character opening with a rephrased ending.
  expect(quoteInText('결제 화면에서는 카드 정보를 미리 입력하지 않고 예약을 확정한 뒤에 결제 방법을 고를 수 있으면 해요', file)).toBe(true);
  // Quotation marks, spacing and sentence marks differ.
  expect(quoteInText('“요금이 얼마인지 먼저  보여주면 좋아요”', file)).toBe(true);
  // A short claim with a flipped ending is not evidence.
  expect(quoteInText('화면 목록이 있다.', file)).toBe(false);
  expect(quoteInText('결제 화면에서는 현금만 받는다', file)).toBe(false);
});

// QA3 C5/M5: a revision request says what is missing, not the whole condition again.
it('keeps only the gap in a revision item and refers to the condition by number and a short name', async () => {
  const long = '가입, 시간 선택, 예약 확인, 결제 단계에 대한 반응을 구분해 기록';
  const s = project([
    ev('plan_committed', { version: 1, basedOn: null, reason: 'r', approvedBy: 'lead', sourceMessageIds: [], tasks: [
      { id: 'T3', title: '인터뷰', assignee: 'designer', dependsOn: [], handoffConditions: ['화면 목록이 있다', long] }] }),
    ev('result_submitted', result, 'agent'),
  ]);
  const llm = new FakeLlm([call({ conditions: [{ index: 1, met: true, file: 'flow.md', quote: '# 흐름' }, { index: 2, met: false, missing: '결제 단계 반응이 없습니다.' }], decisionConflicts: [] })]);
  const outcome = await judgeHandoff({ state: s, result, resultContent: content, decisions: [], llm, model: 'm' });
  expect(outcome.ok && outcome.review.missing).toEqual(['조건 2(가입, 시간 선택, 예약 확인,…): 결제 단계 반응이 없습니다.']);
  expect(outcome.ok && outcome.review.missing.join('\n')).not.toContain(long);
  // The whole condition stays in the judgement record.
  expect(outcome.ok && outcome.review.evidence).toContain(`미충족 조건 2: ${long}`);
});

it('names a conflicting decision by a short name in the revision item (run-3 ledger seq 28)', async () => {
  const summary = 'PT 예약 서비스 대안 조사에 서비스별 환불·취소 정책(취소 가능 시점, 환불 비율)을 포함한다';
  const llm = new FakeLlm([call({ conditions: [{ index: 1, met: true, file: 'flow.md', quote: '# 흐름' }, { index: 2, met: true, file: 'flow.md', quote: '소셜 로그인을 둔다' }],
    decisionConflicts: [{ decisionId: 'refund-policy', detail: '서비스별 환불·취소 정책이 없습니다.' }] })]);
  const outcome = await judgeHandoff({ state: state(), result, resultContent: content, llm, model: 'm',
    decisions: [{ decisionId: 'refund-policy', summary, sourceMessageIds: [], approvedBy: 'lead', changeKinds: [] }] });
  expect(outcome.ok && outcome.review.missing).toEqual(['확정 결정(PT 예약 서비스 대안 조사에 서…)과 어긋납니다: 서비스별 환불·취소 정책이 없습니다.']);
  expect(outcome.ok && outcome.review.evidence).toContain(`어긋난 확정 결정 refund-policy: ${summary}`);
});

// M11 T2: people's scope cuts are judged, not written into the conditions.
const scopeState = (exclusions: string[], conditions: string[], limits: string[] = []) => project([
  ev('member_joined', { memberId: 'agent', kind: 'agent', displayName: '프로토타입 Agent' }),
  ev('plan_committed', { version: 1, basedOn: null, reason: 'r', approvedBy: 'lead', sourceMessageIds: [], tasks: [
    { id: 'T3', title: '예약 프로토타입', baseTitle: '예약 프로토타입', exclusions, limits, assignee: 'agent', dependsOn: [], handoffConditions: conditions }] }),
  ev('result_submitted', { ...result, artifactIds: ['proto.html'] }, 'agent'),
]);
const proto = { 'proto.html': '<h1>예약</h1>\n가입 → 시간 선택 → 예약 확인\n<p>실제 결제나 개인정보 수집이 아닌 시연용입니다.</p>' };
const judgeScope = (llm: FakeLlm, s: ReturnType<typeof scopeState>) => judgeHandoff({ state: s, result: { ...result, artifactIds: ['proto.html'] }, resultContent: proto, decisions: [], llm, model: 'fake-pm' });
const FLOW = '가입·시간 선택·예약 확인·결제 화면으로 이동 가능';

it('T2: the judge gets the exclusions and the rule; the excluded part of "가입·시간 선택·예약 확인·결제 화면으로 이동 가능" is waived, the rest required', async () => {
  // The result has sign-up, time choice and confirmation but no payment screen: that suffices under exclusions ["결제"].
  const llm = new FakeLlm([call({ conditions: [{ index: 1, met: true, file: 'proto.html', quote: '가입 → 시간 선택 → 예약 확인' }], decisionConflicts: [] })]);
  const outcome = await judgeScope(llm, scopeState(['결제'], [FLOW]));
  expect(outcome).toMatchObject({ ok: true, review: { verdict: 'sufficient', met: [FLOW] } });
  const request = llm.requests[0]!;
  expect(request.messages[0]!.content).toContain(`## 인계 조건\n1. ${FLOW}\n## 제외 범위 (요구하지 않음)\n- 결제`);
  expect(request.system).toContain('제외 범위(또는 한정 범위 밖)를 요구하는 조건이나 그 부분은 요구하지 않은 것으로 본다');
  expect(request.system).toContain('조건의 나머지 부분은 그대로 판단한다');
  expect(request.system).toContain('금지 제약은 범위 제외와 관계없이 그대로 적용한다');
  // Without the rest (no confirmation screen), the condition is still missing: only the payment part was waived.
  const partial = new FakeLlm([call({ conditions: [{ index: 1, met: false, missing: '예약 확인 화면으로 이동하는 흐름이 없습니다.' }], decisionConflicts: [] })]);
  expect(await judgeScope(partial, scopeState(['결제'], [FLOW]))).toMatchObject({ ok: true, review: { verdict: 'insufficient', missing: ['조건 1(가입·시간 선택·예약 확인·결제…): 예약 확인 화면으로 이동하는 흐름이 없습니다.'] } });
  // No cut: no scope section and no scope rules.
  const plain = new FakeLlm([call({ conditions: [{ index: 1, met: true, file: 'proto.html', quote: '가입 → 시간 선택 → 예약 확인' }], decisionConflicts: [] })]);
  await judgeScope(plain, scopeState([], [FLOW]));
  expect(plain.requests[0]!.messages[0]!.content).not.toContain('## 제외 범위');
  expect(plain.requests[0]!.system).not.toContain('범위 제외·한정 규칙');
});

it('T2: a condition only about the excluded scope is waived without a quote; a prohibition never is', async () => {
  const PAY = '모의 결제 화면에는 결제 버튼과 확인 메시지가 포함';
  const BAN = '실제 결제나 실제 개인정보 수집이 아님 문구';
  const llm = new FakeLlm([
    call({ conditions: [{ index: 1, met: true, excluded: true }, { index: 2, met: true, excluded: true }], decisionConflicts: [] }),
    call({ conditions: [{ index: 2, met: true, file: 'proto.html', quote: '실제 결제나 개인정보 수집이 아닌 시연용입니다.' }], decisionConflicts: [] }),
  ]);
  const outcome = await judgeScope(llm, scopeState(['결제 화면과 모의 결제 버튼'], [PAY, BAN], ['가입·시간 선택·예약 확인까지']));
  // The payment condition is waived; the prohibition had to be shown in the result (re-judged once, then cited).
  expect(outcome).toMatchObject({ ok: true, llmCalls: 2, review: { verdict: 'sufficient', met: [PAY, BAN],
    evidence: [`조건 1은 제외·한정 범위만 요구해 요구하지 않음: ${PAY}`, expect.stringContaining('proto.html')] } });
  expect(llm.requests[0]!.messages[0]!.content).toContain('## 한정 범위 (여기까지만 요구)\n- 가입·시간 선택·예약 확인까지');
  expect(llm.requests[1]!.messages[0]!.content).toContain('금지 제약이라 범위 제외로 면제할 수 없음');
  // Without any cut, "excluded" is not a way around a condition.
  const noCut = new FakeLlm([call({ conditions: [{ index: 1, met: true, excluded: true }], decisionConflicts: [] }), call({ conditions: [{ index: 1, met: false, missing: '결제 버튼이 없습니다.' }], decisionConflicts: [] })]);
  expect(await judgeScope(noCut, scopeState([], [PAY]))).toMatchObject({ ok: true, review: { verdict: 'insufficient' } });
});

it('U2: a short condition name never leaves a bracket open (QA4 Z7)', async () => {
  const { conditionLabel } = await import('../src/handoff.ts');
  const label = conditionLabel(0, '5명의 가상 보호자 각각의 배경(직업, 반려견 나이, 산책 시간)과 불편');
  expect(label).toBe('조건 1(5명의 가상 보호자 각각의 배경…)');
  expect(label.split('(').length).toBe(label.split(')').length);
  expect(conditionLabel(1, '(필수) 화면 목록과 화면별 주요 UI 요소가 모두 문서에 있다')).toBe('조건 2((필수) 화면 목록과 화면별 주요…)');
});
