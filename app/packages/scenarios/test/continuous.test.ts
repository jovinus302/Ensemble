import { rm } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { project, type AnyEvent } from '@ensemble/core';
import { advanceScript, continuousScenario } from '../src/index.ts';
import { setup } from './continuous-fixture.ts';
it.each([false, true])('runs scenes 1–3 on the drafted plan with reversed model output %s', async reverse => {
  const f = await setup(reverse);
  try {
    const steps = continuousScenario.steps.map(s => ({ ...s, ...(s.waitFor ? { waitFor: { ...s.waitFor, timeoutMs: 1000 } } : {}) }));
    while (f.progress.step < steps.length) {
      if (reverse && f.progress.step === 3) {
        const proposal = [...project(await f.store.read()).pendingPlans.values()][0]!;
        await f.pm.decidePlan(proposal.proposalId, 'owner', true);
      }
      await advanceScript(f.host, steps, f.progress, { ...continuousScenario.completion, timeoutMs: 1000 });
      if (f.progress.step === 5 || f.progress.step === 9) {
        // Attachment and chat both return while an execution agent is still active.
        const snapshot = await f.store.read() as AnyEvent[];
        expect(project(snapshot).activeTurn.size).toBeGreaterThan(0);
        expect(snapshot.some(e => e.type === 'turn_observed' && e.payload.status === 'completed')).toBe(false);
        expect(snapshot.some(e => e.type === 'message_recorded' && e.payload.text === steps[f.progress.step - 1]!.text)).toBe(true);
      }
    }
    await f.pm.flush();
    const events = await f.store.read() as AnyEvent[], state = project(events);
    expect(f.stops).toEqual([]);
    expect(state.plan?.version).toBe(2);
    expect(state.plan?.tasks.map(t => t.id)).toEqual(f.ids);
    expect(state.availability.get('owner')).toBe(10);
    expect(state.availability.get('designer')).toBe(5);
    expect(f.connector.starts.map(t => t.taskId)).toEqual(['research', 'prototype']);
    expect(f.connector.updates).toHaveLength(1);
    expect(events.filter(e => e.type === 'result_submitted').map(e => e.payload.taskId).sort()).toEqual(['flow', 'flow', 'interview', 'interview', 'research']);
    expect(events.filter(e => e.type === 'plan_committed')).toHaveLength(2);
    expect(events.filter(e => e.type === 'revision_requested')).toHaveLength(2);
    expect(f.inputs).toHaveLength(2);
    for (const input of f.inputs) {
      expect(Object.keys(input).sort()).toEqual(['title', 'handoffConditions', 'request', 'previous', ...(input.draft ? ['draft'] : []), ...(input.sources ? ['sources'] : [])].sort());
      expect(events.some(e => e.type === 'pm_spoke' && e.payload.text === input.request)).toBe(true);
      expect(JSON.stringify(input)).not.toContain('handoff-notice:');
      expect(JSON.stringify(input)).not.toContain('considerationId');
    }
    expect(f.inputs[0]!.sources).toBeUndefined();
    expect(f.inputs[1]!.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'research.md', content: '조사 보고서' }),
      expect.objectContaining({ content: expect.stringContaining('보완 내용:') }),
    ]));
    // Only accepted versions become source material, never the insufficient original interview.
    expect(f.inputs[1]!.sources).toHaveLength(2);
    expect(f.progress.revisions).toEqual({ interview: 1, flow: 1 });
    expect(events.some(e => e.type === 'update_acknowledged')).toBe(true);
  } finally { await f.pm.stop(); await rm(f.workspace, { recursive: true, force: true }); }
});
it('stops after two revisions, preserving the unmet request and refusing more input', async () => {
  const f = await setup(false, undefined, true);
  try {
    for (let i = 0; i < 5; i++) await advanceScript(f.host, continuousScenario.steps, f.progress);
    await expect(advanceScript(f.host, continuousScenario.steps, f.progress)).rejects.toThrow('보완 2회 후 미충족');
    expect(f.inputs).toHaveLength(2);
    expect(f.stops).toHaveLength(1);
    expect(f.stops[0]).toContain('개인별 예약 빈도');
    expect(f.inputs[1]!.previous[0]!.content).toMatch(/^시연용 가상 자료 — 보완 1회차/);
    await expect(advanceScript(f.host, continuousScenario.steps, f.progress)).rejects.toThrow('보완 2회');
    expect(f.inputs).toHaveLength(2);
  } finally { await f.pm.stop(); await rm(f.workspace, { recursive: true, force: true }); }
});
it.each(['designer', 'prototype-agent'])('stops with evidence when drafted plan lacks %s', async missing => {
  const f = await setup(false, missing);
  try {
    for (let i = 0; i < (missing === 'designer' ? 1 : 2); i++) await advanceScript(f.host, continuousScenario.steps, f.progress);
    await expect(advanceScript(f.host, continuousScenario.steps, f.progress)).rejects.toThrow(missing);
    expect(f.stops).toHaveLength(1);
    expect(project(await f.store.read()).plan).toBeUndefined();
    expect(f.connector.starts).toEqual([]);
  } finally { await f.pm.stop(); await rm(f.workspace, { recursive: true, force: true }); }
});
