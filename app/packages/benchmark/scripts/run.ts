import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { approval, BASE_SHA, LIMITS, plan, PROTOCOL_REVISION, RUBRIC, RUBRIC_HASH } from '../src/protocol.ts';
import { APP_ROOT, localServices, PACKAGE_ROOT, treeHash } from '../src/local.ts';
import { assertSameProtocol, isBatchPaused, runCell, type Report } from '../src/harness.ts';
import { pendingCells } from '../src/resume.ts';
import { assertCodexSchemaReady } from '../src/preflight.ts';

const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const live = args.includes('--live');
const fixture = args.includes('--fixture');
const resume = args.includes('--resume');
if (live && fixture) throw new Error('Choose exactly one mode');
if (resume && !live) throw new Error('Resume is only for an approved live batch');
const starterHash = await treeHash(path.join(PACKAGE_ROOT, 'starter'));
const evaluatorHash = await treeHash(path.join(PACKAGE_ROOT, 'browser'));
const implementationHash = createHash('sha256').update(await treeHash(path.join(PACKAGE_ROOT, 'src')))
  .update(await treeHash(path.join(PACKAGE_ROOT, 'scripts'))).digest('hex');
const manifest = { protocolRevision: PROTOCOL_REVISION, baseSha: BASE_SHA, rubricHash: RUBRIC_HASH, starterHash, evaluatorHash, implementationHash, rubric: RUBRIC, limits: LIMITS, cells: plan() };
if (!live && !fixture) {
  console.log(JSON.stringify({ mode: 'plan-only', ...manifest }, null, 2));
} else {
  let config: Record<string, { model: string; effort: string }> = {};
  let authorization: Record<string, unknown> = {};
  if (live) {
    const file = value('--approval-file');
    if (!file) throw new Error('Live approval missing; no provider imported or called');
    authorization = JSON.parse(await readFile(path.resolve(file), 'utf8'));
    approval(authorization, { starterHash, evaluatorHash, implementationHash });
    const git = promisify(execFile);
    const actualBase = (await git('git', ['merge-base', 'HEAD', BASE_SHA], { cwd: APP_ROOT, windowsHide: true })).stdout.trim();
    if (actualBase !== BASE_SHA) throw new Error('Checkout is not based on pinned main');
    const changed = (await git('git', ['diff', '--name-only', BASE_SHA, '--', 'packages/agents', 'packages/core', 'packages/llm', 'packages/orchestrator', 'packages/store'], { cwd: APP_ROOT, windowsHide: true })).stdout.trim();
    if (changed) throw new Error(`Production benchmark dependencies differ from pinned main: ${changed}`);
    await assertCodexSchemaReady();
    const configFile = value('--config');
    if (!configFile) throw new Error('Explicit pinned provider models/efforts config required');
    config = JSON.parse(await readFile(path.resolve(configFile), 'utf8'));
    for (const provider of ['codex', 'claude']) {
      const c = config[provider];
      if (!c?.model?.trim() || !c.effort?.trim() || /^(default|latest|fixture|TODO)$/i.test(c.model)) throw new Error(`Pin ${provider} model and effort`);
    }
  }
  const outputRoot = path.resolve(value('--output') ?? path.join(PACKAGE_ROOT, '.local', `${fixture ? 'fixture' : 'live'}-${Date.now()}`));
  const reports: Report[] = [];
  let cells = plan();
  if (resume) {
    if (!value('--output')) throw new Error('Resume requires the exact previous output directory');
    const previous = JSON.parse(await readFile(path.join(outputRoot, 'manifest.json'), 'utf8'));
    assertSameProtocol(previous);
    for (const key of ['baseSha', 'rubricHash', 'starterHash', 'evaluatorHash'] as const) {
      if (previous[key] !== manifest[key]) throw new Error(`Resume changed frozen ${key}`);
    }
    if (previous.mode !== 'live' || JSON.stringify(previous.config) !== JSON.stringify(config)) throw new Error('Resume changed mode or model config');
    if (previous.implementationHash !== implementationHash && authorization.resumeFromImplementationHash !== previous.implementationHash) {
      throw new Error('Infrastructure amendment must explicitly identify the preserved implementation hash');
    }
    for (const cell of plan()) {
      try { reports.push(JSON.parse(await readFile(path.join(outputRoot, 'reports', `${cell.id}.json`), 'utf8'))); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const hasTrace = await access(path.join(outputRoot, 'reports', `${cell.id}.events.jsonl`)).then(() => true, () => false);
        if (hasTrace) throw new Error(`Ambiguous prior attempt ${cell.id}; never replay a cell with an unfinished trace`);
      }
    }
    cells = pendingCells(reports, starterHash, config);
    if (!cells.length) throw new Error('All eight cells already recorded; no further calls authorized');
    await writeFile(path.join(outputRoot, `resume-${Date.now()}.json`), JSON.stringify({ previousImplementationHash: previous.implementationHash,
      implementationHash, remaining: cells.map(c => c.id), reason: authorization.amendmentReason, originalObservationsPreserved: true }, null, 2));
  } else {
    // Never silently replace an existing attempt directory.
    await mkdir(path.dirname(outputRoot), { recursive: true });
    await mkdir(outputRoot, { recursive: false });
    await writeFile(path.join(outputRoot, 'manifest.json'), JSON.stringify({ ...manifest, mode: fixture ? 'fixture' : 'live', config }, null, 2));
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
      warning: fixture ? 'Harness reference smoke tests, NOT model performance results' : 'n=1 exploratory; compare within provider only', reports,
      notRun: plan().filter(c => !reports.some(r => r.cell.id === c.id)).map(c => c.id) }, null, 2));
    if (report.status === 'interrupted' || report.events.some(e => (e as { type?: string })?.type === 'cleanup-error')) {
      console.error(`Batch stopped: ${report.status === 'interrupted' ? 'user interrupted' : 'cleanup incomplete'}. Remaining cells are unrun, not successful.`); break;
    }
  }
  } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); }
  if (reports.some(r => r.status !== 'passed')) process.exitCode = 1;
}
