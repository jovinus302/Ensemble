import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HISTORICAL_BASE_SHA } from '../src/protocol.ts';
import { APP_ROOT, PACKAGE_ROOT } from '../src/local.ts';
import { interpretationSchema, untypedLiterals } from '../src/preflight.ts';
import { strictSchema } from '../../llm/src/cli.ts';

// Reconstruct the exact old production transformer without calling its CLI runner.
// Its only runtime import is node:child_process; defining runCli does not execute it.
const oldSource = (await promisify(execFile)('git', ['show', `${HISTORICAL_BASE_SHA}:app/packages/llm/src/cli.ts`],
  { cwd: APP_ROOT, windowsHide: true })).stdout;
const local = path.join(PACKAGE_ROOT, '.local');
await mkdir(local, { recursive: true });
const legacyFile = path.join(local, 'schema-repro-legacy-cli.ts');
await writeFile(legacyFile, oldSource);
const legacy = await import(pathToFileURL(legacyFile).href) as { strictSchema: typeof strictSchema };
const input = await interpretationSchema();
const before = legacy.strictSchema(input);
const after = strictSchema(input);
const negative = untypedLiterals(before);
const positive = untypedLiterals(after);
const result = { modelCalls: 0, baseline: HISTORICAL_BASE_SHA, legacySourceSha256: createHash('sha256').update(oldSource).digest('hex'),
  negativeControl: { reproduced: negative.includes('$.properties.ops.items.anyOf[0].properties.type'), paths: negative },
  positiveControl: { passed: positive.length === 0, paths: positive },
  note: 'Exact legacy transformer and current transformer over the same populated PM interpretation schema; no provider acceptance claim', before, after };
const destination = path.resolve(process.argv[2] ?? path.join(local, 'schema-repro.json'));
await writeFile(destination, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ modelCalls: 0, negativeControl: result.negativeControl, positiveControl: result.positiveControl, destination }, null, 2));
if (!result.negativeControl.reproduced || !result.positiveControl.passed) process.exitCode = 1;
