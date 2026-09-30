// Drives the continuous scenario against an already running web server (e.g. `cd apps/web && npx next dev -p 3401`)
// with its default fake Agents, then waits for the changed prototype and its review.
// Usage: ENSEMBLE_HTTP_URL=http://localhost:3401 ENSEMBLE_HTTP_REPORT_DIR=<dir> npx tsx scripts/http-server-check.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { continuousScenario } from '../packages/scenarios/src/index.ts';

const base = process.env.ENSEMBLE_HTTP_URL ?? 'http://localhost:3401';
const output = process.env.ENSEMBLE_HTTP_REPORT_DIR;
if (!output) throw new Error('ENSEMBLE_HTTP_REPORT_DIR is required');
mkdirSync(output, { recursive: true });
const observations: unknown[] = [];
async function request(route: string, body?: unknown) {
  const response = await fetch(`${base}/api/${route}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(`${route}: ${response.status} non-JSON response (server compilation or transport failure)`);
  const data = await response.json();
  if (!response.ok) throw new Error(`${route}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}
try {
  await request('scenario/start', { name: continuousScenario.key, confirmReplace: true });
  for (let step = 0; step < continuousScenario.steps.length; step++) {
    const started = Date.now();
    const accepted = await request('scenario/next', {});
    if (!accepted.accepted) throw new Error('scenario/next did not accept');
    let state;
    do {
      await new Promise(r => setTimeout(r, 1000));
      state = await request('state');
      if (state.activity?.stalled) throw new Error(`step ${step} stalled: ${state.activity.stalled.reason}`);
      if (Date.now() - started > 240000) throw new Error(`step ${step} timed out`);
    } while (state.busy);
    observations.push({ step, elapsedMs: Date.now() - started, state });
    writeFileSync(path.join(output, 'http-observations.json'), JSON.stringify(observations, null, 2));
    console.log(JSON.stringify({ step, seconds: Math.round((Date.now() - started) / 1000), plan: state.roadmap.planVersion, next: state.scenario.nextLine?.text, done: state.scenario.done }));
  }
  let state = await request('state');
  if (!state.scenario.done || state.roadmap.planVersion < 2) throw new Error('scenario did not finish with plan v2');
  const resultStarted = Date.now();
  let prototype;
  do {
    state = await request('state');
    prototype = state.messages.flatMap((m: { attachments: { name: string; url: string }[] }) => m.attachments).findLast((a: { name: string }) => /^prototype-v[2-9].*\.html$/.test(a.name));
    if (!prototype) await new Promise(r => setTimeout(r, 1000));
  } while (!prototype && Date.now() - resultStarted < 120000);
  if (!prototype) throw new Error('changed prototype file did not arrive');
  const html = await (await fetch(`${base}${prototype.url}`)).text();
  writeFileSync(path.join(output, 'prototype.html'), html);
  if (html.includes('>모의 결제</button>') || html.includes('data-screen="payment"') || html.includes('<h2>결제')) throw new Error('changed prototype still contains payment flow');
  const reviewStarted = Date.now();
  const prototypeTask = () => state.roadmap.tasks.find((task: { assigneeName: string }) => task.assigneeName === '프로토타입 Agent');
  while (prototypeTask()?.status !== 'checked' && Date.now() - reviewStarted < 120000) {
    if (prototypeTask()?.status === 'blocked' || state.activity?.stalled) throw new Error(`prototype review stopped: ${state.activity?.stalled?.reason ?? 'blocked'}`);
    await new Promise(r => setTimeout(r, 1000)); state = await request('state');
  }
  const prototypeStatus = prototypeTask()?.status;
  if (prototypeStatus !== 'checked') throw new Error(`prototype must be checked, received ${prototypeStatus}`);
  const clarificationUsed = state.messages.some((message: { authorId: string; text: string }) => message.authorId === 'owner' && message.text === continuousScenario.steps.at(-1)!.text);
  writeFileSync(path.join(output, 'http-result.json'), JSON.stringify({ success: true, skipped: 0, changedPrototype: prototype.name, prototypeStatus, clarificationUsed, state }, null, 2));
} catch (error) {
  const state = await request('state').catch(() => null);
  writeFileSync(path.join(output, 'http-result.json'), JSON.stringify({ success: false, error: String(error), observations, state }, null, 2));
  throw error;
}
