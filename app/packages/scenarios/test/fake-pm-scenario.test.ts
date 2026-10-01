import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { MemoryLedgerStore } from '@ensemble/store';
import { project, type AnyEvent } from '@ensemble/core';
import { WebRuntime } from '../../../apps/web/lib/runtime.ts';
import { FakePmLlm } from '../../../apps/web/lib/fake-connector.ts';
import { continuousScenario } from '../src/index.ts';

async function settled(app: WebRuntime) {
  for (let i = 0; i < 600; i++) {
    if ((await app.state()).activity.kind !== 'pm_thinking') return;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('the PM never settled');
}

// ENSEMBLE_PM_RUNTIME=fake: the rule-based demo PM must carry the existing scene 1 → 3 script to its end,
// including scene 3's "ㅇㅋ 결제는 이번엔 빼자" (the decider agreeing to drop payment from the prototype).
it('the fake PM completes the continuous scene 1 → 3 scenario end-to-end', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ensemble-fake-pm-scenario-'));
  const store = new MemoryLedgerStore();
  const app = new WebRuntime({ dataDir: dir, store, llm: new FakePmLlm(), timers: false });
  try {
    await app.state();
    await app.startScenario(continuousScenario.key);
    const steps = continuousScenario.steps.length;
    for (let i = 0; i < steps + 2 && app.meta.script!.step < steps; i++) {
      const before = app.meta.script!.step;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stalled = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`stalled at step ${before}: ${continuousScenario.steps[before]?.text}`)), 30_000); });
      try { await Promise.race([app.scenarioNext(), stalled]); } finally { clearTimeout(timer); }
      // Like a person pressing "다음" in the browser: the PM finishes what the last input started first.
      await settled(app);
      expect(app.meta.script!.stopped).toBeUndefined();
    }
    expect(app.meta.script!.step).toBe(steps);
    expect((await app.state()).scenario).toMatchObject({ done: true });

    const events = await store.read({ projectId: app.meta.projectId }) as AnyEvent[];
    const state = project(events);
    // The decider's agreement became plan v2 with payment excluded from the prototype, and the running agent heard it.
    expect(state.plan!.version).toBeGreaterThanOrEqual(2);
    const prototype = state.plan!.tasks.find(t => t.assignee === 'prototype-agent' && (t.exclusions ?? []).length);
    expect(prototype?.exclusions?.some(e => /결제/.test(typeof e === 'string' ? e : JSON.stringify(e)))).toBe(true);
    expect(events.some(e => e.type === 'update_acknowledged' && state.tasks.get(e.payload.taskId)?.spec.assignee === 'prototype-agent')).toBe(true);
  } finally { await app.stop(); await rm(dir, { recursive: true, force: true }); }
}, 240_000);
