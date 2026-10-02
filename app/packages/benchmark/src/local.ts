import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile, copyFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Context, Inspection, Services } from './harness.ts';
import { type Cell, type Mode } from './protocol.ts';
import { createLocalSnapshotRunner, createSnapshotValidator } from './validator.ts';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const APP_ROOT = path.resolve(PACKAGE_ROOT, '../..');
/** Register immediately after spawn so cleanup cannot miss an earlier close event. */
export function trackOwnedChild(child: ChildProcess): { child: ChildProcess; closed: Promise<void> } {
  return { child, closed: new Promise<void>(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('close', () => resolve());
  }) };
}
export async function stopOwnedChildren(owned: Iterable<ReturnType<typeof trackOwnedChild>>): Promise<void> {
  const snapshot = [...owned];
  for (const { child } of snapshot) if (child.exitCode === null && child.signalCode === null) child.kill();
  await Promise.all(snapshot.map(entry => entry.closed));
}
export async function treeHash(root: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(dir: string, relative = '') {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
      if (entry.isSymbolicLink()) throw new Error('Starter/artifact cannot contain links');
      const name = `${relative}${entry.name}`;
      if (entry.isDirectory()) await visit(path.join(dir, entry.name), `${name}/`);
      else { hash.update(name); hash.update(await readFile(path.join(dir, entry.name))); }
    }
  }
  await visit(root); return hash.digest('hex');
}
async function copySource(source: string, target: string) {
  await cp(source, target, { recursive: true, errorOnExist: false,
    filter: file => !['node_modules', 'dist', '.git'].includes(path.basename(file)) });
}
export function localServices(cell: Cell, options: {
  mode: Mode; outputRoot: string; model: string; effort: string;
}): Services {
  const runRoot = path.resolve(options.outputRoot, 'work', cell.id);
  let workspace = runRoot;
  let server: ChildProcess | undefined;
  let url: string | undefined;
  let measured: { snapshot: string; checkpoint: boolean; inspection: Inspection } | undefined;
  const revisions = new Map<string, NonNullable<typeof measured>>();
  const children = new Map<ChildProcess, ReturnType<typeof trackOwnedChild>>();
  const env = { ...process.env, BENCH_APP_ROOT: APP_ROOT, BENCH_TASK: cell.task, PORT: '0' };
  async function command(file: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [file], { cwd: workspace, env, windowsHide: true, signal, stdio: ['ignore', 'pipe', 'pipe'] });
      children.set(child, trackOwnedChild(child)); let output = '';
      child.stdout?.on('data', chunk => { output = (output + chunk).slice(-8000); });
      child.stderr?.on('data', chunk => { output = (output + chunk).slice(-8000); });
      child.on('error', reject); child.on('close', code => { children.delete(child); code === 0 ? resolve() : reject(new Error(`build exited ${code}: ${output}`)); });
    });
  }
  async function serve(signal: AbortSignal): Promise<string> {
    if (url) return url;
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      server = spawn(process.execPath, ['server.mjs'], { cwd: workspace, env, windowsHide: true, signal, stdio: ['ignore', 'pipe', 'pipe'] });
      children.set(server, trackOwnedChild(server)); let output = '';
      server.on('error', reject); server.on('exit', code => reject(new Error(`fixture server exited ${code}`)));
      server.stdout!.on('data', chunk => {
        output += String(chunk); const match = /http:\/\/127\.0\.0\.1:\d+/.exec(output);
        if (match) { url = match[0]; resolve(url); }
      });
    });
  }
  async function assertInfrastructure() {
    for (const file of ['build.mjs', 'server.mjs', 'package.json']) {
      if (!(await readFile(path.join(PACKAGE_ROOT, 'starter', file))).equals(await readFile(path.join(workspace, file)))) {
        throw new Error(`Benchmark infrastructure modified: ${file}`);
      }
    }
  }
  return {
    async prepare() { await mkdir(runRoot, { recursive: true }); await copySource(path.join(PACKAGE_ROOT, 'starter'), runRoot); },
    async driver(context: Context) {
      if (options.mode === 'fixture') {
        const install = () => copyFile(path.join(PACKAGE_ROOT, 'fixtures/reference.jsx'), path.join(workspace, 'src/App.jsx'));
        return {
          async start() { await install(); context.record({ type: 'fixture-install', warning: 'Reference implementation; no provider or orchestration evidence' }); },
          async change() { await install(); }, async settled() { return true; }, async stop() {},
        };
      }
      // The CLI validates approval before it reaches this lazy import. No provider in fixture mode.
      const { createNativeDriver } = await import('./native.ts');
      let checkpoint = cell.task === 'B';
      const policyFingerprint = createHash('sha256').update('trusted-submission-v1').update(cell.task)
        .update(await readFile(path.join(PACKAGE_ROOT, 'src/validator.ts')))
        .update(await readFile(path.join(PACKAGE_ROOT, 'scripts/build-snapshot.mjs')))
        .update(await readFile(path.join(PACKAGE_ROOT, 'browser/acceptance.mjs')))
        .update(await readFile(path.join(PACKAGE_ROOT, 'starter/build.mjs')))
        .update(await readFile(path.join(PACKAGE_ROOT, 'starter/server.mjs')))
        .update(await readFile(path.join(PACKAGE_ROOT, 'starter/package.json')))
        .update(await readFile(path.join(PACKAGE_ROOT, 'starter/index.html'))).digest('hex');
      const trustedValidator = createSnapshotValidator({ starterRoot: path.join(PACKAGE_ROOT, 'starter'),
        outputRoot: path.join(options.outputRoot, 'validation', cell.id), policyFingerprint,
        checkpoint: () => checkpoint, record: context.record,
        onMeasured: (snapshot, checkpoint, inspection, input) => {
          revisions.set(`${input.resultId}:${input.artifactDigest}:${input.contextDigest}:${input.policyFingerprint}`, { snapshot, checkpoint, inspection });
        },
        runner: () => createLocalSnapshotRunner({ appRoot: APP_ROOT, packageRoot: PACKAGE_ROOT, task: cell.task }) });
      const driver = await createNativeDriver({ ...context, provider: cell.provider, ensemble: cell.ensemble, model: options.model, effort: options.effort,
        trustedValidator,
        onValidatedHandoff(evidence) {
          measured = revisions.get(`${evidence.resultId}:${evidence.artifactDigest}:${evidence.contextDigest}:${evidence.policyFingerprint}`);
          if (!measured) throw new Error('validation_not_run: approved revision does not match host snapshot');
          context.record({ type: 'trusted-validation-accepted', ...evidence, snapshot: measured.snapshot });
        },
        workspaceRoot: path.join(runRoot, 'sessions'), projectId: cell.id,
        async onWorkspace(folder) {
          const relative = path.relative(await realpath(runRoot), await realpath(folder));
          if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Worker workspace escaped run root');
          if (workspace !== runRoot && workspace !== folder) throw new Error('Benchmark supports one worker workspace only');
          workspace = folder; await copySource(path.join(PACKAGE_ROOT, 'starter'), folder);
          // Environment is inherited by native connectors without changing user/global settings.
          await writeFile(path.join(folder, 'BENCHMARK.txt'), `Build environment: BENCH_APP_ROOT=${APP_ROOT}\nRun node build.mjs. No dependencies need installing.\n`);
        },
      });
      return { ...driver, async change(prompt) { checkpoint = false; measured = undefined; await driver.change(prompt); } };
    },
    async build(signal) {
      signal.throwIfAborted();
      if (options.mode === 'live' && cell.ensemble) {
        if (!measured) throw new Error('validation_not_run: no measured submitted revision');
        return; // The same immutable revision was built before the judge. Do not remeasure mutable worker files.
      }
      await assertInfrastructure(); await command('build.mjs', signal);
    },
    async inspect(checkpoint, signal) {
      signal.throwIfAborted();
      if (options.mode === 'live' && cell.ensemble) {
        if (!measured || measured.checkpoint !== checkpoint) throw new Error('validation_not_run: no evidence for this task phase');
        return structuredClone(measured.inspection);
      }
      await assertInfrastructure();
      const browser = await import(pathToFileURL(path.join(PACKAGE_ROOT, 'browser/acceptance.mjs')).href) as {
        inspect(url: string, options: { task: string; checkpoint: boolean; outputDir: string; signal: AbortSignal }): Promise<Inspection>;
      };
      return browser.inspect(await serve(signal), { task: cell.task, checkpoint, signal, outputDir: path.join(options.outputRoot, 'evidence', cell.id, checkpoint ? 'checkpoint' : 'final') });
    },
    async freezeArtifact(blindId) {
      const target = path.join(options.outputRoot, 'blind', blindId);
      const source = options.mode === 'live' && cell.ensemble && measured ? measured.snapshot : workspace;
      const artifactHash = await treeHash(source); // Reject links before copying review artifacts.
      await cp(source, target, { recursive: true, filter: file =>
        !['node_modules', 'dist', '.git', '.codex', '.claude', 'BENCHMARK.txt'].includes(path.basename(file)) });
      // Avoid condition/model/provider names in the reviewer package.
      await writeFile(path.join(target, 'REVIEW.json'), JSON.stringify({ blindId, task: cell.task, artifactHash }, null, 2));
    },
    async cleanup() {
      await stopOwnedChildren(children.values());
      children.clear(); server = undefined; url = undefined;
    },
  };
}
