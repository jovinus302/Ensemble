import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const wire = vi.hoisted(() => ({ codex: [] as any[], claude: [] as any[], prepared: false }));
vi.mock('../../agents/src/codex/app-server.ts', async original => {
  const actual = await original<typeof import('../../agents/src/codex/app-server.ts')>();
  class Client {
    options: any; thread: any; turns: any[] = []; listeners = new Map<string, (value: any) => void>();
    constructor(options: any) { this.options = options; wire.codex.push(this); }
    async initialize() {}
    async threadStart(input: any) { this.thread = input; return 'thread'; }
    async turnStart(input: any) { expect(wire.prepared).toBe(true); this.turns.push(input); return `turn-${this.turns.length}`; }
    on(name: string, handler: (value: any) => void) { this.listeners.set(name, handler); return () => {}; }
    onFailure() { return () => {}; }
    async close() {}
    async turnInterrupt() {}
  }
  return { ...actual, CodexAppServerClient: Client };
});
vi.mock('node:child_process', async original => {
  const actual = await original<typeof import('node:child_process')>();
  const { EventEmitter } = await import('node:events'); const { PassThrough } = await import('node:stream');
  return { ...actual, spawn: (command: string, args: string[], options: any) => {
    expect(command).toBe('claude'); expect(wire.prepared).toBe(true);
    const child: any = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      exitCode: null, signalCode: null, input: '', command, args, options });
    child.stdin.on('data', (data: Buffer) => { child.input += data.toString(); });
    child.kill = () => { child.signalCode = 'SIGTERM'; queueMicrotask(() => child.emit('close', null, 'SIGTERM')); return true; };
    wire.claude.push(child); return child;
  } };
});
import { CodexSessionConnector, ClaudeSessionConnector, type TaskInstructionsInput } from '@ensemble/agents';
import { createDirectDriver } from '../src/direct.ts';
import { DEVELOPMENT_SYSTEM, codexWorkerArgs, CLAUDE_DISALLOWED } from '../src/runtime-config.ts';
import { PROMPT_A, PROMPT_B_INITIAL, PROMPT_CHANGE } from '../src/protocol.ts';
import { MemoryLedgerStore } from '@ensemble/store';
import { ProjectManager, type ValidationInput } from '@ensemble/orchestrator';
import { project, type AnyEvent, type NewLedgerEvent } from '@ensemble/core';
import type { LlmRequest } from '@ensemble/llm';
import type { NativeDriverOptions } from '../src/native.ts';
let root = '';
beforeEach(async () => { wire.codex.length = 0; wire.claude.length = 0; wire.prepared = false; root = await mkdtemp(path.join(tmpdir(), 'ensemble-direct-offline-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
function setup(provider: 'codex' | 'claude') {
  const calls: string[] = []; const controller = new AbortController(); const events: unknown[] = [];
  const options: NativeDriverOptions = { provider, ensemble: false, model: provider === 'codex' ? 'gpt-6-astra' : 'claude-opus-4-8', effort: provider === 'codex' ? 'low' : 'xhigh', projectId: 'direct', workspaceRoot: root,
    prompt: PROMPT_A, signal: controller.signal, onWorkspace: async () => { wire.prepared = true; }, record: event => events.push(event),
    meter: async (role, operation) => { calls.push(role); return operation(); } };
  return { options, calls, controller, events };
}
const task: TaskInstructionsInput = { taskId: 'reservation', planVersion: 1, goalSummary: { text: PROMPT_A, sourceId: 'brief' },
  taskTitle: { text: 'Reservation application', sourceId: 'brief' }, handoffConditions: [{ text: PROMPT_A, sourceId: 'brief' }], decisions: [], inputs: [], openQuestions: [] };
const noConfounds = (text: string) => {
  expect(text).not.toMatch(/single HTML|단일 HTML|HTML 파일 안|mock[- ]only|result_report|acknowledge_update|ensemble-report/);
};
it.each([PROMPT_A, PROMPT_B_INITIAL])('captures actual Codex thread/turn requests: equal brief and restrictions for A/B %#', async prompt => {
  const { options, calls } = setup('codex'); options.prompt = prompt; const direct = await createDirectDriver(options); await direct.start();
  const native = new CodexSessionConnector({ model: options.model, workspaceRoot: root, instructionsFor: () => DEVELOPMENT_SYSTEM, rpc: { args: codexWorkerArgs(options.effort) } });
  await native.startSession('prototype-agent', 'ensemble'); await native.startTask('prototype-agent', { ...task, goalSummary: { text: prompt, sourceId: 'brief' } });
  const [plain, ensemble] = wire.codex;
  expect(plain.options.args).toEqual(ensemble.options.args);
  for (const key of ['model', 'sandbox', 'approvalPolicy', 'developerInstructions']) expect(plain.thread[key]).toEqual(ensemble.thread[key]);
  expect(plain.thread.developerInstructions).toBe(DEVELOPMENT_SYSTEM); noConfounds(plain.thread.developerInstructions);
  expect(plain.turns[0].text).toBe(prompt); noConfounds(plain.turns[0].text);
  expect(ensemble.turns[0].text).toContain(prompt); expect(ensemble.turns[0].text).toContain('ensemble-report');
  plain.listeners.get('turn/completed')({ threadId: 'thread', turn: { status: 'completed' } });
  expect(await direct.settled()).toBe(true); await direct.change(PROMPT_CHANGE);
  expect(plain.turns[1]).toEqual({ threadId: 'thread', text: PROMPT_CHANGE }); expect(await direct.settled()).toBe(false);
  plain.listeners.get('turn/completed')({ threadId: 'thread', turn: { status: 'completed' } }); expect(await direct.settled()).toBe(true);
  expect(calls).toEqual(['worker', 'worker']); await direct.stop(); await native.stop();
});
it.each([PROMPT_A, PROMPT_B_INITIAL])('captures actual Claude argv/stdin: paired parity and plain continuation for A/B %#', async prompt => {
  const { options, calls } = setup('claude'); options.prompt = prompt; const direct = await createDirectDriver(options); await direct.start();
  const native = new ClaudeSessionConnector({ model: options.model, effort: 'xhigh', workspaceRoot: root, instructionsFor: () => DEVELOPMENT_SYSTEM,
    allowedTools: [], disallowedTools: CLAUDE_DISALLOWED });
  await native.startSession('prototype-agent', 'ensemble'); await native.startTask('prototype-agent', { ...task, goalSummary: { text: prompt, sourceId: 'brief' } });
  const [plain, ensemble] = wire.claude;
  const withoutSession = (args: string[]) => args.map((value, index) => args[index - 1] === '--session-id' ? '<session>' : value);
  expect(withoutSession(plain.args)).toEqual(withoutSession(ensemble.args));
  expect(plain.input).toBe(prompt); noConfounds(plain.input); noConfounds(plain.args.at(-1));
  expect(ensemble.input).toContain(prompt); expect(ensemble.input).toContain('ensemble-report');
  plain.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', session_id: 'continued-session' }) + '\n'); plain.exitCode = 0; plain.emit('close', 0, null);
  expect(await direct.settled()).toBe(true); await direct.change(PROMPT_CHANGE);
  expect(wire.claude[2].input).toBe(PROMPT_CHANGE); noConfounds(wire.claude[2].input);
  expect(wire.claude[2].args).toContain('--resume'); expect(wire.claude[2].args).toContain('continued-session');
  expect(await direct.settled()).toBe(false); expect(calls).toEqual(['worker', 'worker']);
  wire.claude[2].stdout.write(JSON.stringify({ type: 'result', subtype: 'success' }) + '\n'); wire.claude[2].exitCode = 0; wire.claude[2].emit('close', 0, null);
  expect(await direct.settled()).toBe(true);
  await direct.stop(); await native.stop();
});
it('waits for Codex terminal events and propagates runtime failure rather than marking success', async () => {
  const { options } = setup('codex'); const direct = await createDirectDriver(options); await direct.start();
  expect(await direct.settled()).toBe(false);
  wire.codex[0].listeners.get('turn/completed')({ threadId: 'thread', turn: { status: 'failed', error: { message: 'sandbox unavailable' } } });
  await expect(direct.settled()).rejects.toThrow('sandbox unavailable'); await direct.stop();
});
it('aborts before any transport if workspace preparation is interrupted', async () => {
  const { options, controller, calls } = setup('claude'); options.onWorkspace = async () => { controller.abort(); };
  const direct = await createDirectDriver(options); await expect(direct.start()).rejects.toThrow();
  expect(wire.claude).toHaveLength(0); expect(calls).toEqual([]); await direct.stop();
});
it('external cancellation and explicit stop share teardown and never start another turn', async () => {
  const { options, controller } = setup('claude'); const direct = await createDirectDriver(options); await direct.start();
  controller.abort(); await direct.stop(); expect(wire.claude[0].signalCode).toBe('SIGTERM');
  await expect(direct.change(PROMPT_CHANGE)).rejects.toThrow(); expect(wire.claude).toHaveLength(1);
});

it.each([['codex', 'A'], ['codex', 'B'], ['claude', 'A'], ['claude', 'B']] as const)('%s task %s actual reports preserve immutable paths/limitations and validate before judge (B rebinds)', async (provider, taskMode) => {
  wire.prepared = true;
  const connector = provider === 'codex'
    ? new CodexSessionConnector({ model: 'pinned-model', workspaceRoot: root, instructionsFor: () => DEVELOPMENT_SYSTEM, rpc: { args: codexWorkerArgs('high') } })
    : new ClaudeSessionConnector({ model: 'pinned-model', effort: 'high', workspaceRoot: root, instructionsFor: () => DEVELOPMENT_SYSTEM, allowedTools: [], disallowedTools: CLAUDE_DISALLOWED });
  const store = new MemoryLedgerStore(); const context = { projectId: 'reports', targetProductId: 'reservation' };
  const record = (type: NewLedgerEvent['type'], payload: unknown): NewLedgerEvent => ({ ...context, type, payload, actor: { kind: 'human', id: 'owner' } });
  const taskSpec = (condition: string) => ({ id: 'reservation', title: 'Reservation application', assignee: 'prototype-agent', dependsOn: [], handoffConditions: [condition] });
  await store.append([
    record('member_joined', { memberId: 'owner', kind: 'human', displayName: 'Owner' }),
    record('member_joined', { memberId: 'prototype-agent', kind: 'agent', displayName: 'Worker' }),
    record('goal_set', { text: taskMode === 'A' ? PROMPT_A : PROMPT_B_INITIAL, decider: 'owner', delegation: { pmMayApply: [] } }),
    record('plan_committed', { version: 1, basedOn: null, reason: 'fixed checkpoint', approvedBy: 'owner', sourceMessageIds: [], tasks: [taskSpec('Selection controls work')] }),
  ]);
  const snapshots: ValidationInput[] = []; const order: string[] = []; const judges: LlmRequest[] = [];
  const pm = new ProjectManager({ ...context, connector, store, model: 'pinned-model', requireValidation: true,
    trustedValidator: { policyFingerprint: 'offline-artifact-policy', async validate(input) {
      snapshots.push(input); order.push(`validator:${input.planVersion}`);
      expect(Object.isFrozen(input.artifacts)).toBe(true);
      return { status: 'passed', checks: [{ id: 'selection', status: 'passed', detail: 'Selection controls work' }], summary: 'Offline synthetic validator result; no browser or provider invoked' };
    } },
    llm: { async complete(request) {
      judges.push(request); order.push(`judge:${snapshots.at(-1)!.planVersion}`);
      expect(request.forceTool).toBe('record_handoff_review');
      expect(request.messages[0]!.content).toContain('HOST TRUSTED VALIDATION');
      expect(request.messages[0]!.content).toContain('External browser not run by worker');
      expect((await store.read()).some(e => e.type === 'validation_finished')).toBe(true);
      return { model: request.model, text: '', responseId: 'offline', usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [{ name: request.forceTool!, input: {
        conditions: [{ index: 1, met: true, file: snapshots.at(-1)!.artifacts.find(a => a.path === 'src/App.jsx')!.id, quote: 'Selection controls work' }], decisionConflicts: [],
      } }] };
    } },
  });
  try {
    const session = await pm.sessions.startSession('prototype-agent');
    await mkdir(path.join(session.workspace, 'src'), { recursive: true });
    await mkdir(path.join(session.workspace, 'styles'), { recursive: true });
    for (const version of taskMode === 'B' ? [1, 2] : [1]) {
      if (version === 2) {
        await store.append([
          record('goal_set', { text: `${PROMPT_B_INITIAL}\n${PROMPT_CHANGE}`, decider: 'owner', delegation: { pmMayApply: [] } }),
          record('plan_committed', { version: 2, basedOn: 1, reason: PROMPT_CHANGE, approvedBy: 'owner', sourceMessageIds: [], tasks: [taskSpec('Selection controls work with eight guests')] }),
        ]);
        expect(project(await store.read()).tasks.get('reservation')!.validation?.status).toBe('expired');
      }
      const source = `// Selection controls work${version === 2 ? ' with eight guests' : ''}\nexport default () => null;`;
      await writeFile(path.join(session.workspace, 'src/App.jsx'), source);
      await writeFile(path.join(session.workspace, 'src/shared.css'), '.source { color: blue; }');
      await writeFile(path.join(session.workspace, 'styles/shared.css'), '.layout { display: grid; }');
      const input = { ...task, planVersion: version, goalSummary: { text: taskMode === 'A' ? PROMPT_A : version === 1 ? PROMPT_B_INITIAL : PROMPT_CHANGE, sourceId: 'brief' } };
      const turnId = await pm.sessions.startTask('prototype-agent', input);
      const report = { type: 'result_report', taskId: 'reservation', planVersion: version, summary: 'Updated source',
        files: ['src/App.jsx', 'src/shared.css', 'styles/shared.css'].map(file => ({ path: file, description: 'Submitted source' })), limitations: ['External browser not run by worker'] };
      const text = `Implemented source.\n\`\`\`ensemble-report\n${JSON.stringify(report)}\n\`\`\``;
      if (provider === 'claude') {
        const child = wire.claude.at(-1);
        // Exercise real stream chunk assembly and actual Claude report parsing.
        const stream = JSON.stringify({ type: 'assistant', message: { id: `message-${version}`, content: [{ type: 'text', text }] } }) + '\n';
        child.stdout.write(stream.slice(0, 17)); child.stdout.write(stream.slice(17));
        child.stdout.write(JSON.stringify({ type: 'result', subtype: 'success' }) + '\n'); child.exitCode = 0; child.emit('close', 0, null);
      } else {
        const client = wire.codex[0];
        client.listeners.get('item/completed')({ threadId: 'thread', turnId, item: { type: 'agentMessage', id: `message-${version}`, text } });
        client.listeners.get('turn/completed')({ threadId: 'thread', turn: { id: turnId, status: 'completed' } });
      }
      await vi.waitFor(async () => expect(project(await store.read()).tasks.get('reservation')?.status).toBe('checked'));
      await pm.flush();
      const submitted = (await store.read() as AnyEvent[]).filter(e => e.type === 'result_submitted').at(-1)!;
      expect(submitted.payload).toMatchObject({ taskId: 'reservation', planVersion: version, limitations: ['External browser not run by worker'] });
      expect(snapshots.at(-1)!.artifacts.map(a => a.path).sort()).toEqual(['src/App.jsx', 'src/shared.css', 'styles/shared.css']);
      expect(snapshots.at(-1)!.artifacts.find(a => a.path === 'src/App.jsx')!.content).toBe(source);
    }
    expect(order).toEqual(taskMode === 'B' ? ['validator:1', 'judge:1', 'validator:2', 'judge:2'] : ['validator:1', 'judge:1']);
    expect(judges).toHaveLength(taskMode === 'B' ? 2 : 1);
    if (taskMode === 'B') {
      expect(snapshots[0]!.resultId).not.toBe(snapshots[1]!.resultId);
      expect(snapshots[0]!.artifactDigest).not.toBe(snapshots[1]!.artifactDigest);
      expect(snapshots[0]!.contextDigest).not.toBe(snapshots[1]!.contextDigest);
      if (provider === 'claude') expect(wire.claude[1].args).toContain('--resume');
    }
    expect(project(await store.read()).tasks.get('reservation')!.validation!.resultId).toBe(snapshots.at(-1)!.resultId);
    if (provider === 'codex') expect(wire.codex).toHaveLength(1);
  } finally { await pm.stop(); store.close(); }
});
