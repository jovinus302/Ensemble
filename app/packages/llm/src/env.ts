import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ModelRole } from "./types.ts";

const DEFAULT_MODEL = "claude-sonnet-5";

/**
 * Loads the nearest `.env` walking up from `start` (the repo root keeps the proxy URL and key).
 * Values already present in process.env win.
 */
export function loadEnv(start: string = process.cwd()): string | undefined {
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

export function modelFor(role: ModelRole): string {
  const byRole = role === "pm" ? process.env.ENSEMBLE_MODEL_PM : process.env.ENSEMBLE_MODEL_AGENT;
  return byRole || process.env.ENSEMBLE_MODEL || DEFAULT_MODEL;
}
