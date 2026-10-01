import { inspectCodexSchema } from '../src/preflight.ts';
const result = await inspectCodexSchema();
console.log(JSON.stringify(result, null, 2));
if (!result.schemaReady) process.exitCode = 1;
