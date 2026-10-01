import { expect, it } from 'vitest';
import { approval, BASE_SHA, Budget, pairedPlan, plan, PROTOCOL_REVISION, RUBRIC_HASH } from '../src/protocol.ts';
import { assertSameProtocol, isBatchPaused, runCell, type Services } from '../src/harness.ts';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
  expect(() => approval({ liveEightRuns: true, baseSha: BASE_SHA, rubricHash: RUBRIC_HASH, source: 'explicit parent authorization', approvedBy: 'owner' }, undefined, 'codex')).toThrow();
  const a = { livePairedRuns: 2, provider: 'codex', task: 'A', previousConservativeAttempts: 5, totalAuthorizedSlots: 8, reruns: false,
    baseSha: BASE_SHA, rubricHash: RUBRIC_HASH, source: 'parent', approvedBy: 'owner', toolsMatched: true,
    starterHash: 'starter', evaluatorHash: 'evaluator', implementationHash: 'implementation' };
  const hashes = { starterHash: 'starter', evaluatorHash: 'evaluator', implementationHash: 'implementation' };
  expect(() => approval(a, hashes, 'codex')).not.toThrow();
  expect(() => approval(a, hashes)).toThrow('Full eight-cell');
  expect(() => approval({ ...a, toolsMatched: false }, hashes, 'codex')).toThrow('toolsMatched');
  expect(() => approval({ ...a, evaluatorHash: 'changed' }, hashes, 'codex')).toThrow('hashes');
  for (const mismatch of [{ livePairedRuns: 3 }, { provider: 'claude' }, { task: 'B' }, { previousConservativeAttempts: 4 },
    { previousConservativeAttempts: 7 }, { totalAuthorizedSlots: 9 }, { reruns: true }, { liveEightRuns: true }]) {
    expect(() => approval({ ...a, ...mismatch }, hashes, 'codex')).toThrow();
  }
});
it('paired plans select only the two preregistered Task A conditions', () => {
  expect(pairedPlan('codex').map(c => c.id)).toEqual(['pilot-01', 'pilot-02']);
  expect(pairedPlan('claude').map(c => c.id)).toEqual(['pilot-03', 'pilot-04']);
  for (const provider of ['codex', 'claude']) {
    const cells = pairedPlan(provider); expect(cells).toHaveLength(2);
    expect(cells.every(c => c.task === 'A' && c.provider === provider)).toBe(true);
    expect(new Set(cells.map(c => c.ensemble)).size).toBe(2);
    expect(8 - 5 - cells.length).toBe(1);
  }
  expect(() => pairedPlan('other')).toThrow();
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

it('already aborted never prepares or launches a provider', async () => {
  const controller = new AbortController(); controller.abort(new Error('owner cancelled'));
  let launched = false;
  const f = fake({ async driver() { launched = true; throw Error('must not launch'); } });
  const report = await runCell(cell, f.services, { ...options, signal: controller.signal });
  expect(report.status).toBe('interrupted'); expect(launched).toBe(false);
  expect(f.log).not.toContain('prepare'); expect(report.calls).toHaveLength(0);
});

it('abort preserves a hung startup attempt journal and JSON despite hung stop', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'ensemble-abort-'));
  const controller = new AbortController(); let cleaned = false;
  let entered!: () => void; const starting = new Promise<void>(resolve => { entered = resolve; });
  const f = fake({ async driver({ meter }) { return {
    async start() { await meter('worker', async () => { entered(); return new Promise<void>(() => {}); }); },
    async change() {}, async settled() { return false; }, stop: () => new Promise<void>(() => {}),
  }; }, async cleanup() { cleaned = true; } });
  try {
    const pending = runCell(cell, f.services, { ...options, mode: 'live', outputDir, signal: controller.signal, limits: { calls: 24, totalMs: 100 } });
    await starting;
    const journal = await readFile(path.join(outputDir, `${cell.id}.events.jsonl`), 'utf8');
    expect(JSON.parse(journal.trim()).event).toMatchObject({ type: 'call-attempt', role: 'worker', count: 1, startMs: expect.any(Number) });
    controller.abort(new Error('owner cancelled'));
    const report = await pending;
    expect(report.status).toBe('interrupted'); expect(cleaned).toBe(true);
    expect(report.calls).toHaveLength(1); expect(report.calls[0]!.status).toBe('running');
    expect(JSON.parse(await readFile(path.join(outputDir, `${cell.id}.json`), 'utf8')).status).toBe('interrupted');
    expect(report.events).toContainEqual(expect.objectContaining({ type: 'cleanup-error' }));
  } finally { await rm(outputDir, { recursive: true, force: true }); }
});

it('PAUSE sentinel prevents the next cell without touching existing reports', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ensemble-pause-'));
  try {
    expect(isBatchPaused(root)).toBe(false);
    await writeFile(path.join(root, 'PAUSE'), 'User paused the live batch');
    expect(isBatchPaused(root)).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('never resumes legacy observations into the revised development protocol', () => {
  expect(() => assertSameProtocol({})).toThrow('different protocol');
  expect(() => assertSameProtocol({ protocolRevision: 'prototype-role-v1' })).toThrow('different protocol');
  expect(() => assertSameProtocol({ protocolRevision: PROTOCOL_REVISION })).not.toThrow();
});
