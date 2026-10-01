import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ModelRole } from "./types.ts";

const DEFAULT_MODEL = "claude-sonnet-5";

/**
 * Loads the nearest `.env` walking up from `start` (the repo root keeps the proxy URL and key).
 * Values already present in process.env win.
 */
export function loadEnv(start: string = process.cwd()): string | undefined {
  if (process.env.ENSEMBLE_ENV_FILE) {
    process.loadEnvFile(process.env.ENSEMBLE_ENV_FILE);
    return process.env.ENSEMBLE_ENV_FILE;
  }
  let dir = start;
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function modelFor(role: ModelRole, provider: 'anthropic' | 'codex' = 'anthropic'): string {
  const byRole = role === "pm" ? process.env.ENSEMBLE_MODEL_PM : process.env.ENSEMBLE_MODEL_AGENT;
  return byRole || process.env.ENSEMBLE_MODEL || (provider === 'codex' ? '' : DEFAULT_MODEL);
}
