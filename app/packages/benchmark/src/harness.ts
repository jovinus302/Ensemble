import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BASE_SHA, Budget, LIMITS, PROMPT_A, PROMPT_B_INITIAL, PROMPT_CHANGE, RUBRIC_HASH, type Cell, type Mode, type Role } from './protocol.ts';

export interface Check { id: string; pass: boolean; detail?: string }
export interface Inspection { passed: boolean; checks: Check[] }
export interface Driver { start(): Promise<void>; change(prompt: string): Promise<void>; settled(): Promise<boolean>; stop(): Promise<void> }
export interface Context { signal: AbortSignal; meter: <T>(role: Role, operation: () => Promise<T>) => Promise<T>; record: (event: unknown) => void; prompt: string }
export interface Services {
  prepare(): Promise<void>;
  driver(context: Context): Promise<Driver>;
  build(signal: AbortSignal): Promise<void>;
  inspect(checkpoint: boolean, signal: AbortSignal): Promise<Inspection>;
  freezeArtifact(blindId: string): Promise<void>;
  cleanup(): Promise<void>;
}
export interface Report {
  schemaVersion: 1; mode: Mode; cell: Cell; blindId: string; baseSha: string; rubricHash: string;
  model: string; effort: string; cacheState: 'cold' | 'warm' | 'unknown'; starterHash: string;
  status: 'passed' | 'failed' | 'timeout' | 'call_limit' | 'checkpoint_failed'; error: string | null;
  preparationMs: number; taskMs: number; totalMs: number; checkpointMs: number | null; changeMs: number | null; afterChangeMs: number | null;
  humanInterventions: unknown[]; humanRequests: unknown[]; checks: Check[]; calls: Budget['calls']; events: unknown[];
  usage: null; costUsd: null; underlyingApiCalls: null; actualModelInvocations: number | null;
}

export async function runCell(cell: Cell, services: Services, options: {
  mode: Mode; model: string; effort: string; starterHash: string; cacheState?: Report['cacheState'];
  limits?: typeof LIMITS; pollMs?: number; outputDir?: string;
}): Promise<Report> {
  const controller = new AbortController();
  const limits = options.limits ?? LIMITS;
  const budget = new Budget(controller.signal, () => performance.now(), limits);
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const report: Report = {
    schemaVersion: 1, mode: options.mode, cell, blindId: randomUUID(), baseSha: BASE_SHA, rubricHash: RUBRIC_HASH,
    model: options.model, effort: options.effort, cacheState: options.cacheState ?? 'unknown', starterHash: options.starterHash,
    status: 'failed', error: null, preparationMs: 0, taskMs: 0, totalMs: 0, checkpointMs: null, changeMs: null, afterChangeMs: null,
    humanInterventions: [], humanRequests: [], checks: [], calls: budget.calls, events: [], usage: null, costUsd: null, underlyingApiCalls: null, actualModelInvocations: 0,
  };
  let driver: Driver | undefined;
  let taskStarted: number | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    // Reserve teardown within the same total budget, including for tiny test deadlines.
    const reserve = Math.min(5000, limits.totalMs / 10);
    watchdog = setTimeout(() => { controller.abort(new Error('timeout')); reject(new Error('timeout')); }, limits.totalMs - reserve);
  });
  const save = async () => {
    if (!options.outputDir) return;
    await mkdir(options.outputDir, { recursive: true });
    await writeFile(path.join(options.outputDir, `${cell.id}.json`), JSON.stringify(report, null, 2));
  };
  const work = async () => {
    await services.prepare(); budget.check();
    report.preparationMs = elapsed(); taskStarted = elapsed();
    driver = await services.driver({ signal: controller.signal, meter: budget.meter.bind(budget),
      record: event => {
        report.events.push(event);
        const record = event as { type?: string; events?: { type?: string; payload?: unknown }[] } | null;
        if (record?.type === 'native_ledger') report.humanRequests = (record.events ?? [])
          .filter(e => e.type === 'decision_requested' || e.type === 'authority_requested').map(e => e.payload);
      }, prompt: cell.task === 'A' ? PROMPT_A : PROMPT_B_INITIAL });
    budget.check();
    await driver.start();
    const waitSettled = async () => {
      while (!await driver!.settled()) {
        budget.check();
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => { clearTimeout(timer); reject(controller.signal.reason); };
          const timer = setTimeout(() => { controller.signal.removeEventListener('abort', onAbort); resolve(); }, options.pollMs ?? 250);
          controller.signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      budget.check();
    };
    await waitSettled();
    if (cell.task === 'B') {
      try {
        await services.build(controller.signal);
        budget.check();
        const checkpoint = await services.inspect(true, controller.signal);
        budget.check();
        report.events.push({ type: 'checkpoint', ...checkpoint });
        if (!checkpoint.passed) throw new Error('actual selection failed');
      } catch (error) {
        if (controller.signal.aborted) throw error;
        report.status = 'checkpoint_failed'; throw error;
      }
      report.checkpointMs = elapsed(); report.changeMs = elapsed();
      await driver.change(PROMPT_CHANGE);
      await waitSettled();
    }
    await services.build(controller.signal);
    budget.check();
    const result = await services.inspect(false, controller.signal);
    budget.check();
    report.checks = result.checks;
    report.status = result.passed ? 'passed' : 'failed';
  };
  try { await Promise.race([work(), expired]); }
  catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    if (report.error.includes('timeout')) report.status = 'timeout';
    else if (report.error.includes('call_limit')) report.status = 'call_limit';
    else if (report.status !== 'checkpoint_failed') report.status = 'failed';
  } finally {
    clearTimeout(watchdog); controller.abort(new Error('run finished'));
    // Teardown is bounded independently and retained as evidence, never disguised as task time.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([(async () => { await driver?.stop(); await services.cleanup(); })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('cleanup timeout')), Math.max(1, Math.min(5000, limits.totalMs - elapsed()))); })]);
    } catch (error) { report.events.push({ type: 'cleanup-error', message: String(error) }); if (report.status === 'passed') report.status = 'failed'; }
    finally { clearTimeout(timer); }
    report.totalMs = elapsed(); report.taskMs = taskStarted === undefined ? 0 : report.totalMs - taskStarted;
    if (taskStarted === undefined) report.preparationMs = report.totalMs;
    if (report.changeMs !== null) report.afterChangeMs = report.totalMs - report.changeMs;
    report.actualModelInvocations = options.mode === 'fixture' ? 0 : null;
    // Evidence collection happens after cancellation, outside measured execution time; retain failures too.
    try {
      if (report.events.some(e => (e as { type?: string })?.type === 'cleanup-error')) {
        report.events.push({ type: 'artifact-unstable', message: 'Cleanup incomplete; do not snapshot changing workspace or start another cell' });
      } else await services.freezeArtifact(report.blindId);
    }
    catch (error) { report.events.push({ type: 'artifact-error', message: String(error) }); }
    await save();
  }
  return report;
}
