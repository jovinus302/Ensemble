import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CliError, DEFAULT_CLI_TIMEOUT_MS, dropStrictNulls, forcedTool, parseJsonObject, renderPrompt, runCli, strictSchema, type CliProviderOptions } from "./cli.ts";
import type { LlmProvider, LlmRequest, LlmResponse } from "./types.ts";

interface CodexEvent {
  type?: string;
  thread_id?: string;
  message?: string;
  error?: { message?: string };
  usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number };
}

/**
 * Codex CLI (`codex exec`), one ephemeral read-only run per request in an empty temporary folder.
 * Codex has no system prompt flag, so the system part leads the prompt. The forced tool becomes
 * `--output-schema` in OpenAI's strict form; omitted optional fields come back as null and are dropped.
 */
export class CodexCliProvider implements LlmProvider {
  constructor(private readonly options: CliProviderOptions = {}) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const tool = forcedTool(request);
    const dir = await mkdtemp(path.join(this.options.cwd ?? tmpdir(), "ensemble-pm-codex-"));
    try {
      const lastMessage = path.join(dir, "last-message.txt");
      const schemaFile = path.join(dir, "schema.json");
      if (tool) await writeFile(schemaFile, JSON.stringify(strictSchema(tool.inputSchema)));
      const args = [
        ...(this.options.executableArgs ?? []),
        "exec", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", "--color", "never", "--json",
        "-C", dir, "-o", lastMessage,
        ...(this.options.model ? ["-m", this.options.model] : []),
        ...(this.options.effort ? ["-c", `model_reasoning_effort="${this.options.effort}"`] : []),
        ...(tool ? ["--output-schema", schemaFile] : []),
        "-",
      ];
      const run = await runCli(this.options.executable ?? "codex", args, renderPrompt(request, { includeSystem: true }), {
        cwd: dir, env: this.options.env, timeoutMs: this.options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS, label: "Codex CLI", signal: request.signal });
      const events = run.stdout.split("\n").flatMap(line => { try { return [JSON.parse(line) as CodexEvent]; } catch { return []; } });
      const failed = events.findLast(e => e.type === "turn.failed")?.error?.message ?? events.findLast(e => e.type === "error")?.message;
      const completed = events.findLast(e => e.type === "turn.completed");
      if (run.code !== 0 || !completed) throw new CliError(`Codex CLI 호출이 실패했습니다: ${failed ?? (run.stderr.trim() || `종료 코드 ${run.code ?? run.signal}`)}`, run);
      let text: string;
      try { text = await readFile(lastMessage, "utf8"); }
      catch { throw new CliError("Codex CLI가 최종 응답을 남기지 않았습니다", run); }
      const usage = completed.usage ?? {};
      return {
        text: tool ? "" : text.trim(),
        toolCalls: tool ? [{ name: tool.name, input: dropStrictNulls(parseJsonObject(text), tool.inputSchema) as Record<string, unknown> }] : [],
        model: this.options.model ?? "codex-cli",
        responseId: events.find(e => e.type === "thread.started")?.thread_id ?? "",
        usage: { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 },
      };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => { /* A scanner may still hold the folder; it is temporary. */ });
    }
  }
}
