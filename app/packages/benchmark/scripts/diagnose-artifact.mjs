// POSTHOC, provider-free diagnostics. Never changes primary reports or frozen sources/evaluator.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { inspect } from '../browser/acceptance.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'evidence/codex-a-pair-v2/posthoc');
const workspace = resolve(root, '.local/posthoc', String(Date.now()));
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const env = { ...process.env, BENCH_APP_ROOT: process.env.BENCH_APP_ROOT || resolve(root, '../..'), BENCH_TASK: 'A', PORT: '4197' };
const run = (args, cwd) => new Promise((ok, fail) => { const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit', windowsHide: true }); child.once('error', fail); child.once('exit', code => code === 0 ? ok() : fail(new Error(`Build exit ${code}`))); });
const { chromium } = await import(process.env.BENCH_PLAYWRIGHT ? pathToFileURL(resolve(process.env.BENCH_PLAYWRIGHT)).href : 'playwright');
async function semanticProbe(url, artifacts) {
  const browser = await chromium.launch({ headless: true });
  const result = { selected: { date: '2030-06-17', time: '19:00', guests: '6' }, beforeReload: null, afterReload: null, restoredControls: null, passed: false };
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 }, locale: 'en-US' }); page.setDefaultTimeout(5000);
    const c = id => page.getByTestId(id);
    await page.goto(url); await page.evaluate(() => localStorage.clear()); await page.reload();
    for (const [id, value] of Object.entries(result.selected)) {
      if (await c(id).evaluate(el => el.tagName) === 'SELECT') await c(id).selectOption(value); else await c(id).fill(value);
    }
    await c('submit').click(); await c('confirmation').waitFor({ state: 'visible' });
    result.beforeReload = await c('confirmation').innerText();
    await page.screenshot({ path: resolve(artifacts, 'confirmation-before-reload.png'), fullPage: true });
    await page.reload(); await c('confirmation').waitFor({ state: 'visible' });
    result.afterReload = await c('confirmation').innerText();
    await page.screenshot({ path: resolve(artifacts, 'confirmation-after-reload.png'), fullPage: true });
    await c('edit').click();
    result.restoredControls = Object.fromEntries(await Promise.all(Object.keys(result.selected).map(async id => [id, await c(id).inputValue()])));
    result.exactIsoInVisibleConfirmation = result.beforeReload.includes(result.selected.date);
    result.confirmationTextUnchanged = result.beforeReload === result.afterReload;
    result.controlValuesMatch = Object.entries(result.selected).every(([key, value]) => result.restoredControls[key] === value);
    result.passed = result.confirmationTextUnchanged && result.controlValuesMatch;
    await page.screenshot({ path: resolve(artifacts, 'restored-edit-controls.png'), fullPage: true });
  } catch (error) { result.error = error.message; }
  finally { await browser.close(); }
  return result;
}
await mkdir(output, { recursive: true });
const report = { kind: 'POSTHOC_DIAGNOSTIC_NOT_PRIMARY_RESULT', mode: 'provider-free', modelCalls: 0, primaryResultsUnchanged: true,
  originalEvaluatorSha256: await hash(resolve(root, 'browser/acceptance.mjs')),
  interpretation: 'Original frozen evaluator is rerun unchanged on copied final artifacts. The separate semantic probe tests retained confirmation and exact restored date/time/guest controls, allowing localized visible dates. This does not turn an orchestration handoff failure into a primary pass or retroactively change the rubric.', results: [] };
for (const id of ['pilot-01', 'pilot-02']) {
  const source = resolve(root, 'evidence/codex-a-pair-v2/artifacts', id); const cwd = resolve(workspace, id); const artifacts = resolve(output, id);
  await mkdir(artifacts, { recursive: true }); await cp(source, cwd, { recursive: true });
  await run(['build.mjs'], cwd);
  const server = spawn(process.execPath, ['server.mjs'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const closed = new Promise(ok => server.once('exit', ok));
  try {
    await new Promise((ok, fail) => { const timer = setTimeout(() => fail(new Error('Server startup timeout')), 10000); server.stdout.once('data', () => { clearTimeout(timer); ok(); }); server.once('error', e => { clearTimeout(timer); fail(e); }); server.once('exit', code => { clearTimeout(timer); fail(new Error(`Server exit ${code}`)); }); });
    const originalAcceptance = await inspect('http://127.0.0.1:4197', { task: 'A', outputDir: artifacts });
    const semanticPersistence = await semanticProbe('http://127.0.0.1:4197', artifacts);
    const entry = { cell: id, frozenArtifactPath: `evidence/codex-a-pair-v2/artifacts/${id}`, sourceSha256: await hash(resolve(source, 'src/App.jsx')), originalAcceptance, semanticPersistence };
    report.results.push(entry); console.log(JSON.stringify(entry));
  } finally { server.kill(); await closed; }
}
await writeFile(resolve(output, 'diagnostic.json'), JSON.stringify(report, null, 2) + '\n');
