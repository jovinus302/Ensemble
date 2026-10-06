// Workstream D owns this file: the real-model side of `update_work_context` (docs/pages-v25-runtime-demo.md §5).
// The foundation commit ships a working minimum so the PM loop (workstream A) can call a model today;
// D tightens the schema and the prompt without changing the WorkContextToolOutput shape in @ensemble/core.
import { CONTEXT_LAYERS, WORK_CONTEXT_TOOL, type WorkContextFacts } from '@ensemble/core';
import type { ToolSpec } from '@ensemble/llm';

export const WORK_CONTEXT_SYSTEM_PROMPT = [
  '당신은 Ensemble PM입니다. 채널 대화에서 WORK CONTEXT(의도 → 결정 → 기능 → 화면 → 지표)를 읽고, update_work_context 도구 하나로만 답합니다.',
  '- 대화에 나온 전제를 항목으로 올리고, 같은 단계의 서로 다른 전제는 conflict, 한도를 넘는 기능은 violation, 정해지지 않은 것은 undecided, 아무도 말하지 않았지만 꼭 필요한 것은 missing으로 표시합니다.',
  '- 분기·Proposal 확정은 사람(결정권자)의 메시지가 있을 때만 기록합니다. 근거가 부족하면 facts.pool.candidates 중에서만 전문가를 찾아 초대합니다.',
  '- 제작 도구는 facts.tools에 연결된 것만 씁니다. 미리보기는 facts.basePreview를 고쳐서 씁니다.',
  '- 말할 필요가 없으면 ops와 speech를 비웁니다. 말할 때는 한국어로 한두 문장, 행동을 바꾸는 말만 합니다(docs/pm-principles.md).',
].join('\n');

/** Loose foundation schema; workstream D replaces it with the full per-op schema. */
export function workContextTool(): ToolSpec {
  return {
    name: WORK_CONTEXT_TOOL,
    description: 'WORK CONTEXT를 갱신하고(ops) 필요할 때만 채널에 말한다(speech). 비우면 침묵.',
    inputSchema: {
      type: 'object',
      required: ['ops', 'speech', 'reason'],
      properties: {
        ops: { type: 'array', items: { type: 'object', required: ['type'], properties: { type: { type: 'string' } } } },
        speech: { type: 'array', maxItems: 2, items: { type: 'object', required: ['text', 'kind'], properties: { text: { type: 'string' }, kind: { enum: ['fact', 'summary', 'ask', 'answer'] }, card: { type: 'object' } } } },
        reason: { type: 'string' },
      },
    },
  };
}

/** The user message for one PM turn. */
export function workContextUserMessage(facts: WorkContextFacts): string {
  return JSON.stringify({ layers: CONTEXT_LAYERS, facts });
}
