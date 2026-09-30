import { expect, it, vi } from 'vitest';
import { MemoryLedgerStore } from '@ensemble/store';
import { project } from '@ensemble/core';
import { WebRuntime } from '../../../apps/web/lib/runtime.ts';
import { sceneEvents } from '../src/index.ts';
function runtime() {
  const store = new MemoryLedgerStore();
  const app: WebRuntime = Object.assign(Object.create(WebRuntime.prototype), {
    store, pendingResolutions: new Set(), resolutionErrors: new Map(), meta: { projectId: 'retained-project', mode: 'scenario', scene: 1, step: 0, script: { step: 0, anchors: {} } },
    pm: { stop: vi.fn(), postMessage: vi.fn(), decidePlan: vi.fn() },
    save: vi.fn(), changed: vi.fn(), persistAttachments: vi.fn(), createPm: vi.fn(),
  });
  return { app, store, ctx: { projectId: app.meta.projectId, targetProductId: 'ensemble-demo' } };
}
it('starts a scenario with team facts only, never a committed fixture plan', async () => {
  const { app, store } = runtime();
  await app.startScenario('scene-1-3-continuous', true);
  const state = project(await store.read());
  expect(state.plan).toBeUndefined();
  expect(state.estimates.size).toBe(0);
  expect([...state.members.values()].filter(m => m.kind === 'human').map(m => m.memberId)).toEqual(['owner', 'designer']);
  expect(app.meta.script).toEqual({ step: 0, anchors: {} });
});
it('keeps project identity through scene 2 and routes attachment by role', async () => {
  const { app, store, ctx } = runtime();
  const events = sceneEvents(2, ctx);
  for (const e of events) if (e.type === 'plan_committed') {
    const p = e.payload as { tasks: { id: string; dependsOn: string[] }[] };
    for (const t of p.tasks) { t.id = `draft-${t.id}`; t.dependsOn = t.dependsOn.map(id => `draft-${id}`); }
  }
  await store.append(events);
  await store.append([{ ...ctx, actor: { kind: 'system', id: 'test' }, type: 'task_start_reserved', payload: { taskId: 'draft-design', specVersion: 1, trigger: 'approve' } }]);
  app.meta.script!.step = 6;
  await app.scenarioNext();
  expect(app.meta.projectId).toBe('retained-project');
  expect(app.meta.script!.step).toBe(7);
  expect(app.pm.postMessage).toHaveBeenCalledWith('designer', expect.any(String), [expect.objectContaining({ taskId: 'draft-design' })]);
  expect(project(await store.read()).plan?.tasks[0]?.id).toBe('draft-design');
});
it('persists a missing-role stop and refuses subsequent playback', async () => {
  const { app, store, ctx } = runtime();
  await store.append([
    { ...ctx, actor: { kind: 'system', id: 'test' }, type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: 'Owner' } },
    { ...ctx, actor: { kind: 'system', id: 'test' }, type: 'plan_proposed', payload: { proposalId: 'draft', forMemberId: 'owner', version: 1, tasks: [{ id: 'arbitrary', assignee: 'owner', dependsOn: [], title: 'interview', handoffConditions: ['interview'] }], estimates: [], reason: 'model draft' } },
  ]);
  app.meta.script!.step = 3;
  await expect(app.scenarioNext()).rejects.toThrow('디자이너');
  const stops = (await store.read()).filter(e => e.type === 'scenario_stopped');
  expect(stops).toHaveLength(1);
  expect(stops[0]?.payload).toMatchObject({ step: 3, reason: expect.stringContaining('디자이너') });
  await expect(app.scenarioNext()).rejects.toThrow('디자이너');
  expect((await store.read()).filter(e => e.type === 'scenario_stopped')).toHaveLength(1);
  expect(app.pm.decidePlan).not.toHaveBeenCalled();
});
