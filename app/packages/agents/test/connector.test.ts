import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { CodexSessionConnector } from '../src/codex/connector.ts';
import type { SessionEvent } from '../src/session.ts';
import type { TaskInstructionsInput, UpdateInstructionsInput } from '../src/protocol.ts';

const task: TaskInstructionsInput = { taskId: 'task', planVersion: 1, goalSummary: { text: 'Goal', sourceId: 'goal' },
  taskTitle: { text: 'Write sections', sourceId: 'plan' }, handoffConditions: [], decisions: [], inputs: [], openQuestions: [] };
const update: UpdateInstructionsInput = { updateId: 'u1', fromVersion: 1, toVersion: 2, keep: ['signup'], change: ['interests'], drop: ['결제'], reason: 'scope' };
const connectors: CodexSessionConnector[] = [];
function fixture(mode = 'normal') {
  const connector = new CodexSessionConnector({ rpc: { command: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/fake-app-server.mjs', import.meta.url))], env: { ...process.env, ENSEMBLE_FAKE_PROTOCOL: mode } } });
  connectors.push(connector);
  const events: SessionEvent[] = []; connector.onEvent(event => events.push(event));
  return { connector, events, agentId: `test-${randomUUID()}` };
}
afterEach(async () => { await Promise.all(connectors.splice(0).map(connector => connector.stop())); });

it('creates an external per-agent workspace, reserves concurrent starts, and parses mid-turn reports', async () => {
  const { connector, events, agentId } = fixture();
  const [session, same] = await Promise.all([connector.startSession(agentId, 'connector-tests'), connector.startSession(agentId, 'connector-tests')]);
  expect(same).toEqual(session);
  expect(session.workspace).toBe(path.join(homedir(), 'ensemble-agent-workspaces', 'connector-tests', agentId));
  expect(session.workspace.startsWith(process.cwd())).toBe(false);
  const first = connector.startTask(agentId, task);
  await expect(connector.startTask(agentId, task)).rejects.toThrow('active or starting');
  const turnId = await first;
  expect(await connector.sendUpdate(agentId, update)).toEqual({ sent: true });
  expect(events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'turn', turnId, status: 'started' }),
    expect.objectContaining({ type: 'report', report: expect.objectContaining({ type: 'acknowledge_update', updateId: 'u1' }) }),
    expect.objectContaining({ type: 'report', report: expect.objectContaining({ type: 'result_report', planVersion: 2 }) }),
    expect.objectContaining({ type: 'turn', turnId, status: 'completed' }),
  ]));
  expect(await connector.sendUpdate(agentId, update)).toEqual({ sent: false, reason: 'No active turn' });
  const next = await connector.startTask(agentId, task); expect(next).not.toBe(turnId);
  await connector.stop(agentId);
  expect(events).toContainEqual(expect.objectContaining({ type: 'turn', turnId: next, status: 'interrupted' }));
});

it('surfaces malformed reports and questions and prevents path traversal or cross-project reuse', async () => {
  const { connector, events, agentId } = fixture('errors');
  await expect(connector.startSession('../escape', 'tests')).rejects.toThrow('IDs');
  await connector.startSession(agentId, 'connector-tests');
  await expect(connector.startSession(agentId, 'other')).rejects.toThrow('different project');
  await connector.startTask(agentId, task);
  // The steer response is a deterministic barrier after all fixture reports.
  await connector.sendUpdate(agentId, update);
  expect(events).toContainEqual(expect.objectContaining({ type: 'parse_error' }));
  expect(events).toContainEqual(expect.objectContaining({ type: 'report', report: expect.objectContaining({ type: 'question' }) }));
});
