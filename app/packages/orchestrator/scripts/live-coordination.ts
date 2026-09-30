// One observational run. No prompt adjustment or hidden scripted PM responses.
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AnthropicProvider, loadEnv, modelFor, type LlmProvider } from '@ensemble/llm';
import { MemoryLedgerStore } from '@ensemble/store';
import { project, type AnyEvent, type EventPayloads } from '@ensemble/core';
import type { SessionConnector, UpdateInstructionsInput } from '@ensemble/agents';
import { SCENE_NOW, scene3, sceneEvents } from '@ensemble/scenarios';
import { ProjectManager, type PmPost } from '../src/pm.ts';
import { buildTaskContext } from '../src/context.ts';

const envFile = loadEnv();
if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set; loadEnv did not find usable proxy credentials');
const model = modelFor('pm');
const provider = new AnthropicProvider();
const calls: unknown[] = [];
const llm: LlmProvider = { async complete(request) {
  try {
    const response = await provider.complete(request);
    calls.push({ tool: request.forceTool, responseId: response.responseId, model: response.model, text: response.text, toolCalls: response.toolCalls, usage: response.usage });
    return response;
  } catch (error) {
    calls.push({ tool: request.forceTool, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
} };
const updates: { agentId: string; input: UpdateInstructionsInput }[] = [];
const connector: SessionConnector = {
  async startSession(agentId) { return { threadId: `fake:${agentId}`, workspace: '(fake)' }; },
  async startTask(_agentId, input) { return `fake-turn:${input.taskId}`; },
  async sendUpdate(agentId, input) { updates.push({ agentId, input }); return { sent: true }; },
  onEvent() { return () => {}; },
  async stop() {},
};
const context = { projectId: `live-pm-${Date.now()}`, targetProductId: 'prototype' };
const store = new MemoryLedgerStore();
await store.append(sceneEvents(3, context));
const pm = new ProjectManager({ ...context, store, connector, llm, model, clock: () => SCENE_NOW });
await pm.sessions.startSession('prototype-agent');
await pm.sessions.startTask('prototype-agent', buildTaskContext(project(await store.read()), 'prototype', await store.read()));
const directory = join(homedir(), 'ensemble-agent-workspaces', 'live-pm');
await mkdir(directory, { recursive: true });
const reportPath = join(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const rows: { author: string; message: string; messageId?: string; considerations: EventPayloads['pm_considered'][]; posts: PmPost[]; error?: string }[] = [];
const save = async () => {
  const events = await store.read() as AnyEvent[];
  const state = project(events);
  await writeFile(reportPath, JSON.stringify({ startedAt: context.projectId, model, envLoaded: !!envFile, forecastClock: SCENE_NOW, connector: 'fake', rows, finalPlanVersion: state.plan?.version, notifications: events.filter(e => e.type === 'change_notified').map(e => e.payload), authorityRequests: [...state.pendingAuthority.values()], updates, calls, events }, null, 2), 'utf8');
};
console.log(`Live PM observation; model=${model}; connector=fake; report=${reportPath}`);
await save();
try {
  for (const step of scene3) {
    console.log(`Human ${step.as}: ${step.text}`);
    const before = project(await store.read()).lastSeq;
    const row: typeof rows[number] = { author: step.as, message: step.text, considerations: [], posts: [] };
    try { row.posts = await pm.postMessage(step.as, step.text, step.attachments); }
    catch (error) { row.error = error instanceof Error ? error.message : String(error); }
    const events = await store.read({ afterSeq: before }) as AnyEvent[];
    row.messageId = events.find(e => e.type === 'message_recorded')?.payload.messageId;
    row.considerations = events.filter(e => e.type === 'pm_considered').map(e => e.payload);
    rows.push(row);
    await save();
    console.table(row.considerations.map(c => ({ decision: c.decision, whoseAction: c.whoseAction, alreadyKnows: c.alreadyKnows, evidence: c.evidence.join(', '), reason: c.reason })));
    for (const post of row.posts) console.log(`PM (${post.kind}): ${post.text}`);
  }
} finally {
  await pm.stop();
  await save();
}
console.table(rows.map((r, i) => ({ message: i + 1, author: r.author, decision: r.considerations.map(c => c.decision).join('/'), reason: r.considerations.map(c => c.reason).join(' / '), posts: r.posts.map(p => p.text).join(' / '), error: r.error ?? '' })));
console.log(`Final plan: v${project(await store.read()).plan?.version}; updates: ${updates.length}; JSON: ${reportPath}`);
