import type { NextConfig } from "next";

const config: NextConfig = {
  // `next dev` must not write AGENTS.md / CLAUDE.md into the app (they would show up as untracked repo files).
  agentRules: false,
  // Workspace packages ship TypeScript source.
  transpilePackages: [
    "@ensemble/core",
    "@ensemble/store",
    "@ensemble/llm",
    "@ensemble/channel",
    "@ensemble/agents",
    "@ensemble/orchestrator",
    "@ensemble/scenarios",
  ],
};

export default config;
