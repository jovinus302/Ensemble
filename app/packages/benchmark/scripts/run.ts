import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { pairedApproval, pairedPlan, PAIRED_MODELS, NEW_BATCH_SLOTS, validationPlan, BASE_SHA, LIMITS, plan, PROTOCOL_REVISION, RUBRIC, RUBRIC_HASH } from '../src/protocol.ts';
import { APP_ROOT, localServices, PACKAGE_ROOT, treeHash } from '../src/local.ts';
import { isBatchPaused, runCell, type Report } from '../src/harness.ts';
import { assertCodexSchemaReady } from '../src/preflight.ts';
import { assertBatchOpen, claimPairedCell, completePairedCell, type BatchClaim } from '../src/resume.ts';

const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
for (const flag of ['--cell', '--output', '--approval-file', '--config']) {
  if (args.filter(arg => arg === flag).length > 1 || (args.includes(flag) && (!value(flag) || value(flag)!.startsWith('--')))) throw new Error(`Ambiguous ${flag}`);
}
const live = args.includes('--live');
const fixture = args.includes('--fixture');
if (live && fixture) throw new Error('Choose exactly one mode');
if (args.includes('--resume')) throw new Error('No retries or resumed live attempts are authorized; select the next unattempted --cell');
if (live && args.includes('--validation-run')) throw new Error('The old v3 authorization is exhausted and invalid for this batch');
if (live && (!value('--cell') || !value('--output'))) throw new Error('Live paired runs require one explicit --cell v4-01..08 and a fixed --output');
const allCells = fixture ? (args.includes('--validation-run') ? validationPlan() : plan()) : pairedPlan();
const cells = value('--cell') ? allCells.filter(cell => cell.id === value('--cell')) : allCells;
if (!cells.length) throw new Error('Unknown registered cell');
const starterHash = await treeHash(path.join(PACKAGE_ROOT, 'starter'));
const evaluatorHash = await treeHash(path.join(PACKAGE_ROOT, 'browser'));
const implementationHash = createHash('sha256').update(await treeHash(path.join(PACKAGE_ROOT, 'src')))
  .update(await treeHash(path.join(PACKAGE_ROOT, 'scripts'))).digest('hex');
const manifest = { protocolRevision: PROTOCOL_REVISION, baseSha: BASE_SHA, rubricHash: RUBRIC_HASH, starterHash, evaluatorHash, implementationHash,
  rubric: RUBRIC, limits: LIMITS, cells: allCells, models: PAIRED_MODELS, previousConservativeAttempts: 8, totalAuthorizedSlots: 16,
  plannedLiveRuns: NEW_BATCH_SLOTS, execution: 'one explicitly selected cell per invocation; no retries' };
if (!live && !fixture) {
  console.log(JSON.stringify({ mode: 'plan-only', ...manifest }, null, 2));
} else {
  let config: Record<string, { model: string; effort: string }> = {};
  let authorization: Record<string, unknown> = {};
  if (live) {
    const file = value('--approval-file'); const configFile = value('--config');
    if (!file || !configFile) throw new Error('Explicit new approval and frozen provider config required; no provider imported or called');
    authorization = JSON.parse(await readFile(path.resolve(file), 'utf8'));
    config = JSON.parse(await readFile(path.resolve(configFile), 'utf8'));
    pairedApproval(authorization, { starterHash, evaluatorHash, implementationHash }, config);
    const git = promisify(execFile);
    const actualBase = (await git('git', ['merge-base', 'HEAD', BASE_SHA], { cwd: APP_ROOT, windowsHide: true })).stdout.trim();
    if (actualBase !== BASE_SHA) throw new Error('Checkout is not based on pinned main');
    const changed = (await git('git', ['diff', '--name-only', BASE_SHA, '--', 'packages/agents', 'packages/core', 'packages/llm', 'packages/orchestrator', 'packages/store'], { cwd: APP_ROOT, windowsHide: true })).stdout.trim();
    if (changed) throw new Error(`Production benchmark dependencies differ from pinned main: ${changed}`);
    await assertCodexSchemaReady();
  }
  const outputRoot = path.resolve(value('--output') ?? path.join(PACKAGE_ROOT, '.local', `fixture-${Date.now()}`));
  let claim: BatchClaim | undefined;
  if (live) {
    claim = await claimPairedCell({ cellId: cells[0]!.id, outputRoot,
      // Shared workspace registry prevents changing output roots or local worktrees from replaying this approval.
      registryRoot: path.resolve(APP_ROOT, '../../.benchmark-claims/paired-validation-v4'),
      manifest: { ...manifest, mode: 'live', config }, authorization });
  } else {
    await mkdir(path.dirname(outputRoot), { recursive: true }); await mkdir(outputRoot, { recursive: false });
    await writeFile(path.join(outputRoot, 'manifest.json'), JSON.stringify({ ...manifest, mode: 'fixture', config }, null, 2));
  }
  process.env.BENCH_APP_ROOT = APP_ROOT;
  const cancellation = new AbortController();
  const interrupt = () => cancellation.abort(new Error('user interrupted'));
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  const reports: Report[] = [];
  try {
    for (const cell of cells) {
      if (live) await assertBatchOpen(outputRoot);
      if (cancellation.signal.aborted || isBatchPaused(outputRoot)) { console.error('Batch paused: no cell started'); process.exitCode = 1; break; }
      process.env.BENCH_TASK = cell.task;
      const selected = config[cell.provider] ?? { model: 'fixture-reference', effort: 'none' };
      const report = await runCell(cell, localServices(cell, { mode: fixture ? 'fixture' : 'live', outputRoot, ...selected }), {
        mode: fixture ? 'fixture' : 'live', ...selected, starterHash, cacheState: 'unknown', outputDir: path.join(outputRoot, 'reports'), signal: cancellation.signal,
      });
      if (claim) await completePairedCell(claim, report);
      reports.push(report); console.log(`${cell.id} ${report.mode} ${report.status} ${report.totalMs}ms`);
      const batchReports: Report[] = live ? await Promise.all((await readdir(path.join(outputRoot, 'reports'))).filter(file => /^v4-\d{2}\.json$/.test(file))
        .sort().map(async file => JSON.parse(await readFile(path.join(outputRoot, 'reports', file), 'utf8')) as Report)) : reports;
      await writeFile(path.join(outputRoot, 'summary.json'), JSON.stringify({ mode: fixture ? 'fixture' : 'live', exploratoryOnly: true,
        warning: fixture ? 'Harness reference smoke tests, NOT model performance results' : 'n=1 exploratory paired observations; no superiority inference', reports: batchReports,
        notRun: allCells.filter(c => !batchReports.some(r => r.cell.id === c.id)).map(c => c.id) }, null, 2));
      if (live) console.log('One cell complete. Review its evidence and create STOP for any harness/orchestration defect before explicitly selecting the next cell.');
      if (report.status === 'interrupted' || report.events.some(e => (e as { type?: string })?.type === 'cleanup-error')) break;
    }
  } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); }
  if (reports.some(r => r.status !== 'passed')) process.exitCode = 1;
}
