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
/** An LLM failure is not a verdict: it goes to a person instead of becoming a revision request. */
export type JudgeOutcome = { ok: true; review: HandoffReview; llmCalls: number } | { ok: false; error: string; llmCalls: number };

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
  '- 근거를 찾지 못했거나 확실하지 않으면 met=false로 두고, missing에 무엇을 보완해야 하는지 구체적으로 쓴다.',
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

export async function judgeHandoff(input: JudgeInput): Promise<JudgeOutcome> {
  const { state, result, resultContent, decisions } = input;
  const base = { taskId: result.taskId, resultId: result.resultId };
  const problems = structuralProblems(state, result, resultContent);
  if (problems.length) return { ok: true, llmCalls: 0, review: { ...base, verdict: 'insufficient', met: [], missing: problems, evidence: [] } };
  const conditions = state.tasks.get(result.taskId)?.spec.handoffConditions ?? [];
  if (!conditions.length && !decisions.length) return { ok: true, llmCalls: 0, review: { ...base, verdict: 'sufficient', met: [], missing: [], evidence: [] } };

  const { verdict, calls, error } = await askModel(input, buildRequest(input, conditions));
  if (!verdict) return { ok: false, llmCalls: calls, error: `결과 인계 판단을 마치지 못했습니다. 사람이 확인해 주세요.` };
  const met: string[] = [];
  const missing: string[] = [];
  const evidence: string[] = [];
  const citationFailures: NonNullable<HandoffReview['citationFailures']> = [];
  conditions.forEach((condition, i) => {
    const item = verdict.conditions.find((entry) => entry.index === i + 1);
    const file = item?.file ?? '';
    const quote = squash(item?.quote ?? '');
    const content = resultContent[file];
    // The model's "met" counts only when its quote is really in the named result file.
    if (item?.met && quote && typeof content === 'string' && squash(content).includes(quote)) {
      met.push(condition);
      evidence.push(`${condition} ← ${file}: "${quote}"`);
    } else if (item?.met) {
      citationFailures.push({ condition, file, quote: item.quote ?? '', reason: !quote ? '인용문이 비어 있음' : typeof content !== 'string' ? '지정한 결과 파일이 없음' : '정규화 후에도 인용문이 결과 파일에 없음' });
      missing.push(`인계 조건 "${condition}"의 근거를 결과에서 확인하지 못했습니다. 이 조건을 다루는 내용을 ${file || '결과 파일'}에 분명히 적어 주세요.`);
    } else {
      const detail = item?.missing?.trim();
      missing.push(`인계 조건 "${condition}"${particle(condition, '이/가')} 충족되지 않았습니다. ${detail || '이 조건을 다루는 내용을 결과 파일에 추가해 주세요.'}`);
    }
  });
  const known = new Map(decisions.map((d) => [d.decisionId, d]));
  for (const conflict of verdict.conflicts) {
    const decision = known.get(conflict.decisionId);
    if (decision) missing.push(`확정 결정 "${decision.summary}"과 어긋납니다: ${conflict.detail}`);
  }
  return { ok: true, llmCalls: calls, review: { ...base, verdict: missing.length ? 'insufficient' : 'sufficient', met, missing, evidence, ...(citationFailures.length ? { citationFailures } : {}) } };
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
