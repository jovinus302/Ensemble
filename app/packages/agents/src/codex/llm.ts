import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Ajv } from 'ajv';
import type { LlmProvider, LlmRequest, LlmResponse } from '@ensemble/llm';
import { CodexAppServerClient, type CodexTurn } from './app-server.ts';
import type { RpcOptions } from './rpc.ts';

export type CodexLlmErrorCode = 'cancelled' | 'timeout' | 'transport' | 'model' | 'schema' | 'closed';
export class CodexLlmError extends Error {
  constructor(readonly code: CodexLlmErrorCode) { super(`Codex PM ${code}`); this.name = 'CodexLlmError'; }
}
export interface PmTiming { operation: string; elapsedMs: number; firstResponseMs?: number; modelMs?: number; outcome: string }
export interface CodexLlmOptions {
  rpc?: RpcOptions;
  timeoutMs?: number;
  effort?: string;
  onTiming?: (timing: PmTiming) => void;
}

/** Preserve the original schema for validation. Optional properties become nullable for strict output. */
export function strictOutputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(schema);
  const visit = (s: Record<string, any>): Record<string, any> => {
    if (!s.type && ('const' in s || s.enum?.length)) {
      const values = 'const' in s ? [s.const] : s.enum;
      const types = [...new Set(values.map((v: unknown) => v === null ? 'null' : typeof v))];
      s.type = types.length === 1 ? types[0] : types;
    }
    if (s.oneOf) { s.anyOf = s.oneOf; delete s.oneOf; }
    if (Array.isArray(s.enum) && !s.enum.length) { delete s.enum; s.type = 'null'; }
    if (s.properties) {
      const required = new Set(s.required ?? []);
      s.properties = Object.fromEntries(Object.entries(s.properties).map(([key, value]) => {
        const child = visit(value as Record<string, any>);
        return [key, required.has(key) ? child : { anyOf: [child, { type: 'null' }] }];
      }));
      s.required = Object.keys(s.properties); s.additionalProperties = false;
    }
    if (s.items && typeof s.items === 'object') s.items = visit(s.items);
    if (s.anyOf) s.anyOf = s.anyOf.map(visit);
    return s;
  };
  return visit(copy);
}
function omitOptionalNulls(value: any, schema: any): any {
  if (Array.isArray(value)) return value.map(v => omitOptionalNulls(v, schema.items ?? {}));
  if (!value || typeof value !== 'object') return value;
  const branch = (schema.oneOf ?? schema.anyOf)?.find((s: any) => s.properties?.type?.const === value.type);
  const s = branch ?? schema;
  return Object.fromEntries(Object.entries(value).filter(([k, v]) => v !== null || !s.properties?.[k] || s.required?.includes(k))
    .map(([k, v]) => [k, omitOptionalNulls(v, s.properties?.[k] ?? {})]));
}

/** Login-backed PM judgments. No API fallback, no worker/file-writing privileges. */
export class CodexLlmProvider implements LlmProvider {
  private readonly active = new Set<AbortController>();
  private readonly pending = new Set<Promise<unknown>>();
  private closed = false;
  private readonly ajv = new Ajv({ strict: false, allErrors: true, validateSchema: false });
  constructor(private readonly options: CodexLlmOptions = {}) {
    if (!Number.isFinite(options.timeoutMs ?? 90_000) || (options.timeoutMs ?? 90_000) <= 0) throw new Error('PM timeout must be positive');
  }
  complete(request: LlmRequest): Promise<LlmResponse> {
    const promise = this.run(request);
    this.pending.add(promise);
    void promise.finally(() => this.pending.delete(promise)).catch(() => undefined);
    return promise;
  }
  private async run(request: LlmRequest): Promise<LlmResponse> {
    if (this.closed) throw new CodexLlmError('closed');
    const controller = new AbortController();
    const cancel = () => controller.abort(new CodexLlmError('cancelled'));
    request.signal?.addEventListener('abort', cancel, { once: true });
    if (request.signal?.aborted) cancel();
    this.active.add(controller);
    const started = Date.now();
    let firstResponseMs: number | undefined, modelStarted: number | undefined;
    let outcome = 'completed';
    let client: CodexAppServerClient | undefined, cwd: string | undefined, threadId: string | undefined, turnId: string | undefined;
    const timer = setTimeout(() => controller.abort(new CodexLlmError('timeout')), this.options.timeoutMs ?? 90_000);
    let rejectAbort!: (reason: unknown) => void;
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const onAbort = () => rejectAbort(controller.signal.reason);
    controller.signal.addEventListener('abort', onAbort, { once: true });
    if (controller.signal.aborted) onAbort();
    let operation: Promise<LlmResponse> | undefined;
    try {
      operation = (async () => {
        cwd = await mkdtemp(path.join(tmpdir(), 'ensemble-pm-'));
        controller.signal.throwIfAborted();
        client = new CodexAppServerClient({ ...this.options.rpc, cwd });
        const terminal = new Map<string, CodexTurn>();
        let finish: ((turn: CodexTurn) => void) | undefined;
        let fail: ((error: Error) => void) | undefined;
        client.onFailure(() => fail?.(new CodexLlmError('transport')));
        client.on('turn/completed', ({ turn }) => { terminal.set(turn.id, turn); if (turn.id === turnId) finish?.(turn); });
        client.on('item/agentMessage/delta', () => { firstResponseMs ??= Date.now() - started; });
        await client.initialize();
        controller.signal.throwIfAborted();
        threadId = await client.threadStart({ cwd, sandbox: 'read-only', approvalPolicy: 'never', ephemeral: true,
          ...(request.model ? { model: request.model } : {}),
          baseInstructions: 'You are the Ensemble project manager. Judge only the supplied data. Return the requested JSON or text. Do not use tools, inspect files, run commands, or access the network.',
          developerInstructions: request.system,
          config: { 'features.shell_tool': false, 'features.apply_patch_freeform': false, 'features.multi_agent': false,
            'features.apps': false, 'features.code_mode': false, 'web_search': 'disabled', 'project_doc_max_bytes': 0 },
        });
        controller.signal.throwIfAborted();
        const tool = request.tools?.find(t => t.name === request.forceTool);
        if (request.tools?.length && !tool) throw new CodexLlmError('schema');
        const schema = tool?.inputSchema;
        const validate = schema ? this.ajv.compile(schema) : undefined;
        modelStarted = Date.now();
        const completed = new Promise<CodexTurn>((resolve, reject) => { finish = resolve; fail = reject; });
        void completed.catch(() => undefined);
        // An abort can occur before turn/start replies; process cleanup still cancels that request.
        turnId = await client.turnStart({ threadId, effort: this.options.effort ?? 'low',
          text: JSON.stringify({ messages: request.messages, ...(tool ? { response: { name: tool.name, description: tool.description, schema } } : {}) }),
          ...(schema ? { outputSchema: strictOutputSchema(schema) } : {}),
        });
        if (terminal.has(turnId)) finish!(terminal.get(turnId)!);
        const turn = await completed;
        if (turn.status !== 'completed') throw new CodexLlmError(turn.status === 'interrupted' ? 'cancelled' : 'model');
        const text = turn.items.filter(i => i.type === 'agentMessage' && i.phase !== 'commentary').map(i => i.text).join('\n');
        let input: Record<string, unknown> | undefined;
        if (schema) {
          try { input = omitOptionalNulls(JSON.parse(text), schema); } catch { throw new CodexLlmError('schema'); }
          if (!validate!(input)) throw new CodexLlmError('schema');
        }
        return { text: tool ? '' : text, toolCalls: tool && input ? [{ name: tool.name, input }] : [],
          model: request.model || 'codex-default', responseId: turn.id, usage: { inputTokens: 0, outputTokens: 0 } };
      })();
      return await Promise.race([aborted, operation]);
    } catch (error) {
      const safe = error instanceof CodexLlmError ? error : new CodexLlmError('transport');
      outcome = safe.code; throw safe;
    } finally {
      clearTimeout(timer); request.signal?.removeEventListener('abort', cancel);
      controller.signal.removeEventListener('abort', onAbort); this.active.delete(controller);
      if (controller.signal.aborted && client && threadId && turnId) {
        await Promise.race([client.turnInterrupt({ threadId, turnId }).catch(() => undefined), new Promise(r => setTimeout(r, 250))]);
      }
      await client?.close();
      await operation?.catch(() => undefined);
      if (cwd) await rm(cwd, { recursive: true, force: true });
      this.options.onTiming?.({ operation: request.forceTool ?? 'text', elapsedMs: Date.now() - started, firstResponseMs,
        modelMs: modelStarted ? Date.now() - modelStarted : undefined, outcome });
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const controller of this.active) controller.abort(new CodexLlmError('cancelled'));
    await Promise.allSettled(this.pending);
  }
}
