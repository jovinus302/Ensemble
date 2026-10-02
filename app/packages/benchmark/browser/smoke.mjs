// Provider-free positive and negative integration controls using real Chromium.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { inspect } from './acceptance.mjs';
import { oracleVariant } from '../fixtures/oracle-variants.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (args, cwd, env) => new Promise((ok, fail) => { const p = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' }); p.once('error', fail); p.once('exit', code => code === 0 ? ok() : fail(new Error(`Exit ${code}`))); });
const results = [];
const negatives = ['wrong-date', 'wrong-time', 'wrong-guests', 'wrong-persisted', 'wrong-restored-controls', 'wrong-api-payload', 'hardcoded-first-tuple'];
const networkNegatives = ['external-http', 'external-websocket'];
const allVariants = ['A', 'B', 'starter', 'broken-B', 'localized', 'session-storage', 'A-no-edit', ...negatives, ...networkNegatives];
// Optional positional variant names support focused reruns without replacing full-suite evidence.
const selected = process.argv.slice(2);
if (selected.some(v => !allVariants.includes(v))) throw new Error('Unknown fixture variant');
const out = resolve(root, selected.length ? `.local/browser-smoke-focused-${Date.now()}` : '.local/browser-smoke');
await mkdir(out, { recursive: true });
for (const variant of selected.length ? selected : allVariants) {
  const cwd = resolve(out, variant); await cp(resolve(root,'starter'), cwd, { recursive: true });
  if (variant !== 'starter') { const source = oracleVariant(await readFile(resolve(root,'fixtures/reference.jsx'),'utf8'), variant); await writeFile(resolve(cwd,'src/App.jsx'),source); }
  const task = ['B', 'broken-B', 'wrong-restored-controls'].includes(variant) ? 'B' : 'A';
  const env = { ...process.env, BENCH_TASK: task, PORT: '0' };
  await run(['build.mjs'],cwd,env);
  const server = spawn(process.execPath, ['server.mjs'], { cwd, env, stdio: ['ignore','pipe','pipe'] });
  const closed = new Promise(ok => server.once('exit',ok));
  try {
    const url = await new Promise((ok, fail) => { const timeout = setTimeout(() => fail(new Error('Server start timeout')),10000); server.stdout.once('data',data=>{clearTimeout(timeout);const match=String(data).match(/http:\/\/127\.0\.0\.1:\d+/);match?ok(match[0]):fail(new Error('Missing fixture URL'));}); server.once('error',fail); server.once('exit',code=>fail(new Error(`Server exit ${code}`))); });
    const result = await inspect(url, { task, checkpoint: variant === 'starter', outputDir: resolve(cwd,'artifacts') });
    results.push({ variant, ...result });
    console.log(JSON.stringify(results.at(-1)));
  } finally { server.kill(); await closed; }
}
await writeFile(resolve(out,'results.json'),JSON.stringify({kind:'fixture-only-not-live',results},null,2));
for (const result of results) {
  const expectedFailure = result.variant === 'starter' ? 'checkpoint.selection' : result.variant === 'broken-B' ? 'change.six-to-seven-clears-time'
    : negatives.includes(result.variant) ? 'confirmation.persistence' : networkNegatives.includes(result.variant) ? 'console.clean' : null;
  if (expectedFailure ? !result.checks.some(c => c.id === expectedFailure && !c.pass) : !result.passed) process.exitCode=1;
  if (networkNegatives.includes(result.variant) && !result.checks.some(c => c.id === 'console.clean' && c.detail?.includes('Blocked'))) process.exitCode=1;
}
console.log(`Fixture-only evidence: ${out}`);
