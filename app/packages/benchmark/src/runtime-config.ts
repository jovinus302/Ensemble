/** Shared worker development instructions. Transport/reporting is an orchestration concern. */
export const DEVELOPMENT_SYSTEM = [
  'Implement the requested development task in the supplied React starter workspace.',
  'Follow the task requirements and preserve the provided project structure and test contracts.',
  'Edit source files only within the assigned workspace. The external harness runs builds and browser checks.',
  'Do not install dependencies, access external networks, change authentication or permissions, make payments, commit, or publish.',
  'Do not delegate to other agents. If a tool is denied, do not retry it or bypass the restriction.',
  'State any unfinished work or unverified behavior accurately.',
].join('\n');
export const CODEX_RESTRICTIONS = [
  '-c', 'mcp_servers.node_repl.enabled=false', '-c', 'features.multi_agent=false',
  '-c', 'features.multi_agent_v2=false', '-c', 'web_search="disabled"',
];
export const codexWorkerArgs = (effort: string) => ['app-server', ...CODEX_RESTRICTIONS, '-c', `model_reasoning_effort="${effort}"`];
export const CLAUDE_DISALLOWED = ['Agent', 'Task', 'WebSearch', 'WebFetch'];
