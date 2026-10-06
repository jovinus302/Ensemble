// The PM's Work Context turn (docs/pages-v25-runtime-demo.md §5): facts → one forced `update_work_context` call →
// core validation → one ledger transaction. The same path serves the fake PM and real models.
import { applyWorkContextOutput, project, workContextFacts, workContextTriggerId, WORK_CONTEXT_TOOL, type AnyEvent, type EventContext, type LedgerEvent, type WorkContextTrigger } from '@ensemble/core';
import type { LlmProvider } from '@ensemble/llm';
import type { LedgerStore } from '@ensemble/store';
import { WORK_CONTEXT_SYSTEM_PROMPT, workContextTool, workContextUserMessage } from './work-context-prompt.ts';

export interface WorkContextPmOptions extends EventContext {
  store: LedgerStore;
  llm: LlmProvider;
  model: string;
  clock?: () => Date;
  /** Every event a turn appended; the simulated pool and tools react to these. */
  onAppended?: (events: LedgerEvent[]) => void;
}
export interface WorkContextTurn { posts: { text: string; kind: 'fact' | 'summary' | 'ask' | 'answer' }[]; events: LedgerEvent[]; problems: string[] }

export const workContextConsiderationId = (trigger: WorkContextTrigger) => `context:${workContextTriggerId(trigger)}`;
const done = (events: readonly LedgerEvent[], considerationId: string) => (events as readonly AnyEvent[]).some(e => e.type === 'pm_considered' && e.payload.considerationId === considerationId);

export class WorkContextPm {
  constructor(private readonly options: WorkContextPmOptions) {}
  private get context(): EventContext { return { projectId: this.options.projectId, targetProductId: this.options.targetProductId }; }

  /** One PM turn for `trigger`; a trigger already considered (or a project without a Work Context) is a no-op. */
  async consider(trigger: WorkContextTrigger): Promise<WorkContextTurn> {
    const { store, llm, model } = this.options;
    const considerationId = workContextConsiderationId(trigger);
    const before = await store.read({ projectId: this.options.projectId });
    const facts = workContextFacts(project(before), trigger);
    if (!facts || done(before, considerationId)) return { posts: [], events: [], problems: [] };
    let output: unknown;
    try {
      const response = await llm.complete({ model, system: WORK_CONTEXT_SYSTEM_PROMPT, messages: [{ role: 'user', content: workContextUserMessage(facts) }], tools: [workContextTool()], forceTool: WORK_CONTEXT_TOOL, maxTokens: 8000 });
      output = response.toolCalls.find(call => call.name === WORK_CONTEXT_TOOL)?.input;
      if (!output) throw new Error('no tool call');
    } catch (error) {
      console.error('[ensemble] WORK CONTEXT 판단 실패', error instanceof Error ? error.message : error);
      const appended = await store.append([{ ...this.context, actor: { kind: 'pm', id: 'pm' }, type: 'judgement_failed', idempotencyKey: `${considerationId}:failed`,
        payload: { triggerId: workContextTriggerId(trigger), stage: 'interpretation', reason: '모델이 WORK CONTEXT 도구로 답하지 않았다' } }]);
      return { posts: [], events: appended, problems: ['모델 응답 없음'] };
    }
    const at = this.options.clock?.().toISOString();
    const { appended, result } = await store.transaction(this.options.projectId, rows => {
      if (done(rows, considerationId)) return { append: [], result: undefined };
      const applied = applyWorkContextOutput(rows, output, { context: this.context, trigger, considerationId, ...(at ? { at } : {}) });
      return { append: applied.append, result: applied };
    });
    if (result?.problems.length) console.info('[ensemble] WORK CONTEXT op 일부를 버렸습니다', JSON.stringify(result.problems));
    if (appended.length) this.options.onAppended?.(appended);
    return { posts: (result?.spoken ?? []).map(s => ({ text: s.text, kind: s.kind })), events: appended, problems: result?.problems ?? [] };
  }
}
