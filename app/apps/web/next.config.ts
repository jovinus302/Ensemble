import type { NextConfig } from "next";

const config: NextConfig = {
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
