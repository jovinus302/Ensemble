import { beforeEach, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ workers: [] as any[], providers: [] as any[], listeners: [] as ((event: any) => void)[], checkpoint: false, replaceResult: false }));
vi.mock('@ensemble/orchestrator', async original => {
  const actual = await original<typeof import('@ensemble/orchestrator')>();
  class Manager extends actual.ProjectManager {
    constructor(private readonly config: any) { super(config); }
    override async postMessage(author: string, prompt: string) {
      if (!fake.checkpoint) return super.postMessage(author, prompt);
      const events = await this.config.store.read();
      const existing = events.some((e: any) => e.type === 'result_submitted');
      if (!existing || fake.replaceResult) {
        const resultId = existing ? 'changed-result' : 'checkpoint-result';
        const context = { projectId: this.config.projectId, targetProductId: this.config.targetProductId, actor: { kind: 'system', id: 'trusted-validator' } };
        const binding = { projectId: this.config.projectId, taskId: 'reservation', resultId, planVersion: 1, specVersion: 1, contextDigest: resultId, artifactDigest: resultId, policyFingerprint: 'mock', attemptId: resultId };
        await this.config.store.append([
          { ...context, type: 'result_submitted', payload: { taskId: 'reservation', resultId, planVersion: 1, artifactIds: ['app'], summary: prompt } },
          { ...context, type: 'validation_started', payload: binding },
          { ...context, type: 'validation_finished', payload: { ...binding, status: 'passed', checks: [{ id: 'mock', status: 'passed' }], summary: 'Mock driver state only' } },
          { ...context, type: 'task_checked', payload: { taskId: 'reservation', resultId, reason: 'Mock driver state only' } },
        ]);
      }
      if (existing) for (const listener of fake.listeners) listener({ type: 'turn', status: 'completed', agentId: 'unrelated', taskId: 'unrelated', turnId: 'unrelated' });
      return [];
    }
  }
  return { ...actual, ProjectManager: Manager };
});
vi.mock('@ensemble/agents', async original => {
  const actual = await original<typeof import('@ensemble/agents')>();
  class Connector {
    constructor(options: unknown) { fake.workers.push(options); }
    onEvent(handler: (event: any) => void) { fake.listeners.push(handler); return () => {}; }
    async stop() {}
  }
  return { ...actual, CodexSessionConnector: Connector, ClaudeSessionConnector: Connector };
});
vi.mock('@ensemble/llm', async original => {
  const actual = await original<typeof import('@ensemble/llm')>();
  class Provider {
    constructor(options: unknown) { fake.providers.push(options); }
    complete() { throw new Error('offline PM sentinel'); }
  }
  return { ...actual, CodexCliProvider: Provider, ClaudeCliProvider: Provider };
});
import { createNativeDriver, type NativeDriverOptions } from '../src/native.ts';
import { PROMPT_B_INITIAL } from '../src/protocol.ts';
import { CODEX_RESTRICTIONS, DEVELOPMENT_SYSTEM, CLAUDE_DISALLOWED, codexWorkerArgs } from '../src/runtime-config.ts';
function setup(provider: 'codex' | 'claude', ensemble = true) {
  const calls: string[] = []; const events: any[] = [];
  const options: NativeDriverOptions = { provider, ensemble, model: 'pinned-model', effort: 'medium', workspaceRoot: 'unused', projectId: 'mock',
    prompt: PROMPT_B_INITIAL, signal: new AbortController().signal, onWorkspace: async () => { throw new Error('offline workspace sentinel'); },
    record: event => events.push(event), meter: async (role, operation) => { calls.push(role); return operation(); } };
  return { options, calls, events };
}
beforeEach(() => { fake.workers.length = 0; fake.providers.length = 0; fake.listeners.length = 0; fake.checkpoint = false; fake.replaceResult = false; });
it('constructs both arms without runtime processes, provider calls, or worker workspaces', async () => {
  for (const ensemble of [false, true]) {
    const { options, calls } = setup('codex', ensemble); const driver = await createNativeDriver(options);
    expect(fake.workers).toEqual([]); expect(fake.providers).toEqual([]); expect(calls).toEqual([]);
    expect(await driver.settled()).toBe(false); await driver.stop();
  }
});

it.each(['codex', 'claude'] as const)('%s B refuses stale accepted checkpoint even if an unrelated worker completes during change', async provider => {
  fake.checkpoint = true;
  const { options } = setup(provider); const accepted: string[] = [];
  options.onValidatedHandoff = evidence => accepted.push(evidence.resultId);
  const driver = await createNativeDriver(options);
  try {
    await driver.start(); expect(await driver.settled()).toBe(true);
    await driver.change('Exact changed requirements');
    await expect(driver.settled()).rejects.toThrow('reused checkpoint evidence');
    expect(accepted).toEqual(['checkpoint-result']);
  } finally { await driver.stop(); }
});

it.each(['codex', 'claude'] as const)('%s B accepts only a fresh result binding after the fixed change', async provider => {
  fake.checkpoint = true; fake.replaceResult = true;
  const { options } = setup(provider); const accepted: string[] = [];
  options.onValidatedHandoff = evidence => accepted.push(evidence.resultId);
  const driver = await createNativeDriver(options);
  try {
    await driver.start(); expect(await driver.settled()).toBe(true);
    await driver.change('Exact changed requirements'); expect(await driver.settled()).toBe(true);
    expect(accepted).toEqual(['checkpoint-result', 'changed-result']);
  } finally { await driver.stop(); }
});
it.each(['codex', 'claude'] as const)('uses neutral %s worker instructions and actual PM routing', async provider => {
  const { options, calls, events } = setup(provider); const driver = await createNativeDriver(options);
  await expect(driver.start()).rejects.toThrow('offline PM sentinel');
  expect(calls).toEqual(['pm']); expect(fake.workers[0].instructionsFor('prototype-agent')).toBe(DEVELOPMENT_SYSTEM);
  expect(fake.workers[0].model).toBe(options.model);
  if (provider === 'codex') {
    expect(fake.workers[0].rpc.args).toEqual(codexWorkerArgs(options.effort));
    expect(fake.providers[0].executableArgs).toEqual(CODEX_RESTRICTIONS);
  } else {
    expect(fake.workers[0].effort).toBe(options.effort);
    expect(fake.workers[0].allowedTools).toEqual([]); expect(fake.workers[0].disallowedTools).toEqual(CLAUDE_DISALLOWED);
  }
  await driver.stop();
  const ledger = events.find(e => e.type === 'native_ledger').events;
  expect(ledger.find((e: any) => e.type === 'goal_set').payload.text).toBe(PROMPT_B_INITIAL);
  const criteria = ledger.find((e: any) => e.type === 'plan_committed').payload.tasks[0].handoffConditions[0];
  expect(criteria).toContain('trusted validator validates the captured submitted source build');
  expect(criteria).toContain('not required for this initial handoff');
});
