/** Provider-free integration of the exact pre-judge snapshot build/browser adapter. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ValidationInput } from '@ensemble/orchestrator';
import { APP_ROOT, PACKAGE_ROOT } from '../src/local.ts';
import { createLocalSnapshotRunner, createSnapshotValidator } from '../src/validator.ts';

const outputRoot = path.resolve(process.argv[2] ?? path.join(PACKAGE_ROOT, '.local', `snapshot-fixture-${Date.now()}`));
const reference = await readFile(path.join(PACKAGE_ROOT, 'fixtures/reference.jsx'), 'utf8');
const records: unknown[] = [];
const results = [];
for (const scenario of [
  { id: 'A-reference', task: 'A' as const, checkpoint: false, content: reference, expected: 'passed' },
  { id: 'B-checkpoint', task: 'B' as const, checkpoint: true, content: reference, expected: 'passed' },
  { id: 'B-reference', task: 'B' as const, checkpoint: false, content: reference, expected: 'passed' },
  { id: 'invalid-JSX', task: 'A' as const, checkpoint: false, content: 'export default function {', expected: 'failed' },
  { id: 'outside-snapshot-import', task: 'A' as const, checkpoint: false,
    content: `import ${JSON.stringify(path.join(PACKAGE_ROOT, 'fixtures/reference.jsx').replaceAll('\\', '/'))};`, expected: 'failed' },
]) {
  const validator = createSnapshotValidator({ starterRoot: path.join(PACKAGE_ROOT, 'starter'), outputRoot: path.join(outputRoot, scenario.id),
    policyFingerprint: 'offline-snapshot-fixture', checkpoint: () => scenario.checkpoint, record: event => records.push(event),
    runner: () => createLocalSnapshotRunner({ appRoot: APP_ROOT, packageRoot: PACKAGE_ROOT, task: scenario.task }) });
  const input: ValidationInput = { projectId: 'offline-fixture', taskId: scenario.task, resultId: scenario.id, planVersion: 1, specVersion: 1,
    contextDigest: 'offline-fixture', artifactDigest: createHash('sha256').update(scenario.content).digest('hex'), policyFingerprint: validator.policyFingerprint,
    workerLimitations: ['Fixture, no worker/model invocation'], artifacts: [{ id: 'source', path: 'src/App.jsx', content: scenario.content }] };
  const result = await validator.validate(input, AbortSignal.timeout(120_000));
  results.push({ id: scenario.id, expected: scenario.expected, ...result });
  console.log(`${scenario.id}: ${result.status}; ${result.checks.length} checks`);
}
await mkdir(outputRoot, { recursive: true });
await writeFile(path.join(outputRoot, 'summary.json'), JSON.stringify({ mode: 'fixture', actualModelInvocations: 0, results, records }, null, 2));
if (results.some(result => result.status !== result.expected)) process.exitCode = 1;
