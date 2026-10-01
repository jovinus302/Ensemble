// Provider-free positive and negative integration controls using real Chromium.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { inspect } from './acceptance.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, '.local/browser-smoke');
await mkdir(out, { recursive: true });
const run = (args, cwd, env) => new Promise((ok, fail) => { const p = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' }); p.once('error', fail); p.once('exit', code => code === 0 ? ok() : fail(new Error(`Exit ${code}`))); });
const results = [];
for (const variant of ['A', 'B', 'starter', 'broken-B']) {
  const cwd = resolve(out, variant); await cp(resolve(root,'starter'), cwd, { recursive: true });
  if (variant !== 'starter') { let source = await readFile(resolve(root,'fixtures/reference.jsx'),'utf8'); if (variant === 'broken-B') source = source.replace("setTime(''); setMessage('Time cleared:", "setMessage('Time cleared:"); await writeFile(resolve(cwd,'src/App.jsx'),source); }
  const env = { ...process.env, BENCH_TASK: variant === 'A' ? 'A' : 'B', PORT: '4187' };
  await run(['build.mjs'],cwd,env);
  const server = spawn(process.execPath, ['server.mjs'], { cwd, env, stdio: ['ignore','pipe','pipe'] });
  try {
    await new Promise((ok, fail) => { const timeout = setTimeout(() => fail(new Error('Server start timeout')),10000); server.stdout.once('data',()=>{clearTimeout(timeout);ok();}); server.once('error',fail); server.once('exit',code=>fail(new Error(`Server exit ${code}`))); });
    const result = await inspect('http://127.0.0.1:4187', { task: variant === 'A' ? 'A' : 'B', checkpoint: variant === 'starter', outputDir: resolve(cwd,'artifacts') });
    results.push({ variant, ...result });
    console.log(JSON.stringify(results.at(-1)));
  } finally { server.kill(); await new Promise(ok => server.once('exit',ok)); }
}
await writeFile(resolve(out,'results.json'),JSON.stringify({kind:'fixture-only-not-live',results},null,2));
if (!results[0].passed || !results[1].passed || results[2].passed || results[3].passed || !results[3].checks.some(c=>c.id==='change.six-to-seven-clears-time' && !c.pass)) process.exitCode=1;
