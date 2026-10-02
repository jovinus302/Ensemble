import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BASE_SHA, PAIRED_APPROVAL_SOURCE, PAIRED_MODELS, pairedApproval, pairedPlan, PROTOCOL_REVISION, RUBRIC_HASH } from '../src/protocol.ts';
import { claimPairedCell, completePairedCell, requiresBatchStop, type BatchClaim } from '../src/resume.ts';
import type { Report } from '../src/harness.ts';

const hashes = { starterHash: 'starter', evaluatorHash: 'evaluator', implementationHash: 'implementation' };
const authorized = { ...hashes, protocolRevision: PROTOCOL_REVISION, livePairedRuns: 8, previousConservativeAttempts: 8,
  totalAuthorizedSlots: 16, reruns: false, source: PAIRED_APPROVAL_SOURCE, approvedBy: 'test-only', toolsMatched: true,
  baseSha: BASE_SHA, rubricHash: RUBRIC_HASH, config: PAIRED_MODELS };
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'ensemble-v4-guard-')); roots.push(root);
  const outputRoot = path.join(root, 'output'); const registryRoot = path.join(root, 'claims');
  const manifest = { protocolRevision: PROTOCOL_REVISION, cells: pairedPlan(), config: PAIRED_MODELS, ...hashes };
  const options = { outputRoot, registryRoot, manifest, authorization: authorized };
  return { ...options, claim: (cellId: string) => claimPairedCell({ ...options, cellId }) };
}
async function finish(claim: BatchClaim, status: Report['status'] = 'failed', events: unknown[] = []) {
  const report = { cell: claim.cell, mode: 'live', protocolRevision: PROTOCOL_REVISION, status, events } as Report;
  await mkdir(path.join(claim.outputRoot, 'reports'), { recursive: true });
  await writeFile(path.join(claim.outputRoot, 'reports', `${claim.cell.id}.json`), JSON.stringify(report));
  await completePairedCell(claim, report);
}
it('freezes eight distinct cells, paired order, exact models and the new approval', () => {
  expect(pairedPlan().map(cell => cell.id)).toEqual(['v4-01','v4-02','v4-03','v4-04','v4-05','v4-06','v4-07','v4-08']);
  expect(pairedPlan().map(cell => `${cell.task}:${cell.provider}:${cell.ensemble}`)).toEqual([
    'A:codex:true','A:codex:false','A:claude:false','A:claude:true','B:claude:true','B:claude:false','B:codex:false','B:codex:true']);
  expect(() => pairedApproval(authorized, hashes, PAIRED_MODELS)).not.toThrow();
  for (const patch of [{ protocolRevision: 'revision-bound-validation-v3' }, { livePairedRuns: 2 }, { liveEightRuns: true }, { liveValidationRuns: 1 },
    { previousConservativeAttempts: 7 }, { totalAuthorizedSlots: 8 }, { reruns: true }, { source: 'old approval' }, { toolsMatched: false },
    { implementationHash: 'changed' }, { baseSha: 'old' }, { config: { ...PAIRED_MODELS, claude: { model: 'other', effort: 'xhigh' } } }]) {
    expect(() => pairedApproval({ ...authorized, ...patch }, hashes, PAIRED_MODELS)).toThrow('New v4');
  }
  expect(() => pairedApproval(authorized, hashes, { ...PAIRED_MODELS, codex: { model: 'gpt-6-astra', effort: 'high' } })).toThrow('exact frozen');
});
it('claims one cell atomically, rejects concurrent duplicate, replay and unfinished predecessor', async () => {
  const s = await setup();
  const attempts = await Promise.allSettled([s.claim('v4-01'), s.claim('v4-01')]);
  expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  await expect(s.claim('v4-01')).rejects.toThrow();
  await expect(s.claim('v4-02')).rejects.toThrow('no finalized receipt');
});
it('retains deterministic failed observations and permits exactly eight sequential fresh cells', async () => {
  const s = await setup();
  await expect(s.claim('v4-02')).rejects.toThrow('First cell');
  for (const cell of pairedPlan()) await finish(await s.claim(cell.id));
  await expect(s.claim('v4-08')).rejects.toThrow();
  await expect(s.claim('v4-09')).rejects.toThrow('registered');
});
it('binds batch to one output, authorization and immutable manifest', async () => {
  const s = await setup(); await finish(await s.claim('v4-01'));
  for (const patch of [{ outputRoot: `${s.outputRoot}-other` }, { authorization: { ...authorized, approvedBy: 'changed' } }, { manifest: { changed: true } }]) {
    await expect(claimPairedCell({ ...s, ...patch, cellId: 'v4-02' })).rejects.toThrow('cross-output reuse');
  }
  await writeFile(path.join(s.outputRoot, 'manifest.json'), '{}');
  await expect(s.claim('v4-02')).rejects.toThrow('manifest changed');
});
it('rejects existing output, orphan traces and tampered finalized evidence', async () => {
  const s = await setup(); await mkdir(s.outputRoot);
  await expect(s.claim('v4-01')).rejects.toThrow();
  const next = await setup(); await finish(await next.claim('v4-01'));
  await writeFile(path.join(next.outputRoot, 'reports/v4-02.events.jsonl'), '{}');
  await expect(next.claim('v4-02')).rejects.toThrow('output traces');
  await writeFile(path.join(next.outputRoot, 'reports/v4-01.json'), '{}');
  await expect(next.claim('v4-02')).rejects.toThrow('evidence or claim changed');
});
it.each(['STOP', 'PAUSE'])('%s blocks an otherwise eligible next cell', async marker => {
  const s = await setup(); await finish(await s.claim('v4-01'));
  await writeFile(path.join(s.outputRoot, marker), 'Known harness issue');
  await expect(s.claim('v4-02')).rejects.toThrow(marker);
});
it.each(['interrupted', 'environment_blocked', 'validation_not_run'] as const)('automatically stops after %s', async status => {
  const s = await setup(); await finish(await s.claim('v4-01'), status);
  expect(await readFile(path.join(s.outputRoot, 'STOP'), 'utf8')).toContain(status);
  await expect(s.claim('v4-02')).rejects.toThrow('STOP');
});
it.each(['cleanup-error', 'artifact-error', 'artifact-unstable'])('automatically stops after %s even with a passing report', async type => {
  const s = await setup(); await finish(await s.claim('v4-01'), 'passed', [{ type }]);
  await expect(s.claim('v4-02')).rejects.toThrow('STOP');
});
it('stops unavailable pinned models without substituting another model', () => {
  for (const error of ['Unknown model claude-opus-4-8', 'Model gpt-6-astra is not available', 'Unsupported model'])
    expect(requiresBatchStop({ status: 'failed', events: [], error } as unknown as Report)).toBe(true);
  expect(requiresBatchStop({ status: 'failed', events: [], error: 'Reservation button is broken' } as unknown as Report)).toBe(false);
});
