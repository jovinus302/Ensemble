import { homedir } from 'node:os';
import path from 'node:path';

export const DEFAULT_TURN_TIMEOUT_MINUTES = 20;

export interface CodexRuntimeSettings {
  /** Per-agent folders live at <workspaceRoot>/<projectId>/<agentId>. */
  workspaceRoot: string;
  turnTimeoutMs: number;
}

/** Reads ENSEMBLE_AGENT_WORKSPACE_ROOT and ENSEMBLE_AGENT_TURN_TIMEOUT_MINUTES. The model is left to the user's Codex default. */
export function codexSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): CodexRuntimeSettings {
  const minutesText = env.ENSEMBLE_AGENT_TURN_TIMEOUT_MINUTES?.trim();
  const minutes = minutesText ? Number(minutesText) : DEFAULT_TURN_TIMEOUT_MINUTES;
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('ENSEMBLE_AGENT_TURN_TIMEOUT_MINUTES must be a positive number');
  const root = env.ENSEMBLE_AGENT_WORKSPACE_ROOT?.trim();
  return { workspaceRoot: path.resolve(root || path.join(homedir(), 'ensemble-agent-workspaces')), turnTimeoutMs: Math.round(minutes * 60_000) };
}
