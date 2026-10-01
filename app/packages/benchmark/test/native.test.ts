import { beforeEach, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@ensemble/agents';

const fake = vi.hoisted(() => ({
  constructors: [] as unknown[], listeners: new Set<(event: SessionEvent) => void>(), starts: 0, continuations: 0, stops: 0,
  prepared: false, releaseStop: undefined as undefined | (() => void), holdStop: false,
}));
vi.mock('@ensemble/agents', async importOriginal => {
  const original = await importOriginal<typeof import('@ensemble/agents')>();
  class Connector {
    constructor(options: unknown) { fake.constructors.push(options); }
    async startSession() { return { workspace: 'mock-workspace', threadId: 'thread' }; }
    async startTask() {
      expect(fake.prepared).toBe(true); fake.starts++; emit('started', 'initial'); return 'initial';
    }
    async continueTask() { fake.continuations++; emit('started', 'continuation'); return 'continuation'; }
    async sendUpdate() { return { sent: false as const, reason: 'mock unsupported' }; }
    onEvent(listener: (event: SessionEvent) => void) { fake.listeners.add(listener); return () => { fake.listeners.delete(listener); }; }
    async stop() { fake.stops++; if (fake.holdStop) await new Promise<void>(resolve => { fake.releaseStop = resolve; }); }
  }
  return { ...original, CodexSessionConnector: Connector, ClaudeSessionConnector: Connector };
});
// A test must never accidentally fall through to a CLI-backed PM implementation.
vi.mock('@ensemble/llm', async importOriginal => ({
  ...await importOriginal<typeof import('@ensemble/llm')>(),
  CodexCliProvider: class { complete() { throw new Error('Unexpected model call in offline test'); } },
  ClaudeCliProvider: class { complete() { throw new Error('Unexpected model call in offline test'); } },
}));
import { createNativeDriver, type NativeDriverOptions } from '../src/native.ts';

function emit(status: 'started' | 'completed' | 'failed', turnId: string) {
  for (const listener of fake.listeners) listener({ type: 'turn', agentId: 'prototype-agent', taskId: 'reservation', threadId: 'thread', turnId, status });
}
function setup(overrides: Partial<NativeDriverOptions> = {}) {
  const calls: string[] = [];
  const records: unknown[] = [];
  const controller = new AbortController();
  const options: NativeDriverOptions = {
    provider: 'claude', ensemble: false, model: 'fixed-model', effort: 'medium', workspaceRoot: 'unused', projectId: 'mock', prompt: 'Implement checkpoint',
    signal: controller.signal, meter: async (role, operation) => { calls.push(role); return operation(); },
    onWorkspace: async () => { fake.prepared = true; }, record: event => { records.push(event); }, ...overrides,
  };
  return { options, calls, records, controller };
}
beforeEach(() => {
  fake.constructors.length = 0; fake.listeners.clear(); fake.starts = 0; fake.continuations = 0; fake.stops = 0;
  fake.prepared = false; fake.holdStop = false; fake.releaseStop = undefined;
});
it('constructs both native arms without a process, provider call or workspace write', async () => {
  for (const ensemble of [true, false]) {
    const { options, calls } = setup({ ensemble });
    const driver = await createNativeDriver(options);
    expect(fake.constructors).toHaveLength(0); expect(calls).toEqual([]); expect(fake.prepared).toBe(false);
    expect(await driver.settled()).toBe(false); await driver.stop();
  }
});
it('prepares the workspace before worker start, meters continuation, and waits for the changed turn', async () => {
  const { options, calls, records } = setup(); const driver = await createNativeDriver(options);
  await driver.start(); expect(calls).toEqual(['worker']); expect(await driver.settled()).toBe(false);
  await driver.change('Allow eight people after 18:00'); expect(fake.continuations).toBe(0);
  emit('completed', 'initial'); await Promise.resolve(); await Promise.resolve();
  expect(fake.continuations).toBe(1); expect(calls).toEqual(['worker', 'worker']); expect(await driver.settled()).toBe(false);
  emit('completed', 'continuation'); await vi.waitFor(async () => { expect(await driver.settled()).toBe(true); });
  expect(records).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'native_worker_duration', usage: null })]));
  await driver.stop();
});
it('rejects failed worker turns instead of treating them as finished acceptance candidates', async () => {
  const { options } = setup(); const driver = await createNativeDriver(options);
  await driver.start(); emit('failed', 'initial'); await expect(driver.settled()).rejects.toThrow('failed'); await driver.stop();
});
it('awaits the same teardown after external abort and an explicit stop', async () => {
  fake.holdStop = true;
  const { options, controller } = setup(); const driver = await createNativeDriver(options);
  await driver.start(); controller.abort();
  let finished = false; const stopping = driver.stop().then(() => { finished = true; });
  await Promise.resolve(); expect(finished).toBe(false); expect(fake.stops).toBe(1);
  fake.releaseStop!(); await stopping; expect(finished).toBe(true);
});
it('does not start a worker when aborted during workspace preparation', async () => {
  const { options, controller } = setup();
  options.onWorkspace = async () => { controller.abort(); };
  const driver = await createNativeDriver(options);
  await expect(driver.start()).rejects.toThrow(); expect(fake.starts).toBe(0); await driver.stop();
});
it('routes Ensemble startup through the actual ProjectManager and meters a failed mocked PM call', async () => {
  const { options, calls, records } = setup({ ensemble: true });
  const driver = await createNativeDriver(options);
  await expect(driver.start()).rejects.toThrow('Unexpected model call in offline test');
  expect(calls).toContain('pm'); expect(fake.starts).toBe(0);
  await driver.stop();
  expect(records).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'native_ledger' })]));
});
