import { createServer } from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { WebRuntime } from '../apps/web/lib/runtime.ts';
import { GET, POST } from '../apps/web/app/api/[...path]/route.ts';
import { continuousScenario } from '@ensemble/scenarios';
import type { LlmProvider } from '@ensemble/llm';
import type { RevisionGenerator } from '@ensemble/scenarios';
import type { SessionConnector, SessionEvent, TaskInstructionsInput, UpdateInstructionsInput } from '@ensemble/agents';

// Explicit test transport only. PM decisions and the API handlers are the real implementation.
class ScriptedAgent implements SessionConnector {
  private handlers = new Set<(e: SessionEvent) => void>();
  private tasks = new Map<string, TaskInstructionsInput>();
  constructor(private workspace: string) {}
  async startSession(agentId: string) { return { threadId: agentId, workspace: this.workspace }; }
  async startTask(agentId: string, input: TaskInstructionsInput) {
    this.tasks.set(agentId, input);
    if (agentId === 'research-agent') {
      await writeFile(path.join(this.workspace, 'research.md'), await readFile(new URL('./live-http-research.md', import.meta.url), 'utf8'), 'utf8');
      setTimeout(() => this.emit({ type: 'report', agentId, taskId: input.taskId, threadId: agentId, turnId: `fake:${input.taskId}`, itemId: `result:${input.taskId}`, index: 0, report: { type: 'result_report', taskId: input.taskId, planVersion: input.planVersion, summary: '공식 공개 문서 기반 대안 비교 보고서 제출', files: [{ path: 'research.md', description: '가짜 Agent 조사 자료' }] } }), 10);
    }
    if (agentId === 'research-agent') setTimeout(() => this.emit({ type: 'turn', agentId, taskId: input.taskId, threadId: agentId, turnId: `fake:${input.taskId}`, status: 'completed' }), 100);
    return `fake:${input.taskId}`;
  }
  async sendUpdate(agentId: string, input: UpdateInstructionsInput) {
    const task = this.tasks.get(agentId)!;
    setTimeout(() => this.emit({ type: 'report', agentId, taskId: task.taskId, threadId: agentId, turnId: `fake:${task.taskId}`, itemId: input.updateId, index: 0, report: { type: 'acknowledge_update', updateId: input.updateId, planVersion: input.toVersion, applied: input.change, dropped: input.drop } }), 10);
    return { sent: true as const };
  }
  private emit(e: SessionEvent) { for (const handler of this.handlers) handler(e); }
  onEvent(handler: (e: SessionEvent) => void) { this.handlers.add(handler); return () => { this.handlers.delete(handler); }; }
  async stop() { this.tasks.clear(); }
}

// Usage: npm run live:http -- [--fake-llm] [--port N] [--out DIR]
// Default: real PM LLM (ENSEMBLE_ENV_FILE) + scripted Agent. --fake-llm: the scripted PM/Agent fixture from the scenario tests, no model calls.
const flag = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const fakeLlm = process.argv.includes('--fake-llm');
const output = path.resolve(flag('--out') ?? path.join(homedir(), 'ensemble-agent-workspaces/live-http', new Date().toISOString().replace(/[:.]/g, '-')));
await mkdir(path.join(output, 'agents'), { recursive: true });
let runtimeOptions: { llm?: LlmProvider; connector: SessionConnector; generateRevision?: RevisionGenerator } = { connector: new ScriptedAgent(path.join(output, 'agents')) };
if (fakeLlm) {
  const { setup } = await import('../packages/scenarios/test/continuous-fixture.ts');
  const f = await setup(false);
  await f.pm.stop();
  runtimeOptions = { llm: f.llm, connector: f.connector, generateRevision: f.host.generateRevision };
}
const app = new WebRuntime({ dataDir: path.join(output, 'data'), ...runtimeOptions });
(globalThis as typeof globalThis & { ensembleRuntime?: WebRuntime }).ensembleRuntime = app;
const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const request = new Request(`http://127.0.0.1${req.url}`, { method: req.method, ...(req.method === 'POST' ? { body: Buffer.concat(chunks).toString('utf8') } : {}) });
    const context = { params: Promise.resolve({ path: new URL(request.url).pathname.replace(/^\/api\//, '').split('/') }) };
    const response = await (req.method === 'POST' ? POST : GET)(request, context);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500); res.end('HTTP test bridge failed'); }
});
await new Promise<void>(resolve => server.listen(Number(flag('--port') ?? 0), '127.0.0.1', resolve));
const address = server.address() as { port: number };
const base = `http://127.0.0.1:${address.port}/api/`;
const observations: unknown[] = [];
console.log(`OUTPUT ${output}`);
async function api(route: string, body?: unknown) {
  const response = await fetch(base + route, { ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status} ${JSON.stringify(result)}`);
  return result as Awaited<ReturnType<WebRuntime['state']>>;
}
let failure: string | undefined;
try {
  await api('state');
  await api('scenario/start', { name: continuousScenario.key });
  for (let i = 0; i < continuousScenario.steps.length; i++) {
    const started = Date.now();
    await api('scenario/next', {});
    while (app.meta.script!.step <= i && !app.meta.script!.stopped) {
      const state = await api('state');
      if (state.activity.stalled) throw new Error(state.activity.stalled.reason);
      if (Date.now() - started > 180_000) throw new Error(`Step ${i + 1}: observer timeout`);
      await new Promise(r => setTimeout(r, 1000));
    }
    const state = await api('state');
    const record = { step: i + 1, scene: continuousScenario.steps[i]!.scene, seconds: (Date.now() - started) / 1000, state, stopped: app.meta.script!.stopped };
    observations.push(record);
    await writeFile(path.join(output, 'observations.json'), JSON.stringify(observations, null, 2), 'utf8');
    console.log(`STEP ${i + 1}: scene=${record.scene}, seconds=${record.seconds}, plan=${state.roadmap.planVersion}, stopped=${!!record.stopped}`);
    if (record.stopped) throw new Error(record.stopped);
  }
} catch (error) { failure = error instanceof Error ? error.message : String(error); console.error(failure); }
finally {
  await writeFile(path.join(output, 'ledger.json'), JSON.stringify(await app.store.read(), null, 2), 'utf8');
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ outcome: failure ? 'failed' : 'succeeded', failure, completedSteps: app.meta.script?.step, scene: app.meta.scene, output }, null, 2), 'utf8');
  server.closeAllConnections(); server.close();
  await app.stop();
  process.exitCode = failure ? 1 : 0;
  console.log(`REPORT ${path.join(output, 'report.json')}`);
}
