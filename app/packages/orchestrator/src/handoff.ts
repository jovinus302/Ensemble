import { particle } from './channel-text.ts';
// Handoff judge (F3): code-first structural checks, then an LLM comparison of the result against the
// task's handoff conditions and the confirmed decisions. The verdict is recorded as handoff_reviewed
// and becomes either task_checked or a concrete revision request.
import { checkResult, handoffBlockers, requestRevision, type EventContext, type EventPayloads, type Id, type NewLedgerEvent, type ProjectState } from '@ensemble/core';
import type { LlmProvider, LlmRequest, ToolSpec } from '@ensemble/llm';

export type HandoffReview = EventPayloads['handoff_reviewed'];
export type SubmittedResult = EventPayloads['result_submitted'];
export type Decision = EventPayloads['decision_recorded'];
/** File content keyed by artifact ID; null or absent means the file could not be found. */
export type ResultContent = Record<string, string | null | undefined>;

export interface JudgeInput {
  state: ProjectState;
  result: SubmittedResult;
  resultContent: ResultContent;
  decisions: Decision[];
  llm: LlmProvider;
  model: string;
}
export type CitationFailure = NonNullable<HandoffReview['citationFailures']>[number];
/**
 * An LLM failure is not a verdict: it goes to a person instead of becoming a revision request. The same
 * holds when the model says a condition is met but its citation still cannot be tied to a result file
 * after one re-judgement; `citationFailures` then carries the PM record of what could not be verified.
 */
export type JudgeOutcome = { ok: true; review: HandoffReview; llmCalls: number }
  | { ok: false; error: string; llmCalls: number; citationFailures?: CitationFailure[] };

export const REVIEW_TOOL = 'record_handoff_review';
const reviewTool: ToolSpec = {
  name: REVIEW_TOOL,
  description: '결과물이 인계 조건과 확정 결정을 충족하는지 조건별로 기록한다.',
  inputSchema: {
    type: 'object',
    required: ['conditions', 'decisionConflicts'],
    properties: {
      conditions: { type: 'array', items: { type: 'object', required: ['index', 'met'], properties: {
        index: { type: 'integer', description: '인계 조건 번호(1부터)' },
        met: { type: 'boolean' },
        file: { type: 'string', description: '근거가 있는 결과 파일 경로' },
        quote: { type: 'string', description: '근거 문장을 결과 파일에서 그대로 인용' },
        missing: { type: 'string', description: '미충족이면 무엇을 보완해야 하는지 한 문장' },
      } } },
      decisionConflicts: { type: 'array', items: { type: 'object', required: ['decisionId', 'detail'], properties: {
        decisionId: { type: 'string' }, detail: { type: 'string' },
      } } },
    },
  },
};
const SYSTEM = [
  '당신은 팀의 PM으로서 제출된 결과물이 다음 담당에게 넘겨도 되는지 판단한다.',
  '- 인계 조건마다 결과 파일 안에서 근거 문장을 찾아 그대로 인용한다. 근거가 결과 안에 있어야만 met=true.',
  '- quote는 결과 파일의 한 문장이나 한 줄을 고치지 않고 짧게 복사한다. 따옴표를 새로 붙이거나 문장을 줄이지 않는다. "## 결과 요약"은 근거가 아니다.',
  '- 근거를 찾지 못했거나 확실하지 않으면 met=false로 두고, missing에 무엇이 빠졌는지만 한 문장으로 구체적으로 쓴다. 조건 문장을 되풀이하지 않는다.',
  '- 결과가 확정 결정과 어긋나면 decisionConflicts에 결정 ID와 어긋난 내용을 쓴다.',
  `- 반드시 ${REVIEW_TOOL} 도구로만 답한다.`,
].join('\n');

export const normalizeCitation = (text: string) => text.normalize('NFC')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|>\s*)/gm, '')
  .replace(/(\*\*|__|~~)(.*?)\1/gs, '$2')
  .replace(/`+([^`]+)`+/g, '$1')
  .replace(/(?<!\w)([*_])([^\n]+?)\1(?!\w)/g, '$2')
  .replace(/\s+/g, ' ').trim();
const squash = normalizeCitation;

/** Shortest piece of an elided quote that still counts as evidence; shorter pieces fail the quote. */
export const MIN_ELIDED_PIECE = 8;
/** A quote whose opening run of this many comparable characters is in the file matches (a clipped ending). */
export const PREFIX_MATCH_CHARS = 40;
/** Or whose opening run covers this share of the quote, when that run is at least PREFIX_MATCH_FLOOR long. */
export const PREFIX_MATCH_SHARE = 0.7;
const PREFIX_MATCH_FLOOR = 20;

/**
 * What a quote and a file are compared on: quotation marks, table bars, sentence punctuation and
 * all whitespace carry no evidence, and models add, drop or change them when they copy a sentence.
 */
export const citationKey = (text: string) => text.replace(/["'“”‘’„‚«»「」『』`|]/g, '').replace(/[.,!?;:·。、…~]/g, '').replace(/\s+/g, '');

/** Length and end of the longest opening run of `needle` found in `hay` at or after `from`. */
function openingRun(needle: string, hay: string, from: number): { length: number; end: number } {
  let low = 0, high = needle.length, end = from;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const at = hay.indexOf(needle.slice(0, mid), from);
    if (at >= 0) { low = mid; end = at + mid; } else high = mid - 1;
  }
  return { length: low, end };
}

/**
 * Whether a normalized quote is in a normalized file. A quote the model joined from several places
 * with "..." or "…" matches when every piece is at least MIN_ELIDED_PIECE long and they appear in order.
 * Pieces are compared on citationKey, and a piece whose ending the model clipped or rephrased still
 * matches when its opening run reaches PREFIX_MATCH_CHARS or PREFIX_MATCH_SHARE of the piece.
 */
export function quoteInText(quote: string, text: string): boolean {
  if (text.includes(quote)) return true;
  const pieces = quote.split(/\s*(?:\.{3,}|…+)\s*/).map((piece) => piece.trim());
  // Leading or trailing marks only say the quote starts or ends mid-sentence.
  if (pieces[0] === '') pieces.shift();
  if (pieces.at(-1) === '') pieces.pop();
  if (pieces.length === 0 || pieces.some((piece) => piece.length < MIN_ELIDED_PIECE)) return false;
  const hay = citationKey(text);
  let from = 0;
  for (const piece of pieces) {
    const needle = citationKey(piece);
    if (!needle) return false;
    const at = hay.indexOf(needle, from);
    if (at >= 0) { from = at + needle.length; continue; }
    const run = openingRun(needle, hay, from);
    if (run.length < PREFIX_MATCH_CHARS && (run.length < PREFIX_MATCH_FLOOR || run.length < needle.length * PREFIX_MATCH_SHARE)) return false;
    from = run.end;
  }
  return true;
}

/** How a revision item names a condition: its number and a short name, never the whole text again. */
const shortName = (text: string) => (text.length <= 20 ? text : `${text.slice(0, 18).trimEnd()}…`);
export function conditionLabel(index: number, condition: string): string {
  return `조건 ${index + 1}(${shortName(condition)})`;
}

/** Code-only checks that need no model: result files present, result current, no unconfirmed update. */
export function structuralProblems(state: ProjectState, result: SubmittedResult, content: ResultContent): string[] {
  const problems = handoffBlockers(state, result.taskId, result.resultId);
  if (result.artifactIds.length === 0) problems.push(`제출한 결과에 결과 파일이 없습니다. 결과 파일을 첨부해 다시 제출해 주세요.`);
  for (const path of result.artifactIds) {
    if (typeof content[path] !== 'string') problems.push(`결과 파일 ${path}${particle(path)} 찾을 수 없습니다. 파일을 작업 폴더에 두고 다시 제출해 주세요.`);
  }
  return problems;
}

function buildRequest(input: JudgeInput, conditions: string[]): LlmRequest {
  const { result, resultContent, decisions, state, model } = input;
  const files = result.artifactIds.map((path) => `### 파일: ${path}\n${resultContent[path] ?? ''}`);
  const body = [
    // The IDs keep a proxy response cache from reusing a verdict for a different result.
    `taskId: ${result.taskId} · resultId: ${result.resultId} · planVersion: ${result.planVersion}`,
    `작업: ${state.tasks.get(result.taskId)?.spec.title ?? result.taskId}`,
    '## 인계 조건', ...conditions.map((condition, i) => `${i + 1}. ${condition}`),
    '## 확정 결정', ...(decisions.length ? decisions.map((d) => `- ${d.decisionId}: ${d.summary}`) : ['- 없음']),
    '## 결과 요약', result.summary,
    '## 결과 파일', ...files,
  ].join('\n');
  return { model, system: SYSTEM, messages: [{ role: 'user', content: body }], tools: [reviewTool], forceTool: REVIEW_TOOL, maxTokens: 2000 };
}

interface ConditionVerdict { index: number; met: boolean; file?: string; quote?: string; missing?: string }
interface ModelVerdict { conditions: ConditionVerdict[]; conflicts: { decisionId: string; detail: string }[] }

function parseVerdict(input: Record<string, unknown> | undefined): ModelVerdict | null {
  if (!input || !Array.isArray(input.conditions)) return null;
  const conditions: ConditionVerdict[] = [];
  for (const raw of input.conditions) {
    if (typeof raw !== 'object' || raw === null) return null;
    const item = raw as Record<string, unknown>;
    if (!Number.isInteger(item.index) || typeof item.met !== 'boolean') return null;
    const text = (key: string) => (typeof item[key] === 'string' ? item[key] as string : undefined);
    conditions.push({ index: item.index as number, met: item.met, file: text('file'), quote: text('quote'), missing: text('missing') });
  }
  const conflicts = Array.isArray(input.decisionConflicts) ? input.decisionConflicts.flatMap((raw) => {
    const item = raw as Record<string, unknown> | null;
    return item && typeof item.decisionId === 'string' && typeof item.detail === 'string' ? [{ decisionId: item.decisionId, detail: item.detail }] : [];
  }) : [];
  return { conditions, conflicts };
}

async function askModel(input: JudgeInput, request: LlmRequest): Promise<{ verdict: ModelVerdict | null; calls: number; error: string }> {
  let error = '';
  for (let calls = 1; calls <= 2; calls++) {
    try {
      const response = await input.llm.complete(request);
      const call = response.toolCalls.find((tool) => tool.name === REVIEW_TOOL);
      const verdict = parseVerdict(call?.input);
      if (verdict) return { verdict, calls, error };
      error = call ? '인계 판단 응답 형식 오류' : '인계 판단 응답이 비어 있음';
    } catch (cause) {
      error = `인계 판단 호출 실패: ${cause instanceof Error ? cause.message : String(cause)}`;
    }
  }
  return { verdict: null, calls: 2, error };
}

/**
 * Where a "met" citation stands after checking it against the submitted files:
 * - verified: the quote is really in a result file (the named one, else the file that contains it);
 * - technical: the citation cannot be tied to a result file (no quote, or a quote found in no file even
 *   after normalization). The model already judged the condition met, so this is a verification
 *   failure — re-judged once, then a person checks — never a gap in the person's or agent's work.
 */
export type CitationCheck = { kind: 'verified'; file: string } | { kind: 'technical'; file: string; reason: string };

export function checkCitation(named: string | undefined, rawQuote: string | undefined, content: ResultContent, files: readonly string[]): CitationCheck {
  const quote = squash(rawQuote ?? '');
  const given = (named ?? '').trim();
  if (!quote) return { kind: 'technical', file: given, reason: '인용문이 비어 있음' };
  const readable = files.filter((path) => typeof content[path] === 'string');
  const bare = given.replace(/^\.\//, '');
  const suffix = readable.filter((path) => path.endsWith(`/${bare}`));
  const identified = readable.includes(given) ? given : readable.includes(bare) ? bare : bare && suffix.length === 1 ? suffix[0] : undefined;
  const hits = readable.filter((path) => quoteInText(quote, squash(content[path] as string)));
  if (identified && hits.includes(identified)) return { kind: 'verified', file: identified };
  // The model left the file out or named another one: the quote itself identifies the file.
  // Several hits still prove the quote is in the result; the first in submission order is cited.
  if (hits.length) return { kind: 'verified', file: hits[0]! };
  const target = identified ?? (readable.length === 1 ? readable[0] : undefined);
  if (target) return { kind: 'technical', file: target, reason: '정규화 후에도 인용문이 결과 파일에 없음' };
  return { kind: 'technical', file: given, reason: given ? '지정한 결과 파일이 없고 인용문도 결과 파일에서 찾지 못함' : '결과 파일을 지정하지 않았고 인용문도 결과 파일에서 찾지 못함' };
}

/** The one re-judgement after a technical citation failure: same request plus what could not be tied to a file. */
function rejudgeRequest(request: LlmRequest, failed: { index: number; condition: string; check: CitationCheck }[], files: readonly string[]): LlmRequest {
  const note = [
    '## 인용 확인 실패 — 다시 판단',
    '아래 조건은 충족으로 판단했지만 인용을 결과 파일에 연결하지 못했다. 이 조건들을 다시 판단하라.',
    `- file에는 "### 파일:" 뒤의 경로를 그대로 쓴다: ${files.join(', ')}`,
    '- quote에는 그 파일의 한 문장이나 한 줄을 고치지 않고 짧게 복사한다. 여러 곳을 이어 붙이거나 따옴표를 더하지 않는다. 근거가 없으면 met=false로 둔다.',
    ...failed.map(({ index, condition, check }) => `${index}. ${condition} — ${check.kind === 'verified' ? '' : check.reason}`),
  ].join('\n');
  const [first, ...rest] = request.messages;
  return { ...request, messages: [{ ...first!, content: `${first!.content}\n${note}` }, ...rest] };
}

export async function judgeHandoff(input: JudgeInput): Promise<JudgeOutcome> {
  const { state, result, resultContent, decisions } = input;
  const base = { taskId: result.taskId, resultId: result.resultId };
  const problems = structuralProblems(state, result, resultContent);
  if (problems.length) return { ok: true, llmCalls: 0, review: { ...base, verdict: 'insufficient', met: [], missing: problems, evidence: [] } };
  const conditions = state.tasks.get(result.taskId)?.spec.handoffConditions ?? [];
  if (!conditions.length && !decisions.length) return { ok: true, llmCalls: 0, review: { ...base, verdict: 'sufficient', met: [], missing: [], evidence: [] } };

  const request = buildRequest(input, conditions);
  const first = await askModel(input, request);
  let llmCalls = first.calls;
  if (!first.verdict) return { ok: false, llmCalls, error: `결과 인계 판단을 마치지 못했습니다. 사람이 확인해 주세요.` };
  const items = new Map(first.verdict.conditions.map((entry) => [entry.index, entry]));
  const check = (i: number) => {
    const item = items.get(i + 1);
    return item?.met ? checkCitation(item.file, item.quote, resultContent, result.artifactIds) : null;
  };
  const citationFailures: CitationFailure[] = [];
  const record = (i: number, c: CitationCheck, prefix = '') => {
    if (c.kind !== 'verified') citationFailures.push({ condition: conditions[i]!, file: items.get(i + 1)?.file ?? '', quote: items.get(i + 1)?.quote ?? '', reason: `${prefix}${c.reason}` });
  };

  // A technical failure is recorded for the PM and re-judged once; it never becomes a request to the person.
  const technical = conditions.flatMap((condition, i) => { const c = check(i); return c?.kind === 'technical' ? [{ index: i + 1, condition, check: c }] : []; });
  if (technical.length) {
    for (const { index, check: c } of technical) record(index - 1, c, '기술적 검증 실패(재판단): ');
    const retry = await askModel(input, rejudgeRequest(request, technical, result.artifactIds));
    llmCalls += retry.calls;
    for (const { index } of technical) {
      const again = retry.verdict?.conditions.find((entry) => entry.index === index);
      if (again) items.set(index, again);
    }
  }

  const met: string[] = [];
  const missing: string[] = [];
  const evidence: string[] = [];
  const unverified: string[] = [];
  conditions.forEach((condition, i) => {
    const item = items.get(i + 1);
    const c = check(i);
    // The model's "met" counts only when its quote is really in a result file.
    if (c?.kind === 'verified') {
      met.push(condition);
      evidence.push(`${condition} ← ${c.file}: "${squash(item?.quote ?? '')}"`);
    } else if (c) {
      record(i, c, '재판단 후에도 기술적 검증 실패: ');
      unverified.push(condition);
    } else {
      const detail = item?.missing?.trim();
      // The request carries the gap; the full condition stays in the judgement record (QA3 C5).
      missing.push(`${conditionLabel(i, condition)}: ${detail || '이 조건을 다루는 내용을 결과 파일에 추가해 주세요.'}`);
      evidence.push(`미충족 조건 ${i + 1}: ${condition}`);
    }
  });
  const known = new Map(decisions.map((d) => [d.decisionId, d]));
  for (const conflict of first.verdict.conflicts) {
    const decision = known.get(conflict.decisionId);
    if (!decision) continue;
    missing.push(`확정 결정(${shortName(decision.summary)})과 어긋납니다: ${conflict.detail}`);
    evidence.push(`어긋난 확정 결정 ${decision.decisionId}: ${decision.summary}`);
  }
  const failures = citationFailures.length ? { citationFailures } : {};
  // With a real gap the revision covers it and the unverified condition is judged again on resubmission;
  // with none, an unverifiable "met" is neither a pass nor the person's fault, so a person decides.
  if (unverified.length && !missing.length) {
    return { ok: false, llmCalls, ...failures, error: `결과 인계 판단 중 인계 조건 ${unverified.map((c) => `"${c}"`).join(', ')}의 근거 인용을 결과 파일에 연결하지 못했습니다. 결과 내용의 문제가 아니라 확인 과정의 문제이니 사람이 결과를 확인해 주세요.` };
  }
  return { ok: true, llmCalls, review: { ...base, verdict: missing.length || unverified.length ? 'insufficient' : 'sufficient', met, missing, evidence, ...failures } };
}

const pm = { kind: 'pm' as const, id: 'pm' };
export const reviewKey = (resultId: Id) => `handoff:${resultId}`;

/** The review record plus its consequence; re-checks blockers against the state it is appended to. */
export function handoffEvents(state: ProjectState, review: HandoffReview, ctx: EventContext): NewLedgerEvent[] {
  const blockers = review.verdict === 'sufficient' ? handoffBlockers(state, review.taskId, review.resultId) : [];
  const final: HandoffReview = blockers.length ? { ...review, verdict: 'insufficient', missing: [...review.missing, ...blockers] } : review;
  const recorded: NewLedgerEvent = { ...ctx, type: 'handoff_reviewed', actor: pm, idempotencyKey: reviewKey(review.resultId), payload: final };
  const outcome = final.verdict === 'sufficient'
    ? { ...checkResult(state, final.taskId, final.resultId, `인계 조건 충족: ${final.met.join('; ') || '확인할 조건 없음'}`, ctx), idempotencyKey: `checked:${final.resultId}` }
    : { ...requestRevision(state, final.taskId, final.resultId, final.missing, ctx), idempotencyKey: `revision:${final.resultId}` };
  return [recorded, outcome];
}
