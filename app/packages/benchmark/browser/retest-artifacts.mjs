// OFFLINE before/after regression evidence; copies only, never changes historical results.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { inspect } from './acceptance.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.BENCH_LEGACY_ROOT) throw new Error('BENCH_LEGACY_ROOT must identify the read-only old benchmark package');
const legacy = resolve(process.env.BENCH_LEGACY_ROOT);
const beforeFile = resolve(legacy, 'browser/acceptance.mjs');
const before = (await import(pathToFileURL(beforeFile).href)).inspect;
const hash = async p => createHash('sha256').update(await readFile(p)).digest('hex');
const out = resolve(root, '.local/semantic-retest', String(Date.now())); await mkdir(out, { recursive: true });
const env = { ...process.env, BENCH_APP_ROOT: process.env.BENCH_APP_ROOT || resolve(root, '../..'), BENCH_TASK: 'A', PORT: '4188' };
const report = { kind: 'OFFLINE_REGRESSION_NOT_LIVE', modelCalls: 0, historicalResultsUnchanged: true,
  beforeEvaluatorSha256: await hash(beforeFile), afterEvaluatorSha256: await hash(resolve(root,'browser/acceptance.mjs')), results: [] };
for (const id of ['pilot-01','pilot-02']) {
  const source = resolve(legacy,'evidence/codex-a-pair-v2/artifacts',id); const cwd = resolve(out,id);
  await cp(source,cwd,{recursive:true});
  await new Promise((ok,fail)=> { const p=spawn(process.execPath,['build.mjs'],{cwd,env,stdio:'inherit',windowsHide:true});p.once('error',fail);p.once('exit',code=>code===0?ok():fail(new Error(`Build exit ${code}`))); });
  const server=spawn(process.execPath,['server.mjs'],{cwd,env,stdio:['ignore','pipe','pipe'],windowsHide:true});const closed=new Promise(ok=>server.once('exit',ok));
  try {
    await new Promise((ok,fail)=> { const timer=setTimeout(()=>fail(new Error('Server timeout')),10000);server.stdout.once('data',()=>{clearTimeout(timer);ok();});server.once('error',e=>{clearTimeout(timer);fail(e);}); });
    const result={id,sourceSha256:await hash(resolve(source,'src/App.jsx')),
      before:await before('http://127.0.0.1:4188',{task:'A'}),
      after:await inspect('http://127.0.0.1:4188',{task:'A',outputDir:resolve(cwd,'after-screenshots')})};
    report.results.push(result);console.log(JSON.stringify(result));
  } finally {server.kill();await closed;}
}
await writeFile(resolve(out,'results.json'),JSON.stringify(report,null,2)+'\n');
console.log(`Offline evidence: ${out}`);
if(report.results[1].before.passed || !report.results.every(r=>r.after.passed))process.exitCode=1;
