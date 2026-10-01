import { particle } from './channel-text.ts';
// Handoff judge (F3): code-first structural checks, then an LLM comparison of the result against the
// task's handoff conditions and the confirmed decisions. The verdict is recorded as handoff_reviewed
// and becomes either task_checked or a concrete revision request.
import { checkResult, handoffBlockers, requestRevision, type EventContext, type EventPayloads, type Id, type NewLedgerEvent, type ProjectState } from '@ensemble/core';
import type { LlmProvider, LlmRequest, ToolSpec } from '@ensemble/llm';
import { taskScope } from './context.ts';

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
  /** What a person asked for on a checked result they reopened (M11 T3): judged like the conditions. */
  requests?: string[];
}
export type CitationFailure = NonNullable<HandoffReview['citationFailures']>[number];
/**
 * An LLM failure is not a verdict: it goes to a person instead of becoming a revision request. The same
 * holds when the model says a condition is met but its citation still cannot be tied to a result file
 * after one re-judgement; `citationFailures` then carries the PM record of what could not be verified.
 */
export type JudgeOutcome = { ok: true; review: HandoffReview; llmCalls: number }
  /** `cause` is the reason as a noun phrase people read after '…때문에' (M12 W2). */
  | { ok: false; error: string; cause: string; llmCalls: number; citationFailures?: CitationFailure[] };

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
        missing: { type: 'string', description: '미충족이면 무엇을 보완해야 하는지 사람이 읽을 한 문장' },
        exempt: { type: 'boolean', description: '사람이 정한 제외 범위(또는 한정 범위 밖) 때문에 이 조건을 요구하지 않으면 true, 그대로 판단하면 false' },
        reason: { type: 'string', description: 'exempt 판단의 이유를 사람이 읽을 한 문장으로. 도구 필드 이름은 쓰지 않는다' },
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
  '- 결과 파일에 적힌 내용만 판단한다. 작성자가 자료를 실제로 열람했는지는 결과에서 알 수 없으므로 판단 기준이 아니다.',
  '- 조건이 공개 자료·출처에 근거한 정리를 요구하면, 요구한 대상과 내용이 모두 정리돼 있고 항목마다 출처(URL 또는 자료명)가 적혀 있으며 직접 확인하지 못한 부분이 확인 한계로 분명히 구분돼 있을 때 충족이다. "미확인", "사전 지식 기반", "가상" 같은 확인 한계 표시만으로 met=false로 두지 않는다. 요구한 대상·내용·출처가 빠졌을 때만 미충족이다.',
  '- 결과가 확정 결정과 어긋나면 decisionConflicts에 결정 ID와 어긋난 내용을 쓴다.',
  `- 반드시 ${REVIEW_TOOL} 도구로만 답한다.`,
].join('\n');
/**
 * Added only when people cut the task's scope: the conditions stay as written and the cut is judged here,
 * condition by condition, by the model (M11 T2, M12 V1). Code only checks that an exempt condition really
 * names the cut (scopeKeywordIn); no word rule ("없이", "금지") decides it.
 */
const SCOPE_RULES = [
  '## 범위 제외·한정 규칙',
  '- 인계 조건마다 exempt(이 조건을 요구하지 않는지)와 reason(그 이유 한 문장)을 쓴다.',
  '- 조건이 제외 범위(또는 한정 범위 밖)의 존재·포함·동작을 요구하면 exempt=true다. 그 조건 안의 "실제 결제 연동 없이" 같은 수식은 그 요구의 일부라 함께 면제된다. 예: 제외 범위가 "결제"면 "결제 화면에 실제 결제 연동 없이 클릭 시 완료 상태로 전환되는 모의 결제 버튼이 존재한다"는 exempt=true이고, 결과에 결제 화면이 없어도 된다.',
  '- 제외 범위와 무관한 금지 제약(예: "실제 개인정보 저장 없음", "외부 네트워크 호출 없음")은 exempt=false로 두고 결과에서 그대로 판단한다.',
  '- 조건의 일부만 제외 범위면 exempt=false로 두고 나머지 부분을 판단한다. 예: 조건이 "가입·시간 선택·결제 화면"이고 결제가 제외면 가입·시간 선택은 여전히 결과에 있어야 한다.',
  '- exempt=true면 quote는 비워 둔다. missing과 reason은 사람이 읽는 문장이라 도구 필드 이름(exempt, met 등)을 쓰지 않는다.',
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
  return locateQuote(quote, text) !== null;
}

/** Where a normalized quote sits in citationKey(text) under the quoteInText rules; null when it is not there. */
function locateQuote(quote: string, text: string): { start: number; end: number } | null {
  const hay = citationKey(text);
  if (text.includes(quote)) {
    const whole = citationKey(quote);
    const at = whole ? hay.indexOf(whole) : 0;
    return { start: Math.max(at, 0), end: Math.max(at, 0) + whole.length };
  }
  const pieces = quote.split(/\s*(?:\.{3,}|…+)\s*/).map((piece) => piece.trim());
  // Leading or trailing marks only say the quote starts or ends mid-sentence.
  if (pieces[0] === '') pieces.shift();
  if (pieces.at(-1) === '') pieces.pop();
  if (pieces.length === 0 || pieces.some((piece) => piece.length < MIN_ELIDED_PIECE)) return null;
  let from = 0;
  let start = -1;
  for (const piece of pieces) {
    const needle = citationKey(piece);
    if (!needle) return null;
    const at = hay.indexOf(needle, from);
    if (at >= 0) { if (start < 0) start = at; from = at + needle.length; continue; }
    const run = openingRun(needle, hay, from);
    if (run.length < PREFIX_MATCH_CHARS && (run.length < PREFIX_MATCH_FLOOR || run.length < needle.length * PREFIX_MATCH_SHARE)) return null;
    if (start < 0) start = run.end - run.length;
    from = run.end;
  }
  return { start: Math.max(start, 0), end: from };
}

/** Particles and verb endings cut off a word so "전환되는", "클릭을" compare as "전환", "클릭". */
const ENDING = /(?:하는|하고|하며|하여|해야|해서|한다|된다|되는|되어|되며|되고|하지|있는|있다|없이|없는|없음|없다|으로|에서|에게|까지|부터|처럼|이며|이고|이다|은|는|을|를|이|가|의|에|와|과|로|도|만|한|된|할|될|함|됨)$/;
const stem = (word: string) => {
  let out = word;
  for (let i = 0; i < 2; i++) { const cut = out.replace(ENDING, ''); if (cut.length < 2 || cut === out) break; out = cut; }
  return out;
};
// A word still ending in 다 after stemming is a predicate ("다룬다", "있다"), not what the text is about.
const words = (text: string) => text.toLowerCase().split(/[^가-힣a-z0-9]+/).filter(Boolean).map(stem).filter((word) => word.length >= 2 && !/[가-힣]다$/.test(word));
const compact = (text: string) => text.toLowerCase().replace(/\s+/g, '');
/** Words that name a form or a degree, not what a condition is about. */
const CONDITION_GENERIC = new Set(['포함', '존재', '모두', '각각', '단일', '파일', '문서', '결과', '구현', '가능', '실행', '작성', '정리', '기록', '명시',
  'html', 'md', '위한', '통해', '통한', '대한', '모든', '이상', '하나', '경우', '사용자', '요청', '다시', '이번', '정도', '주세요', '올려', '만들어', '추가해서', '있어요', '없어요', '했어요']);
/** Generic UI nouns that do not identify a cut on their own ("결제 화면" is about 결제). */
const SCOPE_GENERIC = new Set(['모의', '모형', '실제', '기존', '관련', '화면', '버튼', '기능', '흐름', '포함', '상호작용', '설계', '동작', '구현', '반응', '정리', '부분', '범위', '전체']);

/** The key words of a scope item people cut or limited ("결제 화면과 모의 결제 버튼" → 결제). */
export function scopeKeywords(item: string): string[] {
  const all = words(item.replace(/(?:까지)+(?:만)?$/, ''));
  const named = all.filter((word) => !SCOPE_GENERIC.has(word));
  return [...new Set(named.length ? named : all)];
}
/** The first cut keyword the condition really contains; an exemption without one is not accepted. */
export function scopeKeywordIn(condition: string, scope: readonly string[]): string | undefined {
  const text = compact(condition);
  return scope.flatMap(scopeKeywords).find((word) => text.includes(word));
}

/** How far around a quote its context reaches, in citationKey characters. */
export const QUOTE_CONTEXT_CHARS = 60;
/**
 * Whether a quote can be evidence for a condition (M12 W3): at least one key word of the condition is in
 * the quote or within QUOTE_CONTEXT_CHARS of it in the file. A condition with no key word cannot be checked
 * and passes; a quote not found in the file is checkCitation's problem, not this one's.
 */
export function quoteRelevant(condition: string, quote: string, text: string): boolean {
  const keys = [...new Set([...words(condition).filter((word) => !CONDITION_GENERIC.has(word)), ...(condition.match(/[+-]\d+/g) ?? [])])];
  if (!keys.length) return true;
  const squashed = squash(text);
  const at = locateQuote(squash(quote), squashed);
  const hay = citationKey(squashed).toLowerCase();
  const near = at ? hay.slice(Math.max(0, at.start - QUOTE_CONTEXT_CHARS), at.end + QUOTE_CONTEXT_CHARS) : citationKey(squash(quote)).toLowerCase();
  if (keys.some((key) => near.includes(key))) return true;
  // A code citation can implement a labelled control far from its HTML. Follow
  // only literal DOM ID references in the quote to that exact element's label;
  // unrelated prose elsewhere in the file must not make a citation relevant.
  for (const reference of quote.matchAll(/\bgetElementById\(\s*(['"])([^'"]+)\1\s*\)/g)) {
    const id = reference[2]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const element = new RegExp(`<([a-z][\\w:-]*)\\b[^>]*\\sid\\s*=\\s*(['"])${id}\\2[^>]*>([^<]{1,200})<\\/\\1\\s*>`, 'i').exec(text);
    if (element && keys.some(key => citationKey(squash(element[3]!)).toLowerCase().includes(key))) return true;
  }
  return false;
}

/**
 * How a revision item names a condition: its number and a short name, never the whole text again.
 * A cut never leaves a bracket open inside the label's own parentheses (QA4 Z7).
 */
const shortName = (text: string) => {
  if (text.length <= 20) return text;
  let cut = text.slice(0, 18).trimEnd();
  const open: number[] = [];
  for (let i = 0; i < cut.length; i++) {
    if ('([{「『“'.includes(cut[i]!)) open.push(i);
    else if (')]}」』”'.includes(cut[i]!)) open.pop();
  }
  if (open.length) cut = open[0]! >= 4 ? cut.slice(0, open[0]).trimEnd() : cut.replace(/[()[\]{}「」『』“”]/g, '').trimEnd();
  return `${cut}…`;
};

/** Core's handoff blockers in words people read in a revision request (they are shown in the channel). */
function blockerText(blocker: string): string {
  if (/^Stale result/.test(blocker)) return '결과가 작업 명세가 바뀌기 전에 만들어졌습니다. 바뀐 명세에 맞춰 결과를 다시 제출해 주세요.';
  if (/not yet acknowledged/.test(blocker)) return '전달한 변경을 아직 확인(acknowledge_update)하지 않은 채 제출한 결과입니다. 변경을 확인한 뒤 결과를 다시 제출해 주세요.';
  if (/acknowledgement rejected/.test(blocker)) return '전달한 변경의 확인이 올바르지 않았습니다. 변경을 다시 확인한 뒤 결과를 다시 제출해 주세요.';
  const version = /based on v(\d+), before acknowledged v(\d+)/.exec(blocker);
  if (version) return `결과가 계획 v${version[1]} 기준이라 확인한 변경(v${version[2]})이 빠져 있습니다. v${version[2]} 기준으로 다시 제출해 주세요.`;
  if (/must be submitted/.test(blocker)) return '이 결과는 지금 검토할 제출 상태가 아닙니다.';
  return /[가-힣]/.test(blocker) ? blocker : '결과를 지금 인계 검토할 수 없는 상태입니다.';
}
export function conditionLabel(index: number, condition: string): string {
  return `조건 ${index + 1}(${shortName(condition)})`;
}

/** Code-only checks that need no model: result files present, result current, no unconfirmed update. */
export function structuralProblems(state: ProjectState, result: SubmittedResult, content: ResultContent): string[] {
  const problems = handoffBlockers(state, result.taskId, result.resultId).map(blockerText);
  if (result.artifactIds.length === 0) problems.push(`제출한 결과에 결과 파일이 없습니다. 결과 파일을 첨부해 다시 제출해 주세요.`);
  for (const path of result.artifactIds) {
    if (typeof content[path] !== 'string') problems.push(`결과 파일 ${path}${particle(path)} 찾을 수 없습니다. 파일을 작업 폴더에 두고 다시 제출해 주세요.`);
  }
  return problems;
}

function buildRequest(input: JudgeInput, conditions: string[]): LlmRequest {
  const { result, resultContent, decisions, state, model } = input;
  const files = result.artifactIds.map((path) => `### 파일: ${path}\n${resultContent[path] ?? ''}`);
  const { exclusions, limits } = taskScope(state.tasks.get(result.taskId)?.spec ?? {});
  const body = [
    // The IDs keep a proxy response cache from reusing a verdict for a different result.
    `taskId: ${result.taskId} · resultId: ${result.resultId} · planVersion: ${result.planVersion}`,
    `작업: ${state.tasks.get(result.taskId)?.spec.title ?? result.taskId}`,
    '## 인계 조건', ...conditions.map((condition, i) => `${i + 1}. ${condition}`),
    ...(exclusions.length ? ['## 제외 범위 (요구하지 않음)', ...exclusions.map((item) => `- ${item}`)] : []),
    ...(limits.length ? ['## 한정 범위 (여기까지만 요구)', ...limits.map((item) => `- ${item}`)] : []),
    '## 확정 결정', ...(decisions.length ? decisions.map((d) => `- ${d.decisionId}: ${d.summary}`) : ['- 없음']),
    '## 결과 요약', result.summary,
    '## 결과 파일', ...files,
  ].join('\n');
  const system = exclusions.length || limits.length ? `${SYSTEM}\n${SCOPE_RULES}` : SYSTEM;
  return { model, system, messages: [{ role: 'user', content: body }], tools: [reviewTool], forceTool: REVIEW_TOOL, maxTokens: 2000 };
}

/** The model's words go to people: tool field names it may echo ("excluded로 면제되지 않음") are dropped. */
export const peopleText = (text: string) => text
  .replace(/\b(?:excluded|exempt(?:ed)?)\b\s*(?:=\s*(?:true|false))?\s*(?:으로|로)?\s*(?=면제)/gi, '')
  .replace(/\b(?:excluded|exempt(?:ed)?)\b\s*(?:=\s*(?:true|false))?/gi, '면제')
  .replace(/\bmet\s*=\s*(?:true|false)\b/gi, '')
  .replace(/ {2,}/g, ' ').trim();

interface ConditionVerdict { index: number; met: boolean; file?: string; quote?: string; missing?: string; exempt?: boolean; reason?: string }
interface ModelVerdict { conditions: ConditionVerdict[]; conflicts: { decisionId: string; detail: string }[] }

function parseVerdict(input: Record<string, unknown> | undefined): ModelVerdict | null {
  if (!input || !Array.isArray(input.conditions)) return null;
  const conditions: ConditionVerdict[] = [];
  for (const raw of input.conditions) {
    if (typeof raw !== 'object' || raw === null) return null;
    const item = raw as Record<string, unknown>;
    if (!Number.isInteger(item.index) || typeof item.met !== 'boolean') return null;
    const text = (key: string) => (typeof item[key] === 'string' ? item[key] as string : undefined);
    // `excluded` is the M11 name of the same judgement; a cached or older reply still reads the same way.
    conditions.push({ index: item.index as number, met: item.met, file: text('file'), quote: text('quote'), missing: text('missing'),
      ...(item.exempt === true || item.excluded === true ? { exempt: true } : {}), ...(text('reason') ? { reason: text('reason') } : {}) });
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

/** Why a condition the model judged met or exempt still cannot count: a PM record and the words people read. */
interface Unproven { reason: string; cause: string }
const CAUSE = {
  citation: '근거 인용을 결과 파일에 연결하지 못한 문제',
  relevance: '인용한 근거가 조건과 관련이 없는 문제',
  exemption: '제외한 범위와 관계없는 조건을 요구하지 않는다고 본 문제',
} as const;

/** The one re-judgement after a technical failure: same request plus what could not be counted and why. */
function rejudgeRequest(request: LlmRequest, failed: { index: number; condition: string; check: Unproven }[], files: readonly string[]): LlmRequest {
  const note = [
    '## 근거 확인 실패 — 다시 판단',
    '아래 조건은 충족(또는 요구하지 않음)으로 판단했지만 코드가 그 판단을 확인하지 못했다. 이 조건들을 다시 판단하라.',
    `- file에는 "### 파일:" 뒤의 경로를 그대로 쓴다: ${files.join(', ')}`,
    '- quote에는 그 파일에서 이 조건의 내용을 직접 보여 주는 한 문장이나 한 줄을 고치지 않고 짧게 복사한다. 여러 곳을 이어 붙이거나 따옴표를 더하지 않는다. 근거가 없으면 met=false로 둔다.',
    '- 제외·한정 범위의 낱말이 들어 있지 않은 조건은 요구하지 않는 조건이 아니다(exempt=false). 결과에서 근거를 찾아 판단한다.',
    ...failed.map(({ index, condition, check }) => `${index}. ${condition} — ${check.reason}`),
  ].join('\n');
  const [first, ...rest] = request.messages;
  return { ...request, messages: [{ ...first!, content: `${first!.content}\n${note}` }, ...rest] };
}

/** What a person can do about a review that could not finish (M11 T1): both are buttons and chat requests. */
const RECOVERY = "'다시 검토'로 검토를 다시 돌리거나, 결정권자가 결과를 보고 '이대로 확인'할 수 있어요.";
const JUDGE_FAILED = `결과 인계 판단을 마치지 못했습니다(결과 내용이 아니라 검토 과정의 문제예요). ${RECOVERY}`;
const JUDGE_FAILED_CAUSE = '검토 응답을 받지 못한 문제';

/** One condition's standing after code checked the model's verdict on it. */
type Assessment = { kind: 'waived'; keyword: string; reason: string } | { kind: 'verified'; file: string; quote: string }
  | { kind: 'unproven'; check: Unproven } | { kind: 'missing'; detail: string };

export async function judgeHandoff(input: JudgeInput): Promise<JudgeOutcome> {
  const { state, result, resultContent, decisions } = input;
  const base = { taskId: result.taskId, resultId: result.resultId };
  const problems = structuralProblems(state, result, resultContent);
  if (problems.length) return { ok: true, llmCalls: 0, review: { ...base, verdict: 'insufficient', met: [], missing: problems, evidence: [] } };
  const conditions = [...(state.tasks.get(result.taskId)?.spec.handoffConditions ?? []), ...(input.requests ?? [])];
  if (!conditions.length && !decisions.length) return { ok: true, llmCalls: 0, review: { ...base, verdict: 'sufficient', met: [], missing: [], evidence: [] } };

  const request = buildRequest(input, conditions);
  const first = await askModel(input, request);
  let llmCalls = first.calls;
  if (!first.verdict) return { ok: false, llmCalls, error: JUDGE_FAILED, cause: JUDGE_FAILED_CAUSE };
  const items = new Map(first.verdict.conditions.map((entry) => [entry.index, entry]));
  const { exclusions, limits } = taskScope(state.tasks.get(result.taskId)?.spec ?? {});
  const scope = [...exclusions, ...limits];

  /**
   * The model judges each condition; code only checks what it can (M12 V1, W3): an exemption needs the
   * cut's keyword in the condition, a met condition needs its quote in a result file and related to it.
   */
  const assess = (i: number): Assessment => {
    const item = items.get(i + 1);
    const condition = conditions[i]!;
    const missing = (): Assessment => ({ kind: 'missing', detail: peopleText(item?.missing?.trim() ?? '') });
    if (!item) return missing();
    const quoted = item.met && !!item.quote?.trim();
    if (item.exempt) {
      const keyword = scopeKeywordIn(condition, scope);
      if (keyword) return { kind: 'waived', keyword, reason: peopleText(item.reason?.trim() ?? '') };
      if (!item.met) return missing();
      if (!quoted) return { kind: 'unproven', check: { cause: CAUSE.exemption,
        reason: scope.length ? `요구하지 않는다고 판단했지만 조건 문장에 제외·한정 범위(${scope.join(', ')})의 낱말이 없어 면제할 수 없음 — 결과에서 근거를 인용해 판단해야 함` : '제외·한정 범위가 없는데 조건을 요구하지 않는다고 판단함' } };
    }
    if (!item.met) return missing();
    const c = checkCitation(item.file, item.quote, resultContent, result.artifactIds);
    if (c.kind !== 'verified') return { kind: 'unproven', check: { reason: c.reason, cause: CAUSE.citation } };
    if (!quoteRelevant(condition, item.quote ?? '', resultContent[c.file] as string)) {
      return { kind: 'unproven', check: { cause: CAUSE.relevance, reason: '인용이 조건과 관련 없음: 조건의 핵심 낱말이 인용과 그 주변에 없음' } };
    }
    return { kind: 'verified', file: c.file, quote: item.quote ?? '' };
  };
  const citationFailures: CitationFailure[] = [];
  const record = (i: number, check: Unproven, prefix: string) => {
    citationFailures.push({ condition: conditions[i]!, file: items.get(i + 1)?.file ?? '', quote: items.get(i + 1)?.quote ?? '', reason: `${prefix}${check.reason}` });
  };

  // A technical failure is recorded for the PM and re-judged once; it never becomes a request to the person.
  const technical = conditions.flatMap((condition, i) => { const a = assess(i); return a.kind === 'unproven' ? [{ index: i + 1, condition, check: a.check }] : []; });
  if (technical.length) {
    for (const { index, check } of technical) record(index - 1, check, '기술적 검증 실패(재판단): ');
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
  const unverified: { index: number; cause: string }[] = [];
  conditions.forEach((condition, i) => {
    const a = assess(i);
    if (a.kind === 'waived') {
      met.push(condition);
      evidence.push(`조건 ${i + 1}${particle(String(i + 1), '이/가') === '이' ? '은' : '는'} 제외·한정한 범위(${a.keyword})를 요구해 요구하지 않음${a.reason ? ` — ${a.reason}` : ''}: ${condition}`);
    } else if (a.kind === 'verified') {
      // The model's "met" counts only when its quote is really in a result file and about the condition.
      met.push(condition);
      evidence.push(`${condition} ← ${a.file}: "${squash(a.quote)}"`);
    } else if (a.kind === 'unproven') {
      record(i, a.check, '재판단 후에도 기술적 검증 실패: ');
      unverified.push({ index: i, cause: a.check.cause });
    } else {
      // The request carries the gap; the full condition stays in the judgement record (QA3 C5).
      missing.push(`${conditionLabel(i, condition)}: ${a.detail || '이 조건을 다루는 내용을 결과 파일에 추가해 주세요.'}`);
      evidence.push(`미충족 조건 ${i + 1}: ${condition}`);
    }
  });
  const known = new Map(decisions.map((d) => [d.decisionId, d]));
  for (const conflict of first.verdict.conflicts) {
    const decision = known.get(conflict.decisionId);
    if (!decision) continue;
    missing.push(`확정 결정(${shortName(decision.summary)})과 어긋납니다: ${peopleText(conflict.detail)}`);
    evidence.push(`어긋난 확정 결정 ${decision.decisionId}: ${decision.summary}`);
  }
  const failures = citationFailures.length ? { citationFailures } : {};
  // With a real gap the revision covers it and the unverified condition is judged again on resubmission;
  // with none, an unverifiable "met" is neither a pass nor the person's fault, so a person decides.
  if (unverified.length && !missing.length) {
    const cause = unverified.map(({ index, cause: why }) => `${conditionLabel(index, conditions[index]!)}의 ${why}`).join(', ');
    return { ok: false, llmCalls, ...failures, cause, error: `결과 인계 판단 중 ${cause} 때문에 확인을 마치지 못했습니다. 결과 내용이 아니라 검토 과정의 문제예요. ${RECOVERY}` };
  }
  return { ok: true, llmCalls, review: { ...base, verdict: missing.length || unverified.length ? 'insufficient' : 'sufficient', met, missing, evidence, ...failures } };
}

const pm = { kind: 'pm' as const, id: 'pm' };
export const reviewKey = (resultId: Id) => `handoff:${resultId}`;

/** The review record plus its consequence; re-checks blockers against the state it is appended to. */
export function handoffEvents(state: ProjectState, review: HandoffReview, ctx: EventContext): NewLedgerEvent[] {
  const blockers = review.verdict === 'sufficient' ? handoffBlockers(state, review.taskId, review.resultId).map(blockerText) : [];
  const final: HandoffReview = blockers.length ? { ...review, verdict: 'insufficient', missing: [...review.missing, ...blockers] } : review;
  const recorded: NewLedgerEvent = { ...ctx, type: 'handoff_reviewed', actor: pm, idempotencyKey: reviewKey(review.resultId), payload: final };
  const outcome = final.verdict === 'sufficient'
    ? { ...checkResult(state, final.taskId, final.resultId, `인계 조건 충족: ${final.met.join('; ') || '확인할 조건 없음'}`, ctx), idempotencyKey: `checked:${final.resultId}` }
    : { ...requestRevision(state, final.taskId, final.resultId, final.missing, ctx), idempotencyKey: `revision:${final.resultId}` };
  return [recorded, outcome];
}
