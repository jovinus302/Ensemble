import type { Report } from './harness.ts';
import { BASE_SHA, pairedPlan, plan, PROTOCOL_REVISION, RUBRIC_HASH, type Cell } from './protocol.ts';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

/** Resume unattempted cells only. Failed cells are completed observations, never retries. */
export function pendingCells(reports: Report[], starterHash: string, config: Record<string, { model: string; effort: string }>) {
  const ids = new Set<string>();
  for (const report of reports) {
    const expected = plan().find(cell => cell.id === report.cell?.id);
    if (!expected || ids.has(expected.id) || report.mode !== 'live' || report.baseSha !== BASE_SHA || report.rubricHash !== RUBRIC_HASH
      || report.starterHash !== starterHash || report.cell.task !== expected.task || report.cell.provider !== expected.provider
      || report.cell.ensemble !== expected.ensemble || report.model !== config[expected.provider]?.model || report.effort !== config[expected.provider]?.effort
      || !['passed', 'failed', 'timeout', 'call_limit', 'checkpoint_failed', 'interrupted'].includes(report.status)) {
      throw new Error('Resume report does not match the frozen live experiment');
    }
    ids.add(expected.id);
  }
  return plan().filter(cell => !ids.has(cell.id));
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown): string => JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child)
  ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child);
const exists = async (file: string) => { try { await readFile(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } };
export async function assertBatchOpen(outputRoot: string): Promise<void> {
  for (const marker of ['STOP', 'PAUSE']) if (await exists(path.join(outputRoot, marker))) throw new Error(`Batch ${marker} marker blocks every later cell; no automatic retry`);
}
export interface BatchClaim { cell: Cell; outputRoot: string; registryRoot: string; fingerprint: string }
/** Durable, fail-closed claims shared across output directories. A claim without a
 * completion receipt consumes its slot and blocks subsequent execution. */
export async function claimPairedCell(options: {
  cellId: string; outputRoot: string; registryRoot: string; manifest: unknown; authorization: unknown;
}): Promise<BatchClaim> {
  const cells = pairedPlan(); const cell = cells.find(item => item.id === options.cellId);
  if (!cell) throw new Error('Select exactly one registered v4 cell');
  const outputRoot = path.resolve(options.outputRoot); const registryRoot = path.resolve(options.registryRoot);
  const fingerprint = hash(canonical({ manifest: options.manifest, authorization: options.authorization, outputRoot }));
  const batch = { fingerprint, outputRoot, manifest: options.manifest, authorization: options.authorization };
  await mkdir(registryRoot, { recursive: true });
  const registryManifest = path.join(registryRoot, 'batch.json');
  if (!await exists(registryManifest)) {
    if (cell.ordinal !== 1) throw new Error('First cell must initialize this batch');
    // A pre-existing output (even empty) is not an authorized fresh experiment.
    await mkdir(path.dirname(outputRoot), { recursive: true });
    await mkdir(outputRoot, { recursive: false });
    await writeFile(registryManifest, JSON.stringify(batch, null, 2), { flag: 'wx' });
    await writeFile(path.join(outputRoot, 'manifest.json'), JSON.stringify(options.manifest, null, 2), { flag: 'wx' });
  }
  const saved = JSON.parse(await readFile(registryManifest, 'utf8'));
  if (saved.fingerprint !== fingerprint || saved.outputRoot !== outputRoot) throw new Error('Batch is bound to another output, authorization or protocol; cross-output reuse is forbidden');
  if (canonical(JSON.parse(await readFile(path.join(outputRoot, 'manifest.json'), 'utf8'))) !== canonical(options.manifest)) throw new Error('Batch manifest changed');
  await assertBatchOpen(outputRoot);
  for (const previous of cells.slice(0, cell.ordinal - 1)) {
    const claimFile = path.join(registryRoot, `${previous.id}.claim.json`);
    const receiptFile = path.join(registryRoot, `${previous.id}.complete.json`);
    if (!await exists(claimFile) || !await exists(receiptFile)) throw new Error(`Previous cell ${previous.id} has no finalized receipt; an unfinished trace cannot be retried or skipped`);
    const claimed = JSON.parse(await readFile(claimFile, 'utf8'));
    const receipt = JSON.parse(await readFile(receiptFile, 'utf8'));
    const reportText = await readFile(path.join(outputRoot, 'reports', `${previous.id}.json`), 'utf8');
    if (claimed.fingerprint !== fingerprint || receipt.fingerprint !== fingerprint || receipt.reportHash !== hash(reportText)) throw new Error('Previous cell evidence or claim changed');
    const report = JSON.parse(reportText) as Report;
    if (canonical(report.cell) !== canonical(previous) || report.mode !== 'live' || report.protocolRevision !== PROTOCOL_REVISION) throw new Error('Previous report is not this registered live cell');
  }
  for (const later of cells.slice(cell.ordinal)) if (await exists(path.join(registryRoot, `${later.id}.claim.json`))) throw new Error('A later cell has already been claimed');
  const reportDir = path.join(outputRoot, 'reports');
  const traces = await readdir(reportDir).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
  if (traces.some(name => name === `${cell.id}.json` || name.startsWith(`${cell.id}.`))) throw new Error('Cell already has output traces; ambiguous attempts cannot be retried');
  await writeFile(path.join(registryRoot, `${cell.id}.claim.json`), JSON.stringify({ fingerprint, cell, outputRoot, claimedAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
  return { cell, outputRoot, registryRoot, fingerprint };
}
export function requiresBatchStop(report: Report): boolean {
  return ['interrupted', 'environment_blocked', 'validation_not_run'].includes(report.status)
    || /(?:model[^\n]*(?:not found|not available|unavailable|unsupported|does not exist|not supported)|(?:unknown|invalid|unsupported|unavailable)[^\n]*model)/i.test(report.error ?? '')
    || report.events.some(event => ['cleanup-error', 'artifact-error', 'artifact-unstable'].includes((event as { type?: string })?.type ?? ''));
}
export async function completePairedCell(claim: BatchClaim, report: Report): Promise<void> {
  const reportText = await readFile(path.join(claim.outputRoot, 'reports', `${claim.cell.id}.json`), 'utf8');
  if (canonical(JSON.parse(reportText)) !== canonical(report) || canonical(report.cell) !== canonical(claim.cell)
    || report.mode !== 'live' || report.protocolRevision !== PROTOCOL_REVISION) throw new Error('Final report does not match claimed cell');
  if (requiresBatchStop(report)) await writeFile(path.join(claim.outputRoot, 'STOP'), `Review required after ${claim.cell.id}: ${report.status}; no retry or model substitution.\n`);
  await writeFile(path.join(claim.registryRoot, `${claim.cell.id}.complete.json`), JSON.stringify({ fingerprint: claim.fingerprint,
    reportHash: hash(reportText), status: report.status, completedAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
}
