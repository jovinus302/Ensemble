// Execution agents. An agent only produces output: it may call report_result / attach_evidence,
// but never writes the ledger, assigns work, or judges verification (docs/mvp-architecture.md §5).
import type { Id } from "@ensemble/core";
import type { ModelRole } from "@ensemble/llm";

export interface AgentRole {
  /** Stable key referenced by team templates, e.g. "research-agent". */
  key: string;
  displayName: string;
  /** What this agent is for; shown to the PM when it builds a plan. */
  capability: string;
  modelRole: ModelRole;
  systemPrompt: string;
}

/** What the agent hands back; the orchestrator turns it into ledger events. */
export interface AgentOutput {
  taskId: Id;
  summary: string;
  artifacts: { name: string; mimeType: string; content: string }[];
  /** Agent's own check of its output; recorded as agent_verified (reference only). */
  selfCheck?: string;
}

export const agentRoles = new Map<string, AgentRole>();

export function registerAgentRole(role: AgentRole): void {
  if (agentRoles.has(role.key)) throw new Error(`agent role already registered: ${role.key}`);
  agentRoles.set(role.key, role);
}

import { builtInRoles } from './roles.ts';
for (const role of builtInRoles) registerAgentRole(role);

export * from './session.ts';
export * from './protocol.ts';
export { CodexSessionConnector } from './codex/connector.ts';
export type { CodexConnectorOptions } from './codex/connector.ts';
export { builtInRoles, prototypeAgentRole, researchAgentRole, roleFor } from './roles.ts';
export { codexSettingsFromEnv, DEFAULT_TURN_TIMEOUT_MINUTES, type CodexRuntimeSettings } from './codex/settings.ts';
