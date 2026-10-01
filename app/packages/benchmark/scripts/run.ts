import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { approval, BASE_SHA, LIMITS, plan, RUBRIC, RUBRIC_HASH } from '../src/protocol.ts';
import { APP_ROOT, localServices, PACKAGE_ROOT, treeHash } from '../src/local.ts';
import { runCell, type Report } from '../src/harness.ts';

const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const live = args.includes('--live');
const fixture = args.includes('--fixture');
if (live && fixture) throw new Error('Choose exactly one mode');
const starterHash = await treeHash(path.join(PACKAGE_ROOT, 'starter'));
const evaluatorHash = await treeHash(path.join(PACKAGE_ROOT, 'browser'));
const implementationHash = createHash('sha256').update(await treeHash(path.join(PACKAGE_ROOT, 'src')))
  .update(await treeHash(path.join(PACKAGE_ROOT, 'scripts'))).digest('hex');
const manifest = { baseSha: BASE_SHA, rubricHash: RUBRIC_HASH, starterHash, evaluatorHash, implementationHash, rubric: RUBRIC, limits: LIMITS, cells: plan() };
if (!live && !fixture) {
  console.log(JSON.stringify({ mode: 'plan-only', ...manifest }, null, 2));
} else {
  let config: Record<string, { model: string; effort: string }> = {};
  if (live) {
    const file = value('--approval-file');
    if (!file) throw new Error('Live approval missing; no provider imported or called');
    approval(JSON.parse(await readFile(path.resolve(file), 'utf8')), { starterHash, evaluatorHash, implementationHash });
    const git = promisify(execFile);
    const actualBase = (await git('git', ['merge-base', 'HEAD', BASE_SHA], { cwd: APP_ROOT, windowsHide: true })).stdout.trim();
    if (actualBase !== BASE_SHA) throw new Error('Checkout is not based on pinned main');
    const changed = (await git('git', ['diff', '--name-only', BASE_SHA, '--', 'packages/agents', 'packages/core', 'packages/llm', 'packages/orchestrator', 'packages/store'], { cwd: APP_ROOT, windowsHide: true })).stdout.trim();
    if (changed) throw new Error(`Production benchmark dependencies differ from pinned main: ${changed}`);
    const configFile = value('--config');
    if (!configFile) throw new Error('Explicit pinned provider models/efforts config required');
    config = JSON.parse(await readFile(path.resolve(configFile), 'utf8'));
    for (const provider of ['codex', 'claude']) {
      const c = config[provider];
      if (!c?.model?.trim() || !c.effort?.trim() || /^(default|latest|fixture|TODO)$/i.test(c.model)) throw new Error(`Pin ${provider} model and effort`);
    }
  }
  const outputRoot = path.resolve(value('--output') ?? path.join(PACKAGE_ROOT, '.local', `${fixture ? 'fixture' : 'live'}-${Date.now()}`));
  // Never reuse an output directory: accidental reruns cannot replace failed evidence.
  await mkdir(path.dirname(outputRoot), { recursive: true });
  await mkdir(outputRoot, { recursive: false });
  await writeFile(path.join(outputRoot, 'manifest.json'), JSON.stringify({ ...manifest, mode: fixture ? 'fixture' : 'live', config }, null, 2));
  process.env.BENCH_APP_ROOT = APP_ROOT;
  const reports: Report[] = [];
  for (const cell of plan()) {
    process.env.BENCH_TASK = cell.task;
    const selected = config[cell.provider] ?? { model: 'fixture-reference', effort: 'none' };
    const report = await runCell(cell, localServices(cell, { mode: fixture ? 'fixture' : 'live', outputRoot, ...selected }), {
      mode: fixture ? 'fixture' : 'live', ...selected, starterHash, cacheState: 'unknown', outputDir: path.join(outputRoot, 'reports'),
    });
    reports.push(report); console.log(`${cell.id} ${report.mode} ${report.status} ${report.totalMs}ms`);
    await writeFile(path.join(outputRoot, 'summary.json'), JSON.stringify({ mode: fixture ? 'fixture' : 'live', exploratoryOnly: true,
      warning: fixture ? 'Harness reference smoke tests, NOT model performance results' : 'n=1 exploratory; compare within provider only', reports,
      notRun: plan().filter(c => !reports.some(r => r.cell.id === c.id)).map(c => c.id) }, null, 2));
    if (report.events.some(e => (e as { type?: string })?.type === 'cleanup-error')) {
      console.error('Batch stopped: cleanup incomplete. Remaining cells are unrun, not successful.'); break;
    }
  }
  if (reports.some(r => r.status !== 'passed')) process.exitCode = 1;
}
