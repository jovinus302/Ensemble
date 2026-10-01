import { expect, it, vi } from 'vitest';
import { MemoryLedgerStore } from '@ensemble/store';
import { ProjectManager } from '@ensemble/orchestrator';
import type { LlmProvider, LlmResponse } from '@ensemble/llm';
import type { SessionConnector } from '@ensemble/agents';
import { WebRuntime } from '../../../apps/web/lib/runtime.ts';
import { sceneEvents } from '../src/index.ts';

it('durably accepts a correction during a stalled model call and cancels it before draining a replaced project', async () => {
  const store = new MemoryLedgerStore();
  const ctx = { projectId: 'stalled-queue', targetProductId: 'test-product' };
  await store.append(sceneEvents(3, ctx));
  let entered!: () => void;
  let rejectPending!: (reason: Error) => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let closed = false;
  const order: string[] = [];
  const llm: LlmProvider & { close(): Promise<void> } = {
    complete: vi.fn(async () => {
      if (closed) throw new Error('provider closed');
      entered();
      return new Promise<LlmResponse>((_resolve, reject) => { rejectPending = reject; });
    }),
    async close() { order.push('model cancelled'); closed = true; rejectPending(new Error('cancelled')); },
  };
  const connector: SessionConnector = {
    async startSession() { throw new Error('No worker needed'); },
    async startTask() { throw new Error('No worker needed'); },
    async sendUpdate() { return { sent: false, reason: 'No worker needed' }; },
    onEvent() { return () => undefined; },
    async stop() { order.push('worker stopped'); },
  };
  const pm = new ProjectManager({ ...ctx, store, llm, connector, model: 'test' });
  const app: WebRuntime = Object.assign(Object.create(WebRuntime.prototype), {
    store, pm, pmLlm: llm, ready: Promise.resolve(), intake: Promise.resolve(), pendingMessages: 0,
    pendingResolutions: new Set(), resolutionErrors: new Map(), meta: { projectId: ctx.projectId, mode: 'free', scene: 1, step: 0 },
    save: vi.fn(), changed: vi.fn(), createPm: vi.fn(), persistAttachments: vi.fn(),
  });
  const first = await app.message('owner', 'First request', []);
  await started;
  const second = await app.message('owner', 'Correction while first request is still pending', []);
  expect(first.accepted && second.accepted).toBe(true);
  expect((await store.read()).filter(e => e.type === 'message_recorded').map(e => (e.payload as { messageId: string }).messageId)).toEqual(expect.arrayContaining([first.messageId, second.messageId]));
  expect(closed).toBe(false);
  expect(pm.isProcessing).toBe(true);
  await app.startScenario('scene-1-3-continuous', true);
  expect(order).toEqual(['model cancelled', 'worker stopped']);
  expect(app.meta.projectId).not.toBe(ctx.projectId);
  expect(pm.isProcessing).toBe(false);
  expect((await store.read({ projectId: app.meta.projectId })).some(e => e.type === 'message_recorded')).toBe(false);
}, 5000);
