import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { validationApproval, validationPlan, VALIDATION_MODEL, VALIDATION_CRITERIA, VALIDATION_CRITERIA_HASH, BASE_SHA, LIMITS, plan, PROTOCOL_REVISION, RUBRIC, RUBRIC_HASH } from '../src/protocol.ts';
import { APP_ROOT, localServices, PACKAGE_ROOT, treeHash } from '../src/local.ts';
import { isBatchPaused, runCell, type Report } from '../src/harness.ts';
import { assertCodexSchemaReady } from '../src/preflight.ts';

const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const live = args.includes('--live');
const fixture = args.includes('--fixture');
const validationRun = args.includes('--validation-run');
const cells = validationRun ? validationPlan() : plan();
if (live && fixture) throw new Error('Choose exactly one mode');
if (args.includes('--resume')) throw new Error('No retries or resumed live attempts are authorized');
if (live && !validationRun) throw new Error('Only the single remaining --validation-run is eligible for live authorization');
if (live && !value('--output')) throw new Error('Live validation requires a new explicit output directory');
const starterHash = await treeHash(path.join(PACKAGE_ROOT, 'starter'));
const evaluatorHash = await treeHash(path.join(PACKAGE_ROOT, 'browser'));
const implementationHash = createHash('sha256').update(await treeHash(path.join(PACKAGE_ROOT, 'src')))
  .update(await treeHash(path.join(PACKAGE_ROOT, 'scripts'))).digest('hex');
const manifest = { protocolRevision: PROTOCOL_REVISION, baseSha: BASE_SHA, rubricHash: RUBRIC_HASH, starterHash, evaluatorHash, implementationHash, rubric: RUBRIC, limits: LIMITS, cells, ...(validationRun ? { model: VALIDATION_MODEL, validationCriteria: VALIDATION_CRITERIA, validationCriteriaHash: VALIDATION_CRITERIA_HASH, previousConservativeAttempts: 7, totalAuthorizedSlots: 8, plannedLiveRuns: 1, remainingAfterStart: 0 } : {}) };
if (!live && !fixture) {
  console.log(JSON.stringify({ mode: 'plan-only', ...manifest }, null, 2));
} else {
  let config: Record<string, { model: string; effort: string }> = {};
  let authorization: Record<string, unknown> = {};
  if (live) {
    const file = value('--approval-file');
    if (!file) throw new Error('Live approval missing; no provider imported or called');
    authorization = JSON.parse(await readFile(path.resolve(file), 'utf8'));
    validationApproval(authorization, { starterHash, evaluatorHash, implementationHash });
    const git = promisify(execFile);
    const actualBase = (await git('git', ['merge-base', 'HEAD', BASE_SHA], { cwd: APP_ROOT, windowsHide: true })).stdout.trim();
    if (actualBase !== BASE_SHA) throw new Error('Checkout is not based on pinned main');
    const changed = (await git('git', ['diff', '--name-only', BASE_SHA, '--', 'packages/agents', 'packages/core', 'packages/llm', 'packages/orchestrator', 'packages/store'], { cwd: APP_ROOT, windowsHide: true })).stdout.trim();
    if (changed) throw new Error(`Production benchmark dependencies differ from pinned main: ${changed}`);
    await assertCodexSchemaReady();
    const configFile = value('--config');
    if (!configFile) throw new Error('Explicit pinned provider models/efforts config required');
    config = JSON.parse(await readFile(path.resolve(configFile), 'utf8'));
    for (const provider of ['codex']) {
      const c = config[provider];
      if (c?.model !== VALIDATION_MODEL.model || c?.effort !== VALIDATION_MODEL.effort) throw new Error(`Config must match preregistered ${provider} model and effort`);
    }
  }
  const outputRoot = path.resolve(value('--output') ?? path.join(PACKAGE_ROOT, '.local', `${fixture ? 'fixture' : 'live'}-${Date.now()}`));
  const reports: Report[] = [];
  // Never replace or resume an attempt directory, including an unfinished attempt.
  await mkdir(path.dirname(outputRoot), { recursive: true });
  await mkdir(outputRoot, { recursive: false });
  await writeFile(path.join(outputRoot, 'manifest.json'), JSON.stringify({ ...manifest, mode: fixture ? 'fixture' : 'live', config }, null, 2));
  if (live) {
    // This worktree has one reserved live slot. Claim it atomically before constructing providers.
    // A failed/interrupted attempt keeps the claim; changing output/approval files cannot replay it.
    const claim = path.join(PACKAGE_ROOT, '.local', 'validation-v3-slot-08.claim');
    await mkdir(path.dirname(claim), { recursive: true });
    await writeFile(claim, JSON.stringify({ outputRoot, manifest, authorization, claimedAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
  }
  process.env.BENCH_APP_ROOT = APP_ROOT;
  const cancellation = new AbortController();
  const interrupt = () => cancellation.abort(new Error('user interrupted'));
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  try {
  for (const cell of cells) {
    // Soft pause is checked immediately before constructing services or launching each next cell.
    if (cancellation.signal.aborted || isBatchPaused(outputRoot)) {
      console.error('Batch paused: no next cell started. Remove PAUSE only after renewed authorization.');
      process.exitCode = 1; break;
    }
    process.env.BENCH_TASK = cell.task;
    const selected = config[cell.provider] ?? { model: 'fixture-reference', effort: 'none' };
    const report = await runCell(cell, localServices(cell, { mode: fixture ? 'fixture' : 'live', outputRoot, ...selected }), {
      mode: fixture ? 'fixture' : 'live', ...selected, starterHash, cacheState: 'unknown', outputDir: path.join(outputRoot, 'reports'), signal: cancellation.signal,
    });
    reports.push(report); console.log(`${cell.id} ${report.mode} ${report.status} ${report.totalMs}ms`);
    await writeFile(path.join(outputRoot, 'summary.json'), JSON.stringify({ mode: fixture ? 'fixture' : 'live', exploratoryOnly: true,
      warning: fixture ? 'Harness reference smoke tests, NOT model performance results' : 'Single validation-flow observation; NOT a paired performance comparison', reports,
      notRun: cells.filter(c => !reports.some(r => r.cell.id === c.id)).map(c => c.id) }, null, 2));
    if (report.status === 'interrupted' || report.events.some(e => (e as { type?: string })?.type === 'cleanup-error')) {
      console.error(`Batch stopped: ${report.status === 'interrupted' ? 'user interrupted' : 'cleanup incomplete'}. Remaining cells are unrun, not successful.`); break;
    }
  }
  } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); }
  if (reports.some(r => r.status !== 'passed')) process.exitCode = 1;
}
