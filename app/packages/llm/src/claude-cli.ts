import { tmpdir } from "node:os";
import { CliError, DEFAULT_CLI_TIMEOUT_MS, forcedTool, parseJsonObject, renderPrompt, runCli, type CliProviderOptions } from "./cli.ts";
import type { LlmProvider, LlmRequest, LlmResponse } from "./types.ts";

interface ClaudeResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  stop_reason?: string;
  session_id?: string;
  uuid?: string;
  modelUsage?: Record<string, unknown>;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

/**
 * Claude Code CLI in print mode (`claude -p --output-format json`), one process per request.
 * No tools, no MCP servers, no user/project settings or hooks: the PM only reads and answers. The
 * forced tool becomes `--json-schema` structured output. `maxTokens` has no CLI flag and is not sent.
 */
export class ClaudeCliProvider implements LlmProvider {
  constructor(private readonly options: CliProviderOptions = {}) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const tool = forcedTool(request);
    const args = [
      ...(this.options.executableArgs ?? []),
      "-p", "--output-format", "json", "--no-session-persistence",
      "--tools", "", "--strict-mcp-config", "--setting-sources", "",
      ...(this.options.model ? ["--model", this.options.model] : []),
      ...(this.options.effort ? ["--effort", this.options.effort] : []),
      ...(request.system ? ["--system-prompt", request.system] : []),
      ...(tool ? ["--json-schema", JSON.stringify(tool.inputSchema)] : []),
    ];
    const run = await runCli(this.options.executable ?? "claude", args, renderPrompt(request, { includeSystem: false }), {
      cwd: this.options.cwd ?? tmpdir(), env: this.options.env, timeoutMs: this.options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS, label: "Claude CLI" });
    const result = lastResult(run.stdout);
    if (!result || result.is_error || result.subtype !== "success") {
      const reason = result?.result || result?.subtype || run.stderr.trim() || `종료 코드 ${run.code ?? run.signal}`;
      throw new CliError(`Claude CLI 호출이 실패했습니다: ${reason}`, run);
    }
    if (run.code !== 0) throw new CliError(`Claude CLI가 비정상 종료되었습니다 (code ${run.code ?? run.signal}): ${run.stderr.trim()}`, run);
    const text = typeof result.result === "string" ? result.result : "";
    let toolCalls: LlmResponse["toolCalls"] = [];
    if (tool) {
      const structured = result.structured_output;
      const input = structured && typeof structured === "object" && !Array.isArray(structured) ? structured as Record<string, unknown> : parseJsonObject(text);
      toolCalls = [{ name: tool.name, input }];
    }
    const usage = result.usage ?? {};
    return {
      text: tool ? "" : text,
      toolCalls,
      model: Object.keys(result.modelUsage ?? {})[0] ?? this.options.model ?? "claude-cli",
      responseId: result.uuid ?? result.session_id ?? "",
      ...(result.stop_reason ? { stopReason: result.stop_reason } : {}),
      usage: { inputTokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0), outputTokens: usage.output_tokens ?? 0 },
    };
  }
}

/** `--output-format json` prints one result object; a JSON array of events (older CLIs) ends with it. */
function lastResult(stdout: string): ClaudeResult | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  const candidates: unknown[] = [];
  try {
    const value = JSON.parse(trimmed) as unknown;
    candidates.push(...(Array.isArray(value) ? value : [value]));
  } catch {
    for (const line of trimmed.split("\n")) { try { candidates.push(JSON.parse(line)); } catch { /* noise */ } }
  }
  return candidates.filter((c): c is ClaudeResult => !!c && typeof c === "object" && (c as ClaudeResult).type === "result").at(-1);
}
