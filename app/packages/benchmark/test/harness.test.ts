import { expect, it } from 'vitest';
import { approval, BASE_SHA, Budget, plan, RUBRIC_HASH } from '../src/protocol.ts';
import { runCell, type Services } from '../src/harness.ts';

const cell = plan()[4]!;
const options = { mode: 'fixture' as const, model: 'fixture', effort: 'none', starterHash: 'test', pollMs: 1 };
function fake(overrides: Partial<Services> = {}) {
  const log: string[] = [];
  const services: Services = {
    async prepare() { log.push('prepare'); },
    async driver({ meter }) { return {
      async start() { await meter('worker', async () => { log.push('start'); }); },
      async change() { log.push('change'); }, async settled() { return true; }, async stop() { log.push('stop'); },
    }; },
    async build() { log.push('build'); },
    async inspect(checkpoint) { log.push(checkpoint ? 'checkpoint' : 'acceptance'); return { passed: true, checks: [{ id: 'mock', pass: true }] }; },
    async freezeArtifact() { log.push('freeze'); }, async cleanup() { log.push('cleanup'); }, ...overrides,
  };
  return { services, log };
}
it('crosses over provider blocks and each paired condition without missing cells', () => {
  const rows = plan(); expect(rows).toHaveLength(8);
  expect(new Set(rows.map(r => `${r.task}/${r.provider}/${r.ensemble}`)).size).toBe(8);
  for (const p of ['codex', 'claude']) {
    expect(rows.filter(r => r.provider === p && r.task === 'B').map(r => r.ensemble))
      .toEqual(rows.filter(r => r.provider === p && r.task === 'A').map(r => r.ensemble).reverse());
  }
});
it('requires explicit provenance and exact frozen protocol for live runs', () => {
  for (const value of [null, {}, { liveEightRuns: true }, { liveEightRuns: true, baseSha: BASE_SHA, rubricHash: 'wrong', source: 'parent', approvedBy: 'owner' }]) {
    expect(() => approval(value)).toThrow();
  }
  expect(() => approval({ liveEightRuns: true, baseSha: BASE_SHA, rubricHash: RUBRIC_HASH, source: 'explicit parent authorization', approvedBy: 'owner' })).not.toThrow();
  const a = { liveEightRuns: true, baseSha: BASE_SHA, rubricHash: RUBRIC_HASH, source: 'parent', approvedBy: 'owner', toolsMatched: true,
    starterHash: 'starter', evaluatorHash: 'evaluator', implementationHash: 'implementation' };
  const hashes = { starterHash: 'starter', evaluatorHash: 'evaluator', implementationHash: 'implementation' };
  expect(() => approval(a, hashes)).not.toThrow();
  expect(() => approval({ ...a, toolsMatched: false }, hashes)).toThrow('toolsMatched');
  expect(() => approval({ ...a, evaluatorHash: 'changed' }, hashes)).toThrow('hashes');
});
it('reserves concurrent calls before executing and retains failed calls', async () => {
  const b = new Budget(new AbortController().signal, () => 0, { calls: 2, totalMs: 100 });
  const results = await Promise.allSettled([b.meter('pm', async () => 1), b.meter('judge', async () => { throw Error('provider'); }), b.meter('worker', async () => 3)]);
  expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'rejected']);
  expect(b.calls.map(c => c.status)).toEqual(['completed', 'failed']);
});
it('does not start a call at the deadline or after cancellation', async () => {
  let now = 0; const c = new AbortController(); const b = new Budget(c.signal, () => now, { calls: 2, totalMs: 10 });
  now = 10; await expect(b.meter('worker', async () => 1)).rejects.toThrow('timeout');
  now = 0; c.abort(); await expect(b.meter('pm', async () => 1)).rejects.toThrow(); expect(b.calls).toHaveLength(0);
});
it('injects B only after build AND actual browser selection, and marks fixture explicitly', async () => {
  const f = fake(); const report = await runCell(cell, f.services, options);
  expect(f.log).toEqual(['prepare', 'start', 'build', 'checkpoint', 'change', 'build', 'acceptance', 'stop', 'cleanup', 'freeze']);
  expect(report).toMatchObject({ status: 'passed', mode: 'fixture', actualModelInvocations: 0, usage: null, costUsd: null });
  expect(report.changeMs).not.toBeNull(); expect(report.afterChangeMs).not.toBeNull();
});
it.each(['build', 'selection'])('checkpoint %s failure never injects the change', async kind => {
  const f = fake(kind === 'build' ? { async build() { throw Error('build failed'); } } : {
    async inspect() { return { passed: false, checks: [{ id: 'selection', pass: false }] }; },
  });
  const report = await runCell(cell, f.services, options);
  expect(report.status).toBe('checkpoint_failed'); expect(report.changeMs).toBeNull(); expect(f.log).not.toContain('change');
  expect(f.log).toContain('cleanup');
});
it('records failed acceptance instead of reporting synthetic success', async () => {
  const f = fake({ async inspect() { return { passed: false, checks: [{ id: 'console', pass: false }] }; } });
  expect((await runCell(plan()[0]!, f.services, options)).status).toBe('failed');
});
it('watchdog interrupts a hung worker and records timeout', async () => {
  let stopped = false;
  const f = fake({ async driver() { return { start: () => new Promise(() => {}), async change() {}, async settled() { return false; }, async stop() { stopped = true; } }; } });
  const report = await runCell(cell, f.services, { ...options, limits: { calls: 24, totalMs: 25 } });
  expect(report.status).toBe('timeout'); expect(stopped).toBe(true); expect(report.changeMs).toBeNull();
});
it('call exhaustion is distinct from ordinary failure', async () => {
  const f = fake(); const report = await runCell(cell, f.services, { ...options, limits: { calls: 0, totalMs: 1000 } });
  expect(report.status).toBe('call_limit'); expect(report.actualModelInvocations).toBe(0);
});
it('keeps human requests separate from actual help', async () => {
  const f = fake({ async driver({ record }) { return { async start() {}, async change() {}, async settled() { return true; },
    async stop() { record({ type: 'native_ledger', events: [{ type: 'decision_requested', payload: { requestId: 'help' } }] }); } }; } });
  const report = await runCell(plan()[0]!, f.services, options);
  expect(report.humanRequests).toEqual([{ requestId: 'help' }]); expect(report.humanInterventions).toEqual([]);
});
it('does not freeze a workspace when cleanup failed', async () => {
  const f = fake({ async cleanup() { throw Error('still running'); } });
  const report = await runCell(plan()[0]!, f.services, options);
  expect(report.status).toBe('failed'); expect(f.log).not.toContain('freeze');
  expect(report.events).toContainEqual(expect.objectContaining({ type: 'artifact-unstable' }));
});
