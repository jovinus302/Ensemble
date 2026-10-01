import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
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
import { PROMPT_A, PROMPT_CHANGE } from '../src/protocol.ts';
import type { NativeDriverOptions } from '../src/native.ts';
let root = '';
beforeEach(async () => { wire.codex.length = 0; wire.claude.length = 0; wire.prepared = false; root = await mkdtemp(path.join(tmpdir(), 'ensemble-direct-offline-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
function setup(provider: 'codex' | 'claude') {
  const calls: string[] = []; const controller = new AbortController(); const events: unknown[] = [];
  const options: NativeDriverOptions = { provider, ensemble: false, model: 'pinned-model', effort: 'high', projectId: 'direct', workspaceRoot: root,
    prompt: PROMPT_A, signal: controller.signal, onWorkspace: async () => { wire.prepared = true; }, record: event => events.push(event),
    meter: async (role, operation) => { calls.push(role); return operation(); } };
  return { options, calls, controller, events };
}
const task: TaskInstructionsInput = { taskId: 'reservation', planVersion: 1, goalSummary: { text: PROMPT_A, sourceId: 'brief' },
  taskTitle: { text: 'Reservation application', sourceId: 'brief' }, handoffConditions: [{ text: PROMPT_A, sourceId: 'brief' }], decisions: [], inputs: [], openQuestions: [] };
const noConfounds = (text: string) => {
  expect(text).not.toMatch(/single HTML|단일 HTML|HTML 파일 안|mock[- ]only|result_report|acknowledge_update|ensemble-report/);
};
it('captures actual Codex thread/turn requests: equal development brief and restrictions, direct has no report protocol', async () => {
  const { options, calls } = setup('codex'); const direct = await createDirectDriver(options); await direct.start();
  const native = new CodexSessionConnector({ model: options.model, workspaceRoot: root, instructionsFor: () => DEVELOPMENT_SYSTEM, rpc: { args: codexWorkerArgs(options.effort) } });
  await native.startSession('prototype-agent', 'ensemble'); await native.startTask('prototype-agent', task);
  const [plain, ensemble] = wire.codex;
  expect(plain.options.args).toEqual(ensemble.options.args);
  for (const key of ['model', 'sandbox', 'approvalPolicy', 'developerInstructions']) expect(plain.thread[key]).toEqual(ensemble.thread[key]);
  expect(plain.thread.developerInstructions).toBe(DEVELOPMENT_SYSTEM); noConfounds(plain.thread.developerInstructions);
  expect(plain.turns[0].text).toBe(PROMPT_A); noConfounds(plain.turns[0].text);
  expect(ensemble.turns[0].text).toContain(PROMPT_A); expect(ensemble.turns[0].text).toContain('ensemble-report');
  expect(calls).toEqual(['worker']); await direct.stop(); await native.stop();
});
it('captures actual Claude argv/stdin: paired model/effort/tools/system parity and plain direct continuation', async () => {
  const { options, calls } = setup('claude'); const direct = await createDirectDriver(options); await direct.start();
  const native = new ClaudeSessionConnector({ model: options.model, effort: 'high', workspaceRoot: root, instructionsFor: () => DEVELOPMENT_SYSTEM,
    allowedTools: [], disallowedTools: CLAUDE_DISALLOWED });
  await native.startSession('prototype-agent', 'ensemble'); await native.startTask('prototype-agent', task);
  const [plain, ensemble] = wire.claude;
  const withoutSession = (args: string[]) => args.map((value, index) => args[index - 1] === '--session-id' ? '<session>' : value);
  expect(withoutSession(plain.args)).toEqual(withoutSession(ensemble.args));
  expect(plain.input).toBe(PROMPT_A); noConfounds(plain.input); noConfounds(plain.args.at(-1));
  expect(ensemble.input).toContain(PROMPT_A); expect(ensemble.input).toContain('ensemble-report');
  plain.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', session_id: 'continued-session' }) + '\n'); plain.exitCode = 0; plain.emit('close', 0, null);
  expect(await direct.settled()).toBe(true); await direct.change(PROMPT_CHANGE);
  expect(wire.claude[2].input).toBe(PROMPT_CHANGE); noConfounds(wire.claude[2].input);
  expect(wire.claude[2].args).toContain('--resume'); expect(wire.claude[2].args).toContain('continued-session');
  expect(await direct.settled()).toBe(false); expect(calls).toEqual(['worker', 'worker']);
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
