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
    const offered: { step: number; text: string; posted: boolean }[] = [];
    for (let i = 0; i < steps + 2 && app.meta.script!.step < steps; i++) {
      const before = app.meta.script!.step;
      const line = (await app.state()).scenario?.nextLine?.text ?? '';
      const seen = (await store.read({ projectId: app.meta.projectId })).length;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stalled = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`stalled at step ${before}: ${continuousScenario.steps[before]?.text}`)), 30_000); });
      try { await Promise.race([app.scenarioNext(), stalled]); } finally { clearTimeout(timer); }
      // Like a person pressing "다음" in the browser: the PM finishes what the last input started first.
      await settled(app);
      expect(app.meta.script!.stopped).toBeUndefined();
      const posted = (await store.read({ projectId: app.meta.projectId }) as AnyEvent[]).slice(seen).some(e => e.type === 'message_recorded' && e.payload.text === line);
      offered.push({ step: before, text: line, posted });
    }
    expect(app.meta.script!.step).toBe(steps);
    expect((await app.state()).scenario).toMatchObject({ done: true });
    // "다음 발언" never offers a line it would not post: the fake PM applied the exclusion itself, so the owner's
    // clarification (said only when the PM asks) is passed over and the script ends after "ㅇㅋ 결제는 이번엔 빼자".
    for (const { step, posted } of offered) if (!['availability', 'respondToRevision'].includes(continuousScenario.steps[step]!.action ?? '')) expect(posted).toBe(true);
    expect(offered.map(o => o.text)).not.toContain(continuousScenario.steps.at(-1)!.text);

    const events = await store.read({ projectId: app.meta.projectId }) as AnyEvent[];
    const state = project(events);
    // The decider's agreement became plan v2 with payment excluded from the prototype, and the running agent heard it.
    expect(state.plan!.version).toBeGreaterThanOrEqual(2);
    const prototype = state.plan!.tasks.find(t => t.assignee === 'prototype-agent' && (t.exclusions ?? []).length);
    expect(prototype?.exclusions?.some(e => /결제/.test(typeof e === 'string' ? e : JSON.stringify(e)))).toBe(true);
    expect(events.some(e => e.type === 'update_acknowledged' && state.tasks.get(e.payload.taskId)?.spec.assignee === 'prototype-agent')).toBe(true);

    // QA: what people read never carries a serialized spec — the agent's result names the change in words.
    await app.pm.flush();
    const after = await store.read({ projectId: app.meta.projectId }) as AnyEvent[];
    for (const e of after) {
      const text = e.type === 'result_submitted' ? e.payload.summary : e.type === 'pm_spoke' || e.type === 'reply_recorded' || e.type === 'agent_report_recorded' || e.type === 'message_recorded' ? e.payload.text : '';
      expect(text).not.toMatch(/\{"|"\w+":|baseTitle/);
    }
    for (const message of (await app.state()).messages) expect(message.text).not.toMatch(/\{"|"\w+":/);
    const update = after.find(e => e.type === 'update_sent' && state.tasks.get(e.payload.taskId)?.spec.assignee === 'prototype-agent');
    expect(after.some(e => e.type === 'update_acknowledged' && e.payload.applied.includes('범위에서 제외: 결제'))).toBe(true);
    expect(update).toBeDefined();
    // Initial-plan work points back to the decider's goal (and approval) messages it came from.
    const goal = after.find(e => e.type === 'message_recorded' && e.payload.text === continuousScenario.steps[2]!.text)!;
    const approval = after.find(e => e.type === 'message_recorded' && e.payload.text === continuousScenario.steps[3]!.text)!;
    for (const task of project(after).tasks.values()) {
      if (task.meta?.origin?.planVersion !== 1) continue;
      expect(task.meta.origin).toMatchObject({ createdBy: 'owner', sourceMessageIds: [goal.type === 'message_recorded' && goal.payload.messageId, approval.type === 'message_recorded' && approval.payload.messageId] });
      expect(task.meta.brief?.why).not.toContain('시연용');
    }
    // The exclusion joined the prototype's context.
    const proto = [...project(after).tasks.values()].find(t => t.spec.assignee === 'prototype-agent')!;
    expect(proto.meta?.brief?.constraints).toContain('결제 제외');
    // Result files are named after their work, one per work item, with no internal version keys.
    const names = after.flatMap(e => e.type === 'attachment_recorded' && e.actor.kind === 'agent' ? [[e.payload.taskId, e.payload.name] as const] : []);
    expect(names.length).toBeGreaterThan(0);
    for (const [, name] of names) expect(name).not.toMatch(/-v\d+-\d+\.|^(?:research|prototype)-/);
    const byName = new Map<string, Set<string | undefined>>();
    for (const [taskId, name] of names) byName.set(name, (byName.get(name) ?? new Set()).add(taskId));
    for (const owners of byName.values()) expect(owners.size).toBe(1);
  } finally { await app.stop(); await rm(dir, { recursive: true, force: true }); }
}, 240_000);
