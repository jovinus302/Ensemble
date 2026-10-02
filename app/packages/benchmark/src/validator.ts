import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TrustedValidator, ValidationInput, ValidationOutput } from '@ensemble/orchestrator';
import type { Inspection } from './harness.ts';

export interface SnapshotRunner {
  build(snapshot: string, signal: AbortSignal): Promise<void>;
  inspect(snapshot: string, checkpoint: boolean, signal: AbortSignal): Promise<Inspection>;
  stop(): Promise<void>;
}
export class SnapshotBuildFailure extends Error {}
const infrastructure = ['build.mjs', 'server.mjs', 'package.json'] as const;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Only captured submission bytes enter this directory. No worker paths, commands,
 * dependencies or build scripts are executed by this host-owned capability. */
export function createSnapshotValidator(options: {
  starterRoot: string; outputRoot: string; policyFingerprint: string;
  checkpoint: () => boolean; runner: () => SnapshotRunner;
  record: (event: unknown) => void;
  onMeasured?: (snapshot: string, checkpoint: boolean, inspection: Inspection, input: ValidationInput) => void;
}): TrustedValidator {
  const pending = new Map<string, Promise<ValidationOutput>>();
  const completed = new Map<string, ValidationOutput>();
  let sequence = 0;
  return { policyFingerprint: options.policyFingerprint, async validate(input, signal) {
    signal.throwIfAborted();
    const checkpoint = options.checkpoint();
    // Cross-task, cross-result and policy identities must never share evidence.
    const key = digest(JSON.stringify({ input, checkpoint }));
    const previous = completed.get(key);
    if (previous) return structuredClone(previous);
    if (pending.has(key)) return structuredClone(await pending.get(key)!);
    const operation = (async (): Promise<ValidationOutput> => {
      const fail = (status: ValidationOutput['status'], summary: string): ValidationOutput => ({ status, summary,
        checks: [{ id: 'submission-snapshot', status: status === 'failed' ? 'failed' : 'not_run', detail: summary }] });
      const files = new Map<string, string>();
      const names = new Set<string>();
      for (const artifact of input.artifacts) {
        const name = artifact.path;
        if (artifact.contentBase64 !== undefined) {
          const bytes = Buffer.from(artifact.contentBase64, 'base64');
          if (!bytes.equals(Buffer.from(artifact.content, 'utf8'))) return fail('failed', `Submitted text is not valid UTF-8 or differs from captured bytes: ${name}`);
        }
        if (!name || name.includes('\\') || name.includes(':') || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
          || !/^(?:src\/[\w./-]+\.(?:jsx?|tsx?|css|json|svg)|index\.html|build\.mjs|server\.mjs|package\.json)$/.test(name)) {
          return fail('failed', `Unsafe or unsupported submitted artifact path: ${name}`);
        }
        if (names.has(name.toLowerCase())) return fail('failed', `Duplicate submitted artifact path: ${name}`);
        names.add(name.toLowerCase());
        if ((infrastructure as readonly string[]).includes(name)) {
          if (artifact.content !== await readFile(path.join(options.starterRoot, name), 'utf8')) return fail('failed', `Trusted infrastructure changed: ${name}`);
          continue;
        }
        files.set(name, artifact.content);
      }
      if (!files.has('src/App.jsx')) return fail('not_run', 'Submission must include captured src/App.jsx bytes; unreported worker files are not validation evidence.');
      const snapshot = path.join(options.outputRoot, `${++sequence}-${key}`);
      const runner = options.runner();
      let result: ValidationOutput;
      try {
        signal.throwIfAborted();
        await mkdir(snapshot, { recursive: true });
        // Fixed infrastructure comes only from the trusted repository, never the submission.
        for (const name of [...infrastructure, 'index.html']) await writeFile(path.join(snapshot, name), await readFile(path.join(options.starterRoot, name)));
        for (const [name, content] of files) { signal.throwIfAborted(); await mkdir(path.dirname(path.join(snapshot, name)), { recursive: true }); await writeFile(path.join(snapshot, name), content); }
        const snapshotDigest = digest(JSON.stringify([...files.entries()].sort(([a], [b]) => a.localeCompare(b))));
        options.record({ type: 'trusted-validation-start', projectId: input.projectId, taskId: input.taskId, resultId: input.resultId,
          artifactDigest: input.artifactDigest, contextDigest: input.contextDigest, policyFingerprint: input.policyFingerprint,
          snapshotDigest, checkpoint, snapshot });
        await runner.build(snapshot, signal);
        signal.throwIfAborted();
        const inspection = await runner.inspect(snapshot, checkpoint, signal);
        signal.throwIfAborted();
        options.onMeasured?.(snapshot, checkpoint, inspection, input);
        result = { status: inspection.passed ? 'passed' : 'failed', summary: `Host measured immutable submitted revision ${snapshotDigest}: build passed; browser ${inspection.passed ? 'passed' : 'failed'}.`,
          checks: [{ id: 'build', status: 'passed' }, ...inspection.checks.map(check => ({ id: check.id, status: check.pass ? 'passed' as const : 'failed' as const, ...(check.detail ? { detail: check.detail } : {}) }))] };
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        result = { status: error instanceof SnapshotBuildFailure ? 'failed' : 'environment_blocked',
          summary: String(error), checks: [{ id: error instanceof SnapshotBuildFailure ? 'build' : 'validator-environment', status: error instanceof SnapshotBuildFailure ? 'failed' : 'not_run', detail: String(error) }] };
      } finally {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([runner.stop(), new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Validator owned-process cleanup timeout')), 3000);
          })]);
        } finally { clearTimeout(timeout); }
      }
      options.record({ type: 'trusted-validation-complete', projectId: input.projectId, taskId: input.taskId, resultId: input.resultId, artifactDigest: input.artifactDigest, ...result });
      // Environment failures are retryable; a measured result for immutable bytes is reusable.
      if (result.status === 'passed' || result.status === 'failed') completed.set(key, structuredClone(result));
      return result;
    })();
    pending.set(key, operation);
    try { return structuredClone(await operation); } finally { pending.delete(key); }
  } };
}

/** Executes only the repository's fixed build and local fixture server. Child
 * closure is tracked at spawn, before an abort can race cleanup. */
export function createLocalSnapshotRunner(options: { appRoot: string; packageRoot: string; task: 'A' | 'B' }): SnapshotRunner {
  const owned = new Map<ChildProcess, Promise<void>>();
  const env = { ...process.env, BENCH_APP_ROOT: options.appRoot, BENCH_TASK: options.task, PORT: '0' };
  function launch(script: string, snapshot: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const trustedScript = script === 'build.mjs' ? path.join(options.packageRoot, 'scripts/build-snapshot.mjs') : path.join(options.packageRoot, 'starter', script);
    const child = spawn(process.execPath, [trustedScript], { cwd: snapshot, env, windowsHide: true, signal, stdio: ['ignore', 'pipe', 'pipe'] });
    owned.set(child, new Promise(resolve => child.once('close', () => resolve())));
    return child;
  }
  return {
    async build(snapshot, signal) {
      await new Promise<void>((resolve, reject) => {
        const child = launch('build.mjs', snapshot, signal); let output = '';
        child.stdout.on('data', chunk => { output = (output + chunk).slice(-8000); });
        child.stderr.on('data', chunk => { output = (output + chunk).slice(-8000); });
        child.once('error', reject);
        child.once('close', code => {
          if (code === 0) { resolve(); return; }
          const message = `Fixed build exited ${code}: ${output}`;
          // Missing host dependencies or a denied spawn are not defects in submitted JSX.
          reject(/Cannot find module ['"]esbuild['"]|spawn EPERM|spawn EACCES|BENCH_APP_ROOT must point/.test(output)
            ? new Error(message) : new SnapshotBuildFailure(message));
        });
      });
    },
    async inspect(snapshot, checkpoint, signal) {
      const url = await new Promise<string>((resolve, reject) => {
        const child = launch('server.mjs', snapshot, signal); let output = '';
        child.once('error', reject); child.once('close', code => reject(new Error(`Fixture server exited ${code}`)));
        child.stdout.on('data', chunk => { output += String(chunk); const match = /http:\/\/127\.0\.0\.1:\d+/.exec(output); if (match) resolve(match[0]); });
      });
      const browser = await import(pathToFileURL(path.join(options.packageRoot, 'browser/acceptance.mjs')).href) as {
        inspect(url: string, options: { task: string; checkpoint: boolean; outputDir: string; signal: AbortSignal }): Promise<Inspection>;
      };
      return browser.inspect(url, { task: options.task, checkpoint, signal, outputDir: path.join(snapshot, 'browser-evidence') });
    },
    async stop() {
      for (const child of owned.keys()) if (child.exitCode === null && child.signalCode === null) child.kill();
      await Promise.all(owned.values()); owned.clear();
    },
  };
}
