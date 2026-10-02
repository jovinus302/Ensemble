import { createHash, randomUUID } from 'node:crypto';
import { project, type AnyEvent, type EventContext, type ProjectState, type ValidationBinding, type ValidationCheck, type ValidationEvidence } from '@ensemble/core';
import type { LedgerStore } from '@ensemble/store';
import type { ResultContent, SubmittedResult } from './handoff.ts';

export interface ValidationArtifact { readonly id: string; readonly path: string; readonly content: string; readonly contentBase64?: string }
export interface ValidationInput extends ValidationBinding {
  readonly artifacts: readonly ValidationArtifact[];
  readonly workerLimitations: readonly string[];
}
export interface ValidationOutput {
  status: 'passed' | 'failed' | 'environment_blocked' | 'not_run';
  checks: ValidationCheck[];
  summary: string;
}
/** Host-owned policy and code, never loaded from a worker artifact or worker tool call. */
export interface TrustedValidator {
  readonly policyFingerprint: string;
  validate(input: ValidationInput, signal: AbortSignal): Promise<ValidationOutput>;
}
export interface ValidationOptions {
  trustedValidator?: TrustedValidator;
  /** Existing source-only workflows remain available; no validator means NOT_RUN, never measured success. */
  requireValidation?: boolean;
  validationTimeoutMs?: number;
}
const canonical = (value: unknown): string => JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child)
  ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child);
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const bindingOf = ({ projectId, taskId, resultId, planVersion, specVersion, contextDigest, artifactDigest, policyFingerprint }: ValidationBinding): ValidationBinding =>
  ({ projectId, taskId, resultId, planVersion, specVersion, contextDigest, artifactDigest, policyFingerprint });
const safePath = (name: string) => !!name && !/^(?:[a-z]:|[\\/])/i.test(name)
  && !name.split('/').some(part => !part || part === '.' || part === '..' || /[<>:"\\|?*\u0000-\u001f]/.test(part));

export class ResultValidator {
  private readonly running = new Map<string, { taskId: string; controller: AbortController }>();
  private stopped = false;
  private readonly cancelledTasks = new Set<string>();
  constructor(private readonly options: ValidationOptions & {
    store: LedgerStore; context: EventContext; readResult(result: SubmittedResult): Promise<ResultContent>;
  }) {
    if (options.trustedValidator && !options.trustedValidator.policyFingerprint.trim()) throw new Error('Trusted validator requires a policy fingerprint');
    if (options.validationTimeoutMs !== undefined && (!Number.isFinite(options.validationTimeoutMs) || options.validationTimeoutMs <= 0)) throw new Error('Validation timeout must be positive');
  }
  async cancel(taskId?: string): Promise<void> {
    if (taskId === undefined) this.stopped = true;
    else this.cancelledTasks.add(taskId);
    for (const attempt of this.running.values()) if (taskId === undefined || taskId === attempt.taskId) attempt.controller.abort(new Error('Trusted validation cancelled'));
    await this.options.store.transaction(this.options.context.projectId, events => ({
      append: [...project(events).tasks.values()].filter(task => task.status === 'submitted' && task.validation
        && (taskId === undefined || task.spec.id === taskId)).map(task => ({ ...this.options.context,
          actor: { kind: 'system' as const, id: 'trusted-validator' }, type: 'validation_cancelled' as const,
          payload: { taskId: task.spec.id, attemptId: task.validation!.attemptId }, idempotencyKey: `validation:${task.validation!.attemptId}:cancel` })), result: undefined,
    }));
  }
  matchesState(evidence: ValidationEvidence, state: ProjectState, events: readonly AnyEvent[]): boolean {
    const task = state.tasks.get(evidence.taskId);
    return !this.stopped && !this.cancelledTasks.has(evidence.taskId) && task?.status === 'submitted'
      && task.results.at(-1)?.resultId === evidence.resultId && task.specVersion === evidence.specVersion
      && state.plan?.version === evidence.planVersion && task.validation?.attemptId === evidence.attemptId
      && task.validation.status !== 'expired' && task.validation.status !== 'cancelled'
      && evidence.policyFingerprint === (this.options.trustedValidator?.policyFingerprint ?? 'not-configured')
      && evidence.contextDigest === digest({ goal: state.goal, plan: state.plan, decisions: [...state.decisions],
        revision: events.filter(e => ['goal_set', 'plan_committed', 'decision_recorded'].includes(e.type)).at(-1)?.seq ?? 0 });
  }
  private input(state: ProjectState, result: SubmittedResult, content: ResultContent, events: readonly AnyEvent[]): ValidationInput {
    const paths = new Set<string>();
    const submission = events.findLast(e => e.type === 'result_submitted' && e.payload.taskId === result.taskId && e.payload.resultId === result.resultId);
    const artifacts = result.artifactIds.map(id => {
      const file = (result.artifactPaths?.[id] ?? id).replaceAll('\\', '/');
      if (!safePath(file) || paths.has(file.toLowerCase())) throw new Error(`Unsafe or duplicate submitted artifact path: ${file}`);
      if (typeof content[id] !== 'string') throw new Error(`Missing immutable submitted artifact: ${id}`);
      paths.add(file.toLowerCase());
      const attachment = events.findLast(e => e.type === 'attachment_recorded' && e.payload.attachmentId === id && e.seq <= (submission?.seq ?? 0));
      const raw = attachment?.type === 'attachment_recorded' ? /^data:[^,]*;base64,(.*)$/s.exec(attachment.payload.uri)?.[1] : undefined;
      return Object.freeze({ id, path: file, content: content[id] as string, ...(raw === undefined ? {} : { contentBase64: Buffer.from(raw, 'base64').toString('base64') }) });
    }).sort((a, b) => a.path.localeCompare(b.path) || a.id.localeCompare(b.id));
    const task = state.tasks.get(result.taskId)!;
    return Object.freeze({ projectId: this.options.context.projectId, taskId: result.taskId, resultId: result.resultId,
      planVersion: state.plan?.version ?? result.planVersion, specVersion: task.specVersion,
      contextDigest: digest({ goal: state.goal, plan: state.plan, decisions: [...state.decisions],
        revision: events.filter(e => ['goal_set', 'plan_committed', 'decision_recorded'].includes(e.type)).at(-1)?.seq ?? 0 }),
      artifactDigest: digest(artifacts), policyFingerprint: this.options.trustedValidator?.policyFingerprint ?? 'not-configured',
      artifacts: Object.freeze(artifacts), workerLimitations: Object.freeze([...(result.limitations ?? [])]) });
  }
  async isCurrent(evidence: ValidationEvidence): Promise<boolean> {
    if (this.stopped || evidence.status === 'cancelled' || evidence.status === 'expired') return false;
    const events = await this.options.store.read({ projectId: this.options.context.projectId }) as AnyEvent[];
    const state = project(events); const task = state.tasks.get(evidence.taskId);
    const result = events.findLast(e => e.type === 'result_submitted' && e.payload.resultId === evidence.resultId && e.payload.taskId === evidence.taskId);
    if (!this.matchesState(evidence, state, events)) return false;
    if (!task || task.status !== 'submitted' || task.results.at(-1)?.resultId !== evidence.resultId || state.plan?.version !== evidence.planVersion
      || task.validation?.attemptId !== evidence.attemptId || task.validation.status === 'expired' || result?.type !== 'result_submitted') return false;
    try {
      const input = this.input(state, result.payload, await this.options.readResult(result.payload), events);
      return canonical(bindingOf(input)) === canonical(bindingOf(evidence));
    } catch { return false; }
  }
  async run(state: ProjectState, result: SubmittedResult, content: ResultContent, retry = false): Promise<ValidationEvidence> {
    if (retry) this.cancelledTasks.delete(result.taskId);
    const events = await this.options.store.read({ projectId: this.options.context.projectId }) as AnyEvent[];
    const input = this.input(state, result, content, events);
    const previous = state.tasks.get(result.taskId)?.validation;
    if (!retry && previous && previous.status !== 'awaiting' && canonical(bindingOf(previous)) === canonical(bindingOf(input))) return previous;
    const binding = bindingOf(input); const attemptId = randomUUID();
    const eventContext = { ...this.options.context, actor: { kind: 'system' as const, id: 'trusted-validator' } };
    await this.options.store.append([{ ...eventContext, type: 'validation_started', payload: { ...binding, attemptId }, idempotencyKey: `validation:${attemptId}:start` }]);
    const controller = new AbortController(); this.running.set(attemptId, { taskId: result.taskId, controller });
    if (this.stopped || this.cancelledTasks.has(result.taskId)) controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let output: ValidationOutput;
    let cancelled = false;
    try {
      if (!this.options.trustedValidator) output = { status: 'not_run', checks: [], summary: 'Trusted validator is not configured; source review is not measured verification.' };
      else {
        const abort = new Promise<never>((_, reject) => {
          onAbort = () => reject(controller.signal.reason ?? new Error('Validation cancelled'));
          controller.signal.addEventListener('abort', onAbort, { once: true });
          if (controller.signal.aborted) onAbort();
        });
        timer = setTimeout(() => controller.abort(new Error('Trusted validation timeout')), this.options.validationTimeoutMs ?? 120_000);
        controller.signal.throwIfAborted();
        output = await Promise.race([this.options.trustedValidator.validate(input, controller.signal), abort]);
        if (!output || !['passed', 'failed', 'environment_blocked', 'not_run'].includes(output.status) || typeof output.summary !== 'string'
          || !Array.isArray(output.checks) || output.checks.some(check => !check || typeof check.id !== 'string' || !check.id.trim()
            || !['passed', 'failed', 'not_run'].includes(check.status) || (check.detail !== undefined && typeof check.detail !== 'string'))
          || new Set(output.checks.map(check => check.id)).size !== output.checks.length
          || (output.status === 'passed' && (!output.checks.length || output.checks.some(check => check.status !== 'passed')))
          || (output.status === 'failed' && !output.checks.some(check => check.status === 'failed'))) throw new Error('Malformed trusted validation output');
        output = { status: output.status, summary: output.summary, checks: output.checks.map(check => ({ id: check.id, status: check.status, ...(check.detail === undefined ? {} : { detail: check.detail }) })) };
      }
    } catch (error) {
      cancelled = controller.signal.aborted && !String(controller.signal.reason).includes('timeout');
      output = { status: 'environment_blocked', checks: [], summary: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer); if (onAbort) controller.signal.removeEventListener('abort', onAbort); this.running.delete(attemptId);
    }
    const evidence: ValidationEvidence = { ...binding, attemptId, ...output, ...(cancelled ? { status: 'cancelled' as const } : {}) };
    // Re-read after the asynchronous runner; stale/cross-task/changed-context results cannot unlock a judge.
    if (!cancelled && !await this.isCurrent(evidence)) evidence.status = 'expired';
    await this.options.store.append([{ ...eventContext, type: 'validation_finished', payload: evidence, idempotencyKey: `validation:${attemptId}:finish` }]);
    return evidence;
  }
}

export function validationArtifact(evidence: ValidationEvidence): { id: string; content: string } {
  return { id: `trusted-validation:${evidence.attemptId}`, content: `HOST TRUSTED VALIDATION (not worker self-report)\n${JSON.stringify(evidence, null, 2)}` };
}
