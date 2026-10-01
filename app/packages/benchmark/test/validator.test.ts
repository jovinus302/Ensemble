import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { ValidationInput } from '@ensemble/orchestrator';
import { PACKAGE_ROOT } from '../src/local.ts';
import { createSnapshotValidator, SnapshotBuildFailure } from '../src/validator.ts';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
function input(overrides: Partial<ValidationInput> = {}): ValidationInput {
  return { projectId: 'project', taskId: 'task', resultId: 'result', planVersion: 1, specVersion: 1,
    contextDigest: 'context', artifactDigest: 'artifact', policyFingerprint: 'policy', workerLimitations: ['Could not run browser'],
    artifacts: [{ id: 'source', path: 'src/App.jsx', content: 'export default function App() { return null; }' }], ...overrides };
}
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'ensemble-validator-')); roots.push(root);
  const runner = { build: vi.fn(async (_snapshot: string, _signal: AbortSignal) => {}),
    inspect: vi.fn(async () => ({ passed: true, checks: [{ id: 'booking', pass: true }] })), stop: vi.fn(async () => {}) };
  const events: any[] = []; const onMeasured = vi.fn(); let checkpoint = false;
  const validator = createSnapshotValidator({ starterRoot: path.join(PACKAGE_ROOT, 'starter'), outputRoot: root,
    policyFingerprint: 'policy', checkpoint: () => checkpoint, runner: () => runner, record: event => events.push(event), onMeasured });
  return { root, runner, validator, events, onMeasured, phase: () => { checkpoint = true; } };
}
it('builds captured submission bytes with fixed infrastructure before browser and binds measured revision', async () => {
  const { validator, runner, events, onMeasured } = await setup();
  const result = await validator.validate(input(), new AbortController().signal);
  expect(result.status).toBe('passed'); expect(result.checks.map(check => check.id)).toEqual(['build', 'booking']);
  expect(runner.build.mock.invocationCallOrder[0]).toBeLessThan(runner.inspect.mock.invocationCallOrder[0]!);
  const snapshot = runner.build.mock.calls[0]![0];
  expect(await readFile(path.join(snapshot, 'src/App.jsx'), 'utf8')).toBe(input().artifacts[0]!.content);
  expect(await readFile(path.join(snapshot, 'build.mjs'))).toEqual(await readFile(path.join(PACKAGE_ROOT, 'starter/build.mjs')));
  expect(events[0]).toMatchObject({ resultId: 'result', artifactDigest: 'artifact', contextDigest: 'context', policyFingerprint: 'policy' });
  expect(events[0].snapshotDigest).toMatch(/^[a-f0-9]{64}$/); expect(onMeasured).toHaveBeenCalledOnce(); expect(runner.stop).toHaveBeenCalledOnce();
});
it.each(['../escape.jsx', '/absolute.jsx', 'src/../../outside.jsx', 'src\\App.jsx', 'C:/escape.jsx', 'src/./App.jsx', 'src//App.jsx', 'src/CON.jsx', 'src/folder./App.jsx'])('rejects unsafe path %s before host execution', async unsafe => {
  const { validator, runner } = await setup();
  const result = await validator.validate(input({ artifacts: [{ id: 'bad', path: unsafe, content: 'bad' }] }), new AbortController().signal);
  expect(result.status).toBe('failed'); expect(runner.build).not.toHaveBeenCalled();
});
it('rejects lossy decoding of captured bytes and preserves exact valid UTF-8', async () => {
  const { validator, runner } = await setup(); const signal = new AbortController().signal;
  const bad = { id: 'source', path: 'src/App.jsx', content: '\ufffd', contentBase64: Buffer.from([255]).toString('base64') };
  expect((await validator.validate(input({ artifacts: [bad] }), signal)).status).toBe('failed');
  expect(runner.build).not.toHaveBeenCalled();
  const good = { ...input().artifacts[0]!, content: '/* 예약 */', contentBase64: Buffer.from('/* 예약 */').toString('base64') };
  expect((await validator.validate(input({ artifacts: [good] }), signal)).status).toBe('passed');
  expect(await readFile(path.join(runner.build.mock.calls[0]![0], 'src/App.jsx'))).toEqual(Buffer.from(good.contentBase64, 'base64'));
});
it('does not execute worker infrastructure or silently substitute an unreported starter implementation', async () => {
  const { validator, runner } = await setup(); const signal = new AbortController().signal;
  expect((await validator.validate(input({ artifacts: [{ id: 'bad', path: 'build.mjs', content: 'arbitrary code' }] }), signal)).status).toBe('failed');
  expect((await validator.validate(input({ artifacts: [] }), signal)).status).toBe('not_run');
  expect(runner.build).not.toHaveBeenCalled();
});
it('rejects case-insensitive duplicate paths on Windows', async () => {
  const { validator } = await setup();
  const artifacts = [input().artifacts[0]!, { id: 'other', path: 'src/app.jsx', content: 'different' }];
  expect((await validator.validate(input({ artifacts }), new AbortController().signal)).status).toBe('failed');
});
it('coalesces duplicate immutable revisions but isolates new result, scope, policy and phase', async () => {
  const { validator, runner, phase } = await setup(); const signal = new AbortController().signal;
  await Promise.all([validator.validate(input(), signal), validator.validate(input(), signal)]);
  await validator.validate(input(), signal); expect(runner.build).toHaveBeenCalledTimes(1);
  await validator.validate(input({ resultId: 'new-result' }), signal);
  await validator.validate(input({ taskId: 'other-task' }), signal);
  await validator.validate(input({ contextDigest: 'new-plan' }), signal);
  await validator.validate(input({ policyFingerprint: 'new-policy' }), signal);
  phase(); await validator.validate(input(), signal); expect(runner.build).toHaveBeenCalledTimes(6);
});
it('keeps implementation defects distinct from environment blocks and retries only unmeasured environment failure', async () => {
  const { validator, runner } = await setup(); const signal = new AbortController().signal;
  runner.build.mockRejectedValueOnce(new Error('spawn EPERM'));
  expect((await validator.validate(input(), signal)).status).toBe('environment_blocked');
  expect((await validator.validate(input(), signal)).status).toBe('passed');
  runner.build.mockRejectedValueOnce(new SnapshotBuildFailure('invalid JSX'));
  expect((await validator.validate(input({ resultId: 'syntax' }), signal)).status).toBe('failed');
  expect((await validator.validate(input({ resultId: 'syntax' }), signal)).status).toBe('failed');
  expect(runner.build).toHaveBeenCalledTimes(3); expect(runner.stop).toHaveBeenCalledTimes(3);
});
it('does not promote worker limitations or a failing browser check to a measured pass', async () => {
  const { validator, runner } = await setup();
  runner.inspect.mockResolvedValueOnce({ passed: false, checks: [{ id: 'booking', pass: false }] });
  expect((await validator.validate(input(), new AbortController().signal))).toMatchObject({ status: 'failed', checks: [{ id: 'build', status: 'passed' }, { id: 'booking', status: 'failed' }] });
});
it('aborts and cleans its runner without caching cancelled evidence; retry can measure again', async () => {
  const { validator, runner } = await setup(); const controller = new AbortController();
  runner.build.mockImplementationOnce(async () => { controller.abort(new Error('cancelled')); });
  await expect(validator.validate(input(), controller.signal)).rejects.toThrow('cancelled');
  expect(runner.inspect).not.toHaveBeenCalled(); expect(runner.stop).toHaveBeenCalledOnce();
  expect((await validator.validate(input(), new AbortController().signal)).status).toBe('passed');
});
