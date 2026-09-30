import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { agentRoles, codexSettingsFromEnv, CodexSessionConnector, prototypeAgentRole, researchAgentRole, type SessionEvent } from '../src/index.ts';
import type { TaskInstructionsInput } from '../src/protocol.ts';

const task: TaskInstructionsInput = { taskId: 'task', planVersion: 1, goalSummary: { text: 'Goal', sourceId: 'goal' },
  taskTitle: { text: '대안 2개를 표로', sourceId: 'plan' }, handoffConditions: [], decisions: [], inputs: [], openQuestions: [] };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(fn => fn())); });
async function fixture(mode: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'ensemble-roles-'));
  const connector = new CodexSessionConnector({ workspaceRoot: root, rpc: { command: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/fake-app-server.mjs', import.meta.url))], env: { ...process.env, ENSEMBLE_FAKE_PROTOCOL: mode } } });
  cleanup.push(async () => { await connector.stop(); await rm(root, { recursive: true, force: true }); });
  const events: SessionEvent[] = []; connector.onEvent(event => events.push(event));
  return { connector, events, root };
}

it('registers Korean research and prototype roles with their reporting rules', () => {
  expect(agentRoles.get('research-agent')).toBe(researchAgentRole);
  expect(agentRoles.get('prototype-agent')).toBe(prototypeAgentRole);
  expect(researchAgentRole.systemPrompt).toMatch(/출처/);
  expect(researchAgentRole.systemPrompt).toMatch(/웹 검색/);
  expect(prototypeAgentRole.systemPrompt).toMatch(/단일 HTML/);
  for (const role of [researchAgentRole, prototypeAgentRole]) expect(role.systemPrompt).toMatch(/작업 폴더 안에만/);
  // QA3 N9: review labels from other instructions stay out of what people read; a PM revision is acknowledged and resubmitted.
  for (const role of [researchAgentRole, prototypeAgentRole]) expect(role.systemPrompt).toMatch(/SOUND, PASS\/FAIL, COMMITTED CHANGE.*쓰지 않습니다/);
  for (const role of [researchAgentRole, prototypeAgentRole]) expect(role.systemPrompt).toMatch(/보완을 요청하면 acknowledge_update/);
});

it('reads workspace root and turn limit from the environment, defaulting to 20 minutes under home', () => {
  expect(codexSettingsFromEnv({})).toEqual({ workspaceRoot: path.join(homedir(), 'ensemble-agent-workspaces'), turnTimeoutMs: 20 * 60_000 });
  expect(codexSettingsFromEnv({ ENSEMBLE_AGENT_TURN_TIMEOUT_MINUTES: '0.5', ENSEMBLE_AGENT_WORKSPACE_ROOT: 'C:/agents' }))
    .toEqual({ workspaceRoot: path.resolve('C:/agents'), turnTimeoutMs: 30_000 });
  expect(() => codexSettingsFromEnv({ ENSEMBLE_AGENT_TURN_TIMEOUT_MINUTES: 'soon' })).toThrow('positive');
});

it('starts the role thread in <root>/<project>/<agent> with the role as developer instructions', async () => {
  const { connector, events, root } = await fixture('instructions');
  const session = await connector.startSession('research-agent', 'roles-project');
  expect(session.workspace).toBe(path.join(await realpath(root), 'roles-project', 'research-agent'));
  await connector.startTask('research-agent', task);
  await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({ type: 'reply', text: `developer: ${researchAgentRole.systemPrompt}` })));
});

it('ends the running turn as failed with a reason when the app-server is lost', async () => {
  const { connector, events } = await fixture('crash');
  await connector.startSession('prototype-agent', 'roles-project');
  const turnId = await connector.startTask('prototype-agent', task);
  await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({ type: 'turn', turnId, status: 'failed', reason: expect.stringContaining('연결이 끊겼습니다') })));
});
