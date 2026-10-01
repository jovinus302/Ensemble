import { AnthropicProvider } from "./anthropic.ts";
import { ClaudeCliProvider } from "./claude-cli.ts";
import { CodexCliProvider } from "./codex-cli.ts";
import type { LlmProvider } from "./types.ts";

export type PmRuntime = "api" | "codex" | "claude";
export const DEFAULT_PM_TIMEOUT_MINUTES = 5;
/** A PM call is a short judgement; the CLIs' own (often high) effort defaults make each call slow. */
export const DEFAULT_PM_CLI_EFFORT = "medium";

/**
 * Selects the PM model backend, mirroring ENSEMBLE_AGENT_RUNTIME:
 * - ENSEMBLE_PM_RUNTIME: api (default, Anthropic Messages API through the proxy), codex, or claude.
 * - ENSEMBLE_MODEL_PM: the model. The CLI runtimes keep their own default model unless it is set,
 *   since the api fallback (ENSEMBLE_MODEL, claude-sonnet-5) names a proxy model.
 * - ENSEMBLE_PM_EFFORT: CLI reasoning effort (default medium).
 * - ENSEMBLE_PM_TIMEOUT_MINUTES: limit of one CLI call (default 5).
 */
export function pmRuntimeFromEnv(env: NodeJS.ProcessEnv = process.env): { runtime: PmRuntime; llm: LlmProvider } {
  const runtime = (env.ENSEMBLE_PM_RUNTIME?.trim() || "api") as PmRuntime;
  if (!["api", "codex", "claude"].includes(runtime)) throw new Error("ENSEMBLE_PM_RUNTIME must be api, codex, or claude");
  if (runtime === "api") return { runtime, llm: new AnthropicProvider() };
  const minutesText = env.ENSEMBLE_PM_TIMEOUT_MINUTES?.trim();
  const minutes = minutesText ? Number(minutesText) : DEFAULT_PM_TIMEOUT_MINUTES;
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("ENSEMBLE_PM_TIMEOUT_MINUTES must be a positive number");
  const model = env.ENSEMBLE_MODEL_PM?.trim();
  const options = { ...(model ? { model } : {}), effort: env.ENSEMBLE_PM_EFFORT?.trim() || DEFAULT_PM_CLI_EFFORT, timeoutMs: Math.round(minutes * 60_000) };
  return { runtime, llm: runtime === "codex" ? new CodexCliProvider(options) : new ClaudeCliProvider(options) };
}
