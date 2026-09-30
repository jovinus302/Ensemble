import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteLedgerStore } from '@ensemble/store';
import { continuousScenario } from '@ensemble/scenarios';
import type { AnyEvent } from '@ensemble/core';

// Observations only: the server owns all PM decisions and agent execution.
const app = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(homedir(), 'ensemble-agent-workspaces', 'm6-demo', new Date().toISOString().replace(/[:.]/g, '-'));
const data = path.join(output, 'data');
await mkdir(data, { recursive: true });
const port = Number(process.env.ENSEMBLE_DEMO_PORT ?? 3196);
const base = `http://127.0.0.1:${port}/api/`;
const timeline: unknown[] = [];
const rows: string[] = [];
const started = Date.now();
let store: SqliteLedgerStore | undefined;
let failure: string | undefined;
let seq = 0;
let lastState: any;
const save = (name: string, value: unknown) => writeFile(path.join(output, name), JSON.stringify(value, null, 2));
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
console.log(`RUN: ${output}`);
async function checkStop() {
  const reason = await readFile(path.join(output, 'stop-request.txt'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  if (reason.trim()) throw new Error(`시연 중단: ${reason.trim()}`);
}
const server = spawn(process.execPath, [path.join(app, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], {
  cwd: path.join(app, 'apps/web'), windowsHide: true, stdio: 'ignore',
  env: { ...process.env, ENSEMBLE_AGENT_RUNTIME: 'codex', ENSEMBLE_ENV_FILE: 'C:/Users/siheon.ryu/Desktop/workspace/ensemble/.env', ENSEMBLE_DATA_DIR: data,
    ENSEMBLE_AGENT_WORKSPACE_ROOT: path.join(output, 'workspaces') },
});
server.on('error', () => { failure = '서버 시작 실패'; });
async function api(route: string, body?: unknown): Promise<any> {
  const response = await fetch(base + route, { ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(21 * 60 * 1000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${route}`);
  return response.json();
}
async function events(): Promise<AnyEvent[]> {
  const meta = JSON.parse(await readFile(path.join(data, 'runtime.json'), 'utf8'));
  store ??= new SqliteLedgerStore(path.join(data, 'ensemble.db'));
  return await store.read({ projectId: meta.projectId }) as AnyEvent[];
}
async function snapshot(label: string, begin: number, error?: string) {
  const state = await api('state').catch(cause => { if (!lastState) throw cause; return lastState; });
  lastState = state;
  const ledger = await events();
  const fresh = ledger.filter(e => e.seq > seq);
  seq = ledger.at(-1)?.seq ?? seq;
  const step = /^\d+$/.test(label) ? continuousScenario.steps[Number(label) - 1] : undefined;
  const record = { label, at: new Date().toISOString(), durationSeconds: (Date.now() - begin) / 1000, error, humanInput: step, state, events: fresh };
  timeline.push(record);
  await save(`state-${label}.json`, { ...record, ledger });
  await save('timeline.json', timeline);
  const decisions = fresh.flatMap(e => e.type === 'pm_considered' ? [`${e.payload.decision}: ${e.payload.reason}`] : []);
  rows.push(`| ${label} | ${record.durationSeconds.toFixed(1)}초 | ${error ?? '진행'} | 계획 ${state.roadmap.planVersion ?? 0}; ${decisions.join('; ').replaceAll('|', '/').replaceAll('\n', ' ')} |`);
  console.log(`${label}: ${record.durationSeconds.toFixed(1)}s, plan=${state.roadmap.planVersion}, ${error ?? 'ok'}`);
  return { state, ledger };
}
try {
  for (let i = 0; ; i++) {
    try { await api('state'); break; } catch { if (i >= 90 || server.exitCode !== null || failure) throw new Error(failure ?? '서버 준비 시간 초과'); await pause(1000); }
  }
  await api('scenario/start', { name: continuousScenario.key });
  await snapshot('00-start', Date.now());
  for (const [index, step] of continuousScenario.steps.entries()) {
    const begin = Date.now();
    console.log(`step ${index + 1}: ${step.as}: ${step.text}`);
    // Observe while the HTTP call waits, stopping promptly on a blocked agent.
    const request = api('scenario/next', {});
    let finished = false;
    const settled = request.finally(() => { finished = true; });
    void settled.catch(() => undefined);
    let error: string | undefined;
    try {
      while (!finished) {
        await Promise.race([settled.catch(() => undefined), pause(2000)]);
        await checkStop();
        const current = await events();
        const blocked = current.findLast(e => e.type === 'task_blocked');
        if (blocked?.type === 'task_blocked') throw new Error(blocked.payload.reason);
      }
      await settled;
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    await snapshot(String(index + 1).padStart(2, '0'), begin, error);
    if (error) throw new Error(error);
  }
  const begin = Date.now();
  while (true) {
    await checkStop();
    const ledger = await events();
    const prototype = ledger.some(e => e.type === 'result_submitted' && e.actor.id === 'prototype-agent');
    const complete = ledger.some(e => e.type === 'turn_observed' && e.payload.agentId === 'prototype-agent' && e.payload.status === 'completed');
    const blocked = ledger.findLast(e => e.type === 'task_blocked');
    if (blocked?.type === 'task_blocked') throw new Error(blocked.payload.reason);
    if (prototype && complete) break;
    if (Date.now() - begin > 20 * 60 * 1000) throw new Error('최종 프로토타입 대기 시간 초과');
    await pause(2000);
  }
  await snapshot('final', begin);
} catch (cause) {
  failure = cause instanceof Error ? cause.message : String(cause);
  try { await snapshot('stopped', Date.now(), failure); } catch { /* Startup failure has no ledger. */ }
} finally {
  try {
    const ledger = await events();
    await save('ledger.json', ledger);
    const artifacts: unknown[] = [];
    await mkdir(path.join(output, 'artifacts'), { recursive: true });
    for (const e of ledger) {
      if (e.type !== 'attachment_recorded' || e.actor.kind !== 'agent') continue;
      const response = await fetch(base + `attachments/${e.payload.attachmentId}`);
      if (!response.ok) throw new Error(`첨부 다운로드 실패: ${e.payload.name}`);
      const local = `${e.seq}-${path.basename(e.payload.name)}`;
      await writeFile(path.join(output, 'artifacts', local), Buffer.from(await response.arrayBuffer()));
      const session = ledger.findLast(s => s.type === 'session_linked' && s.payload.agentId === e.actor.id);
      let workspaceCopy: string | undefined;
      if (session?.type === 'session_linked') {
        const raw = ledger.filter(r => r.type === 'agent_report_recorded' && r.actor.id === e.actor.id);
        const matches = raw.flatMap(r => r.type === 'agent_report_recorded' ? [...r.payload.text.matchAll(/"path"\s*:\s*"([^"]+)"/g)].map(m => m[1]!) : []);
        const relative = matches.find(p => path.basename(p) === e.payload.name);
        if (relative && !path.isAbsolute(relative) && !relative.split(/[\\/]/).includes('..')) {
          workspaceCopy = path.join(session.payload.workspace, relative);
          await copyFile(workspaceCopy, path.join(output, 'artifacts', `workspace-${local}`));
        }
      }
      artifacts.push({ agent: e.actor.id, name: e.payload.name, attachmentId: e.payload.attachmentId, workspaceCopy, local });
    }
    await save('artifacts.json', artifacts);
  } catch (cause) { failure ??= `산출물 확인 실패: ${cause instanceof Error ? cause.message : String(cause)}`; }
  store?.close();
  if (server.pid) {
    if (process.platform === 'win32') await new Promise<void>(resolve => { const stop = spawn('taskkill', ['/pid', String(server.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); stop.on('exit', () => resolve()); stop.on('error', () => resolve()); });
    else server.kill('SIGTERM');
  }
  await writeFile(path.join(output, 'report.md'), `# 연속 시연 기록\n\n시작: ${new Date(started).toISOString()}\n\n전체 시간: ${((Date.now() - started) / 1000).toFixed(1)}초\n\n결과: ${failure ?? '대본과 최종 Agent 작업 완료; HTML 내용은 별도 확인 필요'}\n\n| 단계 | 시간 | 결과 | 관찰 |\n|---|---|---|---|\n${rows.join('\n')}\n\n각 단계의 사람 발언, PM 판단과 이유, 게시글, 계획, 작업, 예측, 카드와 Agent 변경 확인은 state 및 timeline 파일에 저장했습니다.\n`);
  console.log(`REPORT: ${output}`);
  process.exitCode = failure ? 1 : 0;
}
