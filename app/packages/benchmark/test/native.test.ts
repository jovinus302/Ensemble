import { beforeEach, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ workers: [] as any[], providers: [] as any[] }));
vi.mock('@ensemble/agents', async original => {
  const actual = await original<typeof import('@ensemble/agents')>();
  class Connector {
    constructor(options: unknown) { fake.workers.push(options); }
    onEvent() { return () => {}; }
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
beforeEach(() => { fake.workers.length = 0; fake.providers.length = 0; });
it('constructs both arms without runtime processes, provider calls, or worker workspaces', async () => {
  for (const ensemble of [false, true]) {
    const { options, calls } = setup('codex', ensemble); const driver = await createNativeDriver(options);
    expect(fake.workers).toEqual([]); expect(fake.providers).toEqual([]); expect(calls).toEqual([]);
    expect(await driver.settled()).toBe(false); await driver.stop();
  }
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
