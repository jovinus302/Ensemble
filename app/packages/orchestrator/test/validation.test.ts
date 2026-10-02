import { expect, it, vi } from 'vitest';
import { project, type NewLedgerEvent } from '@ensemble/core';
import { MemoryLedgerStore } from '@ensemble/store';
import type { LlmRequest } from '@ensemble/llm';
import { Dispatcher } from '../src/dispatch.ts';
import { REVIEW_TOOL } from '../src/handoff.ts';
import type { TrustedValidator, ValidationInput, ValidationOutput } from '../src/validation.ts';

const ctx = { projectId: 'validation-test', targetProductId: 'product' };
const event = (type: NewLedgerEvent['type'], payload: unknown): NewLedgerEvent => ({ ...ctx, type, payload, actor: { kind: 'human', id: 'lead' } });
const submission = (resultId = 'r1') => event('result_submitted', { taskId: 'T1', resultId, planVersion: 1, artifactIds: ['a'], artifactPaths: { a: 'src/App.tsx' }, summary: 'Working reservation', limitations: ['Browser not run by worker'] });
const passed = (): ValidationOutput => ({ status: 'passed', checks: [{ id: 'reservation', status: 'passed', detail: 'Reservation selection works' }], summary: 'Measured reservation selection' });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(validate?: TrustedValidator['validate'], required = true, judgeHook?: () => Promise<void>) {
  const store = new MemoryLedgerStore();
  await store.append([
    event('member_joined', { memberId: 'lead', kind: 'human', displayName: 'Lead' }),
    event('goal_set', { text: 'Working reservation', deadline: '2026-10-12', decider: 'lead', delegation: { pmMayApply: [] } }),
    event('plan_committed', { version: 1, basedOn: null, reason: 'start', approvedBy: 'lead', sourceMessageIds: [], tasks: [{ id: 'T1', title: 'Reservation', assignee: 'lead', dependsOn: [], handoffConditions: ['Reservation selection works'] }] }), submission(),
  ]);
  const calls: LlmRequest[] = [];
  const llm = { complete: async (request: LlmRequest) => {
    calls.push(request); await judgeHook?.();
    return { text: '', model: request.model, toolCalls: [{ name: REVIEW_TOOL, input: { conditions: [{ index: 1, met: true, file: 'a', quote: 'Reservation selection works' }], decisionConflicts: [] } }], responseId: 'fake', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  const readResult = vi.fn(async () => ({ a: 'Reservation selection works' }));
  const dispatcher = new Dispatcher({ store, context: ctx, model: 'offline', llm, readResult, requireValidation: required,
    ...(validate ? { trustedValidator: { policyFingerprint: 'fixed-policy-v1', validate } } : {}), validationTimeoutMs: 1000,
    connector: { startTask: async () => 'turn', sendUpdate: async () => ({ sent: true }) } });
  return { store, dispatcher, calls, readResult, state: async () => project(await store.read()) };
}

it('orders submission, trusted snapshot validation, final judge and checked; carries worker limitations', async () => {
  let captured!: ValidationInput;
  const validate = vi.fn(async (input: ValidationInput) => { captured = input; return passed(); });
  const f = await fixture(validate);
  const [first, duplicate] = await Promise.all([f.dispatcher.onResultSubmitted('T1', 'r1'), f.dispatcher.onResultSubmitted('T1', 'r1')]);
  expect(first.kind).toBe('checked'); expect(duplicate.kind).toBe('skipped'); expect(validate).toHaveBeenCalledTimes(1);
  expect(captured.artifacts).toEqual([{ id: 'a', path: 'src/App.tsx', content: 'Reservation selection works' }]);
  expect(Object.isFrozen(captured.artifacts[0])).toBe(true);
  expect(captured.workerLimitations).toEqual(['Browser not run by worker']);
  expect(f.calls[0]!.messages[0]!.content).toContain('self-reported');
  expect(f.calls[0]!.messages[0]!.content).toContain('HOST TRUSTED VALIDATION');
  const types = (await f.store.read()).map(e => e.type);
  expect(types.indexOf('result_submitted')).toBeLessThan(types.indexOf('validation_started'));
  expect(types.indexOf('validation_finished')).toBeLessThan(types.indexOf('handoff_reviewed'));
  expect((await f.state()).tasks.get('T1')).toMatchObject({ status: 'checked', validation: { status: 'passed' } });
});

it('missing required validator pauses with NOT_RUN and never calls judge or consumes a worker revision', async () => {
  const f = await fixture();
  expect(await f.dispatcher.onResultSubmitted('T1', 'r1')).toMatchObject({ kind: 'validation_pending', evidence: { status: 'not_run' } });
  expect(f.calls).toHaveLength(0);
  expect((await f.state()).tasks.get('T1')?.status).toBe('submitted');
  await expect(f.dispatcher.acceptResult('T1', 'lead', 'accept', 'manual')).rejects.toThrow('trusted validation');
});

it('source-only default exposes NOT_RUN while retaining source review', async () => {
  const f = await fixture(undefined, false);
  expect((await f.dispatcher.onResultSubmitted('T1', 'r1')).kind).toBe('checked');
  expect((await f.state()).tasks.get('T1')?.validation?.status).toBe('not_run');
  expect(f.calls[0]!.messages[0]!.content).toContain('not measured verification');
});

it.each(['environment_blocked', 'not_run'] as const)('unavailable status %s is cached; explicit retry creates a new bound attempt', async status => {
  const validate = vi.fn<TrustedValidator['validate']>().mockResolvedValueOnce({ status, checks: [], summary: 'Unavailable environment' }).mockResolvedValue(passed());
  const f = await fixture(validate);
  const first = await f.dispatcher.onResultSubmitted('T1', 'r1');
  expect(first.kind).toBe('validation_pending');
  expect((await f.dispatcher.onResultSubmitted('T1', 'r1')).kind).toBe('validation_pending');
  expect(validate).toHaveBeenCalledTimes(1);
  expect((await f.dispatcher.onResultSubmitted('T1', 'r1', true)).kind).toBe('checked');
  expect(validate).toHaveBeenCalledTimes(2);
  const starts = (await f.store.read()).filter(e => e.type === 'validation_started');
  expect(starts).toHaveLength(2);
});

it('measured implementation failure requests revision without allowing judge to override it', async () => {
  const f = await fixture(async () => ({ status: 'failed', checks: [{ id: 'reservation', status: 'failed', detail: 'Selection has no effect' }], summary: 'Implementation failed' }));
  expect(await f.dispatcher.onResultSubmitted('T1', 'r1')).toMatchObject({ kind: 'revision', review: { missing: ['reservation: Selection has no effect'] } });
  expect(f.calls).toHaveLength(0);
});

it.each([
  { status: 'passed', checks: [], summary: 'Invented pass' },
  { status: 'passed', checks: [{ id: 'x', status: 'failed' }], summary: 'Contradiction' },
  { status: 'failed', checks: [], summary: 'No measured failure' },
])('malformed host result is environment-blocked: $summary', async output => {
  const f = await fixture(async () => output as ValidationOutput);
  expect(await f.dispatcher.onResultSubmitted('T1', 'r1')).toMatchObject({ kind: 'validation_pending', evidence: { status: 'environment_blocked' } });
  expect(f.calls).toHaveLength(0);
});

it.each(['new_result', 'goal', 'plan'] as const)('expires asynchronous validation on %s changes', async change => {
  const started = deferred<void>(); const completion = deferred<ValidationOutput>();
  const f = await fixture(async () => { started.resolve(); return completion.promise; });
  const pending = f.dispatcher.onResultSubmitted('T1', 'r1'); await started.promise;
  if (change === 'new_result') await f.store.append([submission('r2')]);
  else if (change === 'goal') await f.store.append([event('goal_set', { text: 'Changed requirement', deadline: '2026-10-12', decider: 'lead', delegation: { pmMayApply: [] } })]);
  else {
    const plan = (await f.state()).plan!;
    await f.store.append([event('plan_committed', { ...plan, version: 2, basedOn: 1, reason: 'Changed requirements', approvedBy: 'lead', sourceMessageIds: [] })]);
  }
  completion.resolve(passed());
  expect(await pending).toMatchObject({ kind: 'validation_pending', evidence: { status: 'expired' } });
  expect(f.calls).toHaveLength(0);
  expect((await f.store.read()).some(e => e.type === 'task_checked')).toBe(false);
});

it('rechecks requirement binding after the asynchronous final judge', async () => {
  const judging = deferred<void>(); const finish = deferred<void>();
  const f = await fixture(async () => passed(), true, async () => { judging.resolve(); await finish.promise; });
  const pending = f.dispatcher.onResultSubmitted('T1', 'r1'); await judging.promise;
  await f.store.append([event('goal_set', { text: 'New goal without new plan', deadline: '', decider: 'lead', delegation: { pmMayApply: [] } })]);
  finish.resolve();
  expect((await pending).kind).toBe('skipped');
  expect((await f.store.read()).some(e => e.type === 'task_checked')).toBe(false);
});

it('cancels immediately and ignores a late validator result; explicit retry is separately bound', async () => {
  const started = deferred<void>(); const late = deferred<ValidationOutput>();
  const validate = vi.fn<TrustedValidator['validate']>().mockImplementationOnce(async () => { started.resolve(); return late.promise; }).mockResolvedValue(passed());
  const f = await fixture(validate); const pending = f.dispatcher.onResultSubmitted('T1', 'r1'); await started.promise;
  await f.dispatcher.cancelValidation('T1');
  expect(await pending).toMatchObject({ kind: 'validation_pending', evidence: { status: 'cancelled' } });
  late.resolve(passed()); await Promise.resolve(); expect(f.calls).toHaveLength(0);
  expect((await f.dispatcher.onResultSubmitted('T1', 'r1', true)).kind).toBe('checked');
});

it('does not let extra host response properties replace the task binding', async () => {
  const f = await fixture(async () => ({ ...passed(), taskId: 'OTHER', resultId: 'other', artifactDigest: 'forged' }));
  expect((await f.dispatcher.onResultSubmitted('T1', 'r1')).kind).toBe('checked');
  expect((await f.state()).tasks.get('T1')?.validation).toMatchObject({ taskId: 'T1', resultId: 'r1' });
});

it('rejects worker-authored validation events and cross-task result requests', async () => {
  const f = await fixture(async () => passed());
  await f.store.append([{ ...event('validation_finished', { taskId: 'T1', resultId: 'r1', status: 'passed' }), actor: { kind: 'agent', id: 'worker' } }]);
  expect((await f.state()).tasks.get('T1')?.validation).toBeUndefined();
  expect((await f.dispatcher.onResultSubmitted('OTHER', 'r1')).kind).toBe('skipped'); expect(f.calls).toHaveLength(0);
});

it('projecting later goal changes does not mutate historical validation evidence', async () => {
  const f = await fixture(async () => ({ status: 'environment_blocked', checks: [], summary: 'Missing browser' }));
  await f.dispatcher.onResultSubmitted('T1', 'r1');
  await f.store.append([event('goal_set', { text: 'Changed', deadline: '', decider: 'lead', delegation: { pmMayApply: [] } })]);
  const events = await f.store.read();
  const before = JSON.stringify(events);
  expect(project(events).tasks.get('T1')?.validation?.status).toBe('expired');
  expect(JSON.stringify(events)).toBe(before);
});

it('bounds runner time and keeps a timeout distinct from implementation failure', async () => {
  vi.useFakeTimers();
  try {
    const started = deferred<void>();
    const f = await fixture(async () => { started.resolve(); return new Promise(() => {}); });
    const pending = f.dispatcher.onResultSubmitted('T1', 'r1'); await started.promise;
    await vi.advanceTimersByTimeAsync(1001);
    expect(await pending).toMatchObject({ kind: 'validation_pending', evidence: { status: 'environment_blocked', summary: 'Trusted validation timeout' } });
    expect(f.calls).toHaveLength(0);
  } finally { vi.useRealTimers(); }
});

it('changes to submitted content while final judgement runs cannot accept stale measurements', async () => {
  const judging = deferred<void>(); const finish = deferred<void>();
  const f = await fixture(async () => passed(), true, async () => { judging.resolve(); await finish.promise; });
  const pending = f.dispatcher.onResultSubmitted('T1', 'r1'); await judging.promise;
  f.readResult.mockResolvedValue({ a: 'Changed artifact' }); finish.resolve();
  expect((await pending).kind).toBe('skipped');
  expect((await f.store.read()).some(e => e.type === 'task_checked')).toBe(false);
});

it('cancel during final judge records cancelled evidence and blocks the late verdict', async () => {
  const judging = deferred<void>(); const finish = deferred<void>();
  const f = await fixture(async () => passed(), true, async () => { judging.resolve(); await finish.promise; });
  const pending = f.dispatcher.onResultSubmitted('T1', 'r1'); await judging.promise;
  await f.dispatcher.cancelValidation('T1'); finish.resolve();
  expect((await pending).kind).toBe('skipped');
  expect((await f.state()).tasks.get('T1')?.validation?.status).toBe('cancelled');
});

it('manual acceptance cannot reuse passed evidence after backing snapshot content changes', async () => {
  const f = await fixture(async () => passed(), true, async () => { throw new Error('Judge temporarily unavailable'); });
  expect((await f.dispatcher.onResultSubmitted('T1', 'r1')).kind).toBe('error');
  expect((await f.state()).tasks.get('T1')?.validation?.status).toBe('passed');
  f.readResult.mockResolvedValue({ a: 'Changed artifact' });
  await expect(f.dispatcher.acceptResult('T1', 'lead', 'accept', 'manual')).rejects.toThrow('trusted validation');
  expect((await f.store.read()).some(e => e.type === 'task_checked')).toBe(false);
});

it('coalesces simultaneous explicit retries while preserving retry attempt identity', async () => {
  const started = deferred<void>(); const complete = deferred<ValidationOutput>();
  const validate = vi.fn<TrustedValidator['validate']>().mockResolvedValueOnce({ status: 'not_run', checks: [], summary: 'No environment' })
    .mockImplementationOnce(async () => { started.resolve(); return complete.promise; });
  const f = await fixture(validate);
  await f.dispatcher.onResultSubmitted('T1', 'r1');
  const first = f.dispatcher.onResultSubmitted('T1', 'r1', true); await started.promise;
  const duplicate = f.dispatcher.onResultSubmitted('T1', 'r1', true);
  expect(duplicate).toBe(first); complete.resolve(passed());
  expect((await first).kind).toBe('checked'); expect(validate).toHaveBeenCalledTimes(2);
});
