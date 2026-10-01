import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { ClaudeSessionConnector } from '../src/claude/connector.ts';
import type { SessionEvent } from '../src/session.ts';
import type { ContinueTaskInput, TaskInstructionsInput, UpdateInstructionsInput } from '../src/protocol.ts';

const task: TaskInstructionsInput = { taskId: 'task', planVersion: 1, goalSummary: { text: 'Goal', sourceId: 'goal' },
  taskTitle: { text: 'Write sections', sourceId: 'plan' }, handoffConditions: [], decisions: [], inputs: [], openQuestions: [] };
const update: UpdateInstructionsInput = { updateId: 'u1', fromVersion: 1, toVersion: 2, keep: ['signup'], change: ['interests'], drop: ['결제'], reason: 'scope' };
const continuation: ContinueTaskInput = { taskId: 'task', planVersion: 2, update, task };

const connectors: ClaudeSessionConnector[] = [];
function fixture(mode = 'normal') {
  process.env.ENSEMBLE_FAKE_CLAUDE = mode;
  const connector = new ClaudeSessionConnector({ executable: process.execPath,
    executableArgs: [fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url))],
    workspaceRoot: mkdtempSync(path.join(tmpdir(), 'claude-connector-')) });
  connectors.push(connector);
  const events: SessionEvent[] = []; connector.onEvent(event => events.push(event));
  return { connector, events, agentId: `test-${randomUUID()}` };
}
afterEach(async () => { await Promise.all(connectors.splice(0).map(connector => connector.stop())); delete process.env.ENSEMBLE_FAKE_CLAUDE; });

async function turnEnded(events: SessionEvent[], turnId: string): Promise<SessionEvent> {
  for (let i = 0; i < 400; i++) {
    const done = events.find(e => e.type === 'turn' && e.turnId === turnId && e.status !== 'started');
    if (done) return done;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Turn ${turnId} never ended; events: ${JSON.stringify(events)}`);
}

it('runs a turn per CLI process, parses reports, resumes the thread, and acknowledges updates on continue', async () => {
  const { connector, events, agentId } = fixture();
  const [session, same] = await Promise.all([connector.startSession(agentId, 'claude-tests'), connector.startSession(agentId, 'claude-tests')]);
  expect(same).toEqual(session);
  await expect(connector.startSession(agentId, 'other')).rejects.toThrow('different project');
  const first = connector.startTask(agentId, task);
  await expect(connector.startTask(agentId, task)).rejects.toThrow('active or starting');
  const turnId = await first;
  expect(await turnEnded(events, turnId)).toMatchObject({ status: 'completed' });
  const reply = events.find(e => e.type === 'reply');
  expect(reply).toMatchObject({ text: expect.stringContaining('[session:new]') });
  expect(events).toContainEqual(expect.objectContaining({ type: 'report', report: expect.objectContaining({ type: 'result_report', taskId: 'task', planVersion: 1 }) }));
  expect(await connector.sendUpdate(agentId, update)).toEqual({ sent: false, reason: 'No active turn' });
  // The next turn resumes the same thread and sees the update before carrying on.
  const next = await connector.continueTask(agentId, continuation);
  expect(next).not.toBe(turnId);
  expect(await turnEnded(events, next)).toMatchObject({ status: 'completed' });
  expect(events).toContainEqual(expect.objectContaining({ type: 'reply', turnId: next, text: expect.stringContaining('[session:resume]') }));
  expect(events).toContainEqual(expect.objectContaining({ type: 'report', report: expect.objectContaining({ type: 'acknowledge_update', updateId: 'u1', planVersion: 2 }) }));
}, 30_000);

it('surfaces malformed reports and questions and rejects unsafe IDs', async () => {
  const { connector, events, agentId } = fixture('errors');
  await expect(connector.startSession('../escape', 'tests')).rejects.toThrow('IDs');
  await connector.startSession(agentId, 'claude-tests');
  const turnId = await connector.startTask(agentId, task);
  await turnEnded(events, turnId);
  expect(events).toContainEqual(expect.objectContaining({ type: 'parse_error' }));
  expect(events).toContainEqual(expect.objectContaining({ type: 'report', report: expect.objectContaining({ type: 'question' }) }));
}, 30_000);

it('reports a failed turn with the CLI error and frees the agent for the next turn', async () => {
  const { connector, events, agentId } = fixture('fail');
  await connector.startSession(agentId, 'claude-tests');
  const turnId = await connector.startTask(agentId, task);
  expect(await turnEnded(events, turnId)).toMatchObject({ status: 'failed', reason: expect.stringContaining('model unavailable') });
  await expect(connector.startTask(agentId, task)).resolves.toBeTruthy();
}, 30_000);

it('interrupts a running turn on stop and refuses mid-turn updates', async () => {
  const { connector, events, agentId } = fixture('hang');
  await connector.startSession(agentId, 'claude-tests');
  const turnId = await connector.startTask(agentId, task);
  expect(await connector.sendUpdate(agentId, update)).toMatchObject({ sent: false, reason: expect.stringContaining('턴') });
  await connector.stop(agentId);
  expect(await turnEnded(events, turnId)).toMatchObject({ status: 'interrupted' });
}, 30_000);

it('cancels a turn stopped during startup before the CLI spawns', async () => {
  const { connector, events, agentId } = fixture();
  await connector.startSession(agentId, 'claude-tests');
  const starting = connector.startTask(agentId, task);
  await connector.stop(agentId); // The turn is reserved; its input is still being prepared.
  const turnId = await starting;
  expect(await turnEnded(events, turnId)).toMatchObject({ status: 'interrupted' });
  await new Promise(resolve => setTimeout(resolve, 1500));
  expect(events.filter(e => e.turnId === turnId).map(e => e.type === 'turn' ? e.status : e.type)).toEqual(['interrupted']);
  await expect(connector.startTask(agentId, task)).resolves.toBeTruthy();
}, 30_000);

it('cancels a reserved turn when the whole connector stops', async () => {
  const { connector, events, agentId } = fixture();
  await connector.startSession(agentId, 'claude-tests');
  const starting = connector.startTask(agentId, task);
  await connector.stop();
  const turnId = await starting;
  expect(await turnEnded(events, turnId)).toMatchObject({ status: 'interrupted' });
  await new Promise(resolve => setTimeout(resolve, 1500));
  expect(events.some(e => e.turnId === turnId && (e.type === 'reply' || (e.type === 'turn' && e.status !== 'interrupted')))).toBe(false);
}, 30_000);

it('fails a turn whose result is flagged is_error with the readable result text, without replying the synthetic error', async () => {
  const { connector, events, agentId } = fixture('api-error');
  await connector.startSession(agentId, 'claude-tests');
  const turnId = await connector.startTask(agentId, task);
  expect(await turnEnded(events, turnId)).toMatchObject({ status: 'failed', reason: expect.stringContaining('issue with the selected model') });
  expect(events.some(e => e.type === 'reply')).toBe(false);
}, 30_000);

it('completes a turn whose final result reaches stdout after the process exited, ignoring a stderr warning', async () => {
  const { connector, events, agentId } = fixture('late');
  await connector.startSession(agentId, 'claude-tests');
  const turnId = await connector.startTask(agentId, task);
  expect(await turnEnded(events, turnId)).toMatchObject({ status: 'completed' });
  expect(events).toContainEqual(expect.objectContaining({ type: 'report', report: expect.objectContaining({ type: 'result_report' }) }));
}, 30_000);
