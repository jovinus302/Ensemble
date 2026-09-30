// Live observation with real Codex and the real PM model; not part of the test suite (vitest only runs *.test.ts).
// Usage, from app/:
//   npx tsx scripts/live-codex-reopen.ts [output dir] [reopen|accept|both]
// Keys come from ENSEMBLE_ENV_FILE (or a .env above the working directory). The output dir defaults to ~/ensemble-agent-workspaces/live-codex-reopen/<timestamp>.
// reopen: real Codex builds the prototype of a plan whose other three tasks are checked; the decider then
//   asks for a missing "캘린더에 추가" button in chat — the real coordinator reads it, the PM reopens the
//   task, the agent revises it in a new turn and the handoff review checks it again.
// accept: a prototype task stopped at the revision cap; the decider says "이대로 확인해 주세요" in chat.
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { CodexSessionConnector } from '@ensemble/agents';
import { project, type AnyEvent, type NewLedgerEvent } from '@ensemble/core';
import { AnthropicProvider, loadEnv, modelFor, type LlmProvider } from '@ensemble/llm';
import { MemoryLedgerStore } from '@ensemble/store';
import { ProjectManager } from '@ensemble/orchestrator';

loadEnv();
const output = path.resolve(process.argv[2] ?? path.join(homedir(), 'ensemble-agent-workspaces/live-codex-reopen', new Date().toISOString().replace(/[:.]/g, '-')));
const mode = process.argv[3] ?? 'both';
await mkdir(output, { recursive: true });
const model = modelFor('pm');
const provider = new AnthropicProvider();
const log: string[] = [];
const note = (line: string) => { const text = `${new Date().toISOString()} ${line}`; log.push(text); console.log(text); };
const b64 = (text: string) => Buffer.from(text).toString('base64');
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const TITLE = '요가 예약 흐름 프로토타입';
const EXCLUSIONS = ['결제 화면과 모의 결제 버튼'];
const LIMITS = ['가입·시간 선택·예약 확인까지'];
const CONDITIONS = [
  '가입·시간 선택·예약 확인·결제 화면으로 이동 가능한 클릭형 흐름',
  '외부 네트워크 연결 없이 브라우저에서 바로 열리는 단일 HTML 파일',
  '실제 개인정보를 저장하거나 외부로 보내지 않는다는 안내 문구가 화면에 있음',
];
const FLOW = ['# 요가 스튜디오 예약 흐름 (디자이너 확인본)', '', '1. 가입: 이름, 휴대폰 번호(11자리) 입력. 빈 칸이면 오류 문구.',
  '2. 수업 시간 선택: 오늘 수업 4개(07:00, 10:00, 19:00, 21:00). 마감된 수업은 선택할 수 없음.',
  '3. 예약 확인: 선택한 수업·이름·시간 요약과 "예약이 확정되었습니다" 문구.', '', '결제 화면은 이번 범위에서 제외합니다.'].join('\n');

function seed(ctx: { projectId: string; targetProductId: string }, prototype: 'ready' | 'blocked'): NewLedgerEvent[] {
  const system = { kind: 'system' as const, id: 'seed' };
  const owner = { kind: 'human' as const, id: 'owner' };
  const designer = { kind: 'human' as const, id: 'designer' };
  const research = { kind: 'agent' as const, id: 'research-agent' };
  const pm = { kind: 'pm' as const, id: 'pm' };
  const members = [
    { memberId: 'owner', kind: 'human' as const, displayName: '사용자' },
    { memberId: 'designer', kind: 'human' as const, displayName: '디자이너' },
    { memberId: 'research-agent', kind: 'agent' as const, displayName: '조사 Agent', role: '공개 자료 조사' },
    { memberId: 'prototype-agent', kind: 'agent' as const, displayName: '프로토타입 Agent', role: '로컬 HTML 프로토타입 제작' },
  ];
  const tasks = [
    { id: 'research', title: '요가 예약 서비스 공개 자료 조사', assignee: 'research-agent', dependsOn: [], handoffConditions: ['예약 서비스 2곳 이상의 예약 흐름 비교'] },
    { id: 'interview', title: '가상 고객 인터뷰 정리', assignee: 'owner', dependsOn: [], handoffConditions: ['가상 고객 3명의 예약 불편 정리'] },
    { id: 'flow', title: '예약 화면 흐름 설계', assignee: 'designer', dependsOn: ['research', 'interview'], handoffConditions: ['가입부터 예약 확인까지 화면 목록'] },
    { id: 'prototype', title: `${TITLE} (결제 제외, 가입·시간 선택·예약 확인까지)`, baseTitle: TITLE, exclusions: EXCLUSIONS, limits: LIMITS, assignee: 'prototype-agent', dependsOn: ['flow'], handoffConditions: CONDITIONS },
  ];
  const done = (taskId: string, actor: typeof owner | typeof designer | typeof research, name: string, content: string): NewLedgerEvent[] => [
    { ...ctx, actor: pm, type: 'task_start_reserved', idempotencyKey: `start:${taskId}:v1`, payload: { taskId, specVersion: 1, trigger: 'kickoff' } },
    ...(actor.kind === 'agent' ? [{ ...ctx, actor, type: 'task_started' as const, payload: { taskId, turnId: `seed-${taskId}` } }] : []),
    { ...ctx, actor, type: 'attachment_recorded', payload: { attachmentId: `att-${taskId}`, name, mimeType: 'text/markdown', uri: `data:text/markdown;base64,${b64(content)}`, taskId } },
    { ...ctx, actor, type: 'result_submitted', payload: { taskId, resultId: `r-${taskId}`, planVersion: 1, summary: `${name} 제출`, artifactIds: [`att-${taskId}`] } },
    ...(actor.kind === 'agent' ? [{ ...ctx, actor, type: 'turn_observed' as const, payload: { agentId: actor.id, taskId, turnId: `seed-${taskId}`, status: 'completed' as const } }] : []),
    { ...ctx, actor: pm, type: 'task_checked', payload: { taskId, resultId: `r-${taskId}`, reason: 'seed: 인계 조건 충족' } },
  ];
  const events: NewLedgerEvent[] = [
    ...members.map(payload => ({ ...ctx, actor: system, type: 'member_joined', payload })),
    { ...ctx, actor: owner, type: 'goal_set', payload: { text: '요가 스튜디오 예약 서비스의 고객 반응을 클릭형 프로토타입으로 확인한다', deadline: '2026-10-15', decider: 'owner', delegation: { pmMayApply: [] } } },
    { ...ctx, actor: owner, type: 'plan_committed', payload: { version: 1, basedOn: null, reason: '승인한 계획', approvedBy: 'owner', sourceMessageIds: [], tasks } },
    { ...ctx, actor: owner, type: 'availability_updated', payload: { memberId: 'owner', weeklyHours: 10 } },
    { ...ctx, actor: owner, type: 'availability_updated', payload: { memberId: 'designer', weeklyHours: 10 } },
    ...done('research', research, 'research.md', '# 예약 서비스 비교\n| 서비스 | 흐름 |\n|---|---|\n| A | 가입 → 시간 → 확인 |\n| B | 시간 → 가입 → 확인 |'),
    ...done('interview', owner, 'interviews.md', '# 가상 고객 3명\n- 직장인: 퇴근 뒤 예약 마감\n- 학생: 가입 단계가 길다\n- 주부: 예약 확인 문자가 없다'),
    ...done('flow', designer, 'flow.md', FLOW),
  ];
  if (prototype === 'blocked') {
    const agent = { kind: 'agent' as const, id: 'prototype-agent' };
    const html = '<!doctype html><title>예약</title><h1>가입</h1><h1>수업 시간 선택</h1><h1>예약 확인</h1><p>실제 개인정보를 저장하거나 보내지 않는 시연용입니다.</p>';
    const missing = ['조건 1(가입·시간 선택·예약 확인·결제…): 결제 화면으로 이동하는 버튼이 없습니다.'];
    events.push({ ...ctx, actor: pm, type: 'task_start_reserved', idempotencyKey: 'start:prototype:v1', payload: { taskId: 'prototype', specVersion: 1, trigger: 'r-flow' } });
    for (let i = 0; i < 3; i++) {
      events.push(
        { ...ctx, actor: agent, type: 'task_started', payload: { taskId: 'prototype', turnId: `seed-turn-${i}` } },
        { ...ctx, actor: agent, type: 'attachment_recorded', payload: { attachmentId: `proto-${i}`, name: 'prototype.html', mimeType: 'text/html', uri: `data:text/html;base64,${b64(html)}`, taskId: 'prototype' } },
        { ...ctx, actor: agent, type: 'result_submitted', payload: { taskId: 'prototype', resultId: `r-proto-${i}`, planVersion: 1, summary: '예약 흐름 프로토타입', artifactIds: [`proto-${i}`] } },
        { ...ctx, actor: agent, type: 'turn_observed', payload: { agentId: 'prototype-agent', taskId: 'prototype', turnId: `seed-turn-${i}`, status: 'completed' } },
        { ...ctx, actor: pm, type: 'handoff_reviewed', payload: { taskId: 'prototype', resultId: `r-proto-${i}`, verdict: 'insufficient', met: [], missing, evidence: [] } },
        { ...ctx, actor: pm, type: 'revision_requested', payload: { taskId: 'prototype', resultId: `r-proto-${i}`, missing } },
      );
    }
    events.push({ ...ctx, actor: { kind: 'system', id: 'dispatcher' }, type: 'task_blocked', payload: { taskId: 'prototype', reason: '보완을 2회 요청했지만 인계 조건을 채우지 못했습니다', unblockBy: 'owner' } });
  }
  return events;
}

async function run(label: string, prototype: 'ready' | 'blocked', act: (h: Harness) => Promise<Record<string, unknown>>) {
  const dir = path.join(output, label);
  await mkdir(dir, { recursive: true });
  const ctx = { projectId: `m11-wa-${label}-${Date.now()}`, targetProductId: 'yoga' };
  const store = new MemoryLedgerStore();
  const calls: unknown[] = [];
  const llm: LlmProvider = { async complete(request) {
    const started = Date.now();
    const response = await provider.complete(request);
    calls.push({ tool: request.forceTool, ms: Date.now() - started, system: request.system?.slice(0, 400), input: request.messages.map(m => m.content.slice(0, 4000)), toolCalls: response.toolCalls });
    return response;
  } };
  const connector = new CodexSessionConnector({ workspaceRoot: path.join(dir, 'agents') });
  const pm = new ProjectManager({ ...ctx, store, llm, connector, model, turnTimeoutMs: 20 * 60_000 });
  await store.append(seed(ctx, prototype));
  const events = async () => await store.read({ projectId: ctx.projectId }) as AnyEvent[];
  const h: Harness = { pm, events, dir, until: async (what, predicate, minutes = 20) => {
    const deadline = Date.now() + minutes * 60_000;
    for (;;) {
      const posts = await pm.flush().catch(error => { note(`flush error: ${error instanceof Error ? error.message : error}`); return []; });
      for (const post of posts) note(`PM(background): ${post.text}`);
      const ledger = await events();
      if (predicate(ledger)) { note(`reached: ${what}`); return true; }
      if (Date.now() > deadline) { note(`TIMEOUT: ${what}`); return false; }
      await pause(5000);
    }
  } };
  let result: Record<string, unknown> = {};
  try { result = await act(h); } catch (error) { result = { error: error instanceof Error ? `${error.message}\n${error.stack}` : String(error) }; note(`ERROR ${String(error)}`); }
  const ledger = await events();
  const state = project(ledger);
  const channel = ledger.flatMap(e => e.type === 'pm_spoke' ? [`[PM] ${e.payload.text}`] : e.type === 'reply_recorded' ? [`[${state.members.get(e.payload.memberId)?.displayName}] ${e.payload.text}`] : e.type === 'message_recorded' ? [`[${state.members.get(e.payload.authorId)?.displayName}] ${e.payload.text}`] : []);
  await writeFile(path.join(dir, 'events.json'), JSON.stringify(ledger.map(e => e.type === 'attachment_recorded' ? { ...e, payload: { ...e.payload, uri: `${e.payload.uri.slice(0, 40)}…` } } : e), null, 2));
  await writeFile(path.join(dir, 'channel.txt'), channel.join('\n\n'));
  await writeFile(path.join(dir, 'llm-calls.json'), JSON.stringify(calls, null, 2));
  const summary = { label, projectId: ctx.projectId, statuses: Object.fromEntries([...state.tasks].map(([id, t]) => [id, t.status])), ...result };
  await writeFile(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  note(`${label} summary: ${JSON.stringify(summary).slice(0, 1500)}`);
  await pm.stop().catch(() => undefined);
  return summary;
}
interface Harness { pm: ProjectManager; events: () => Promise<AnyEvent[]>; dir: string; until: (what: string, predicate: (events: AnyEvent[]) => boolean, minutes?: number) => Promise<boolean> }

const checks = (events: AnyEvent[], taskId: string) => events.filter(e => e.type === 'task_checked' && e.payload.taskId === taskId).length;
function finalHtml(events: AnyEvent[]): { name: string; html: string } | undefined {
  const state = project(events);
  const resultId = state.tasks.get('prototype')?.checkedResultId;
  const result = events.find(e => e.type === 'result_submitted' && e.payload.resultId === resultId);
  if (result?.type !== 'result_submitted') return undefined;
  for (const id of result.payload.artifactIds) {
    const attachment = events.find(e => e.type === 'attachment_recorded' && e.payload.attachmentId === id);
    if (attachment?.type === 'attachment_recorded' && /html/.test(attachment.payload.mimeType)) return { name: attachment.payload.name, html: Buffer.from(attachment.payload.uri.split(',')[1]!, 'base64').toString('utf8') };
  }
  return undefined;
}

const summaries: unknown[] = [];
if (mode === 'reopen' || mode === 'both') summaries.push(await run('reopen', 'ready', async ({ pm, events, dir, until }) => {
  const started = Date.now();
  await pm['dispatcher'].startReady('kickoff');
  note('prototype started (real Codex)');
  if (!await until('prototype checked or stopped', ev => checks(ev, 'prototype') > 0 || project(ev).tasks.get('prototype')?.status === 'blocked', 25)) return { stage: 'first build timeout' };
  let ev = await events();
  const firstStatus = project(ev).tasks.get('prototype')?.status;
  const first = finalHtml(ev);
  if (first) await writeFile(path.join(dir, `first-${first.name}`), first.html);
  if (firstStatus !== 'checked') return { stage: 'first build not checked', firstStatus, minutes: (Date.now() - started) / 60000 };
  const allChecked = ev.some(e => e.type === 'pm_spoke' && e.payload.text === '프로젝트 작업이 모두 확인됐어요.');
  const firstMinutes = (Date.now() - started) / 60000;
  const ask = "@프로토타입 Agent 예약 확인 화면에 '캘린더에 추가' 버튼이 없어요. 추가해서 다시 올려 주세요";
  note(`owner: ${ask}`);
  const posts = await pm.postMessage('owner', ask);
  for (const post of posts) note(`PM: ${post.text}`);
  ev = await events();
  const reopened = ev.some(e => e.type === 'revision_requested' && e.actor.kind === 'human' && e.payload.taskId === 'prototype');
  if (!reopened) return { stage: 'reopen not interpreted', firstMinutes, allChecked, posts, coordination: ev.filter(e => e.type === 'pm_considered').slice(-2).map(e => e.payload) };
  const reopenStart = Date.now();
  if (!await until('prototype checked again', e2 => checks(e2, 'prototype') >= 2 || project(e2).tasks.get('prototype')?.status === 'blocked', 25)) return { stage: 'revision timeout', firstMinutes };
  ev = await events();
  const final = finalHtml(ev);
  if (final) await writeFile(path.join(dir, `final-${final.name}`), final.html);
  const state = project(ev);
  const turns = ev.filter(e => e.type === 'task_started' && e.payload.taskId === 'prototype').length;
  return {
    stage: 'done', firstMinutes, reopenMinutes: (Date.now() - reopenStart) / 60000, allCheckedAfterFirst: allChecked,
    reopenPosts: posts.map(p => p.text), prototypeTurns: turns, prototypeStatus: state.tasks.get('prototype')?.status,
    allChecked: [...state.tasks.values()].every(t => t.status === 'checked'),
    finalHtml: final?.name, calendarButton: !!final && /캘린더에\s*추가/.test(final.html), paymentHits: final ? (final.html.match(/결제|payment/gi) ?? []).length : null,
    firstPaymentHits: first ? (first.html.match(/결제|payment/gi) ?? []).length : null,
    reviews: ev.filter(e => e.type === 'handoff_reviewed' && e.payload.taskId === 'prototype').map(e => e.type === 'handoff_reviewed' ? { verdict: e.payload.verdict, met: e.payload.met, missing: e.payload.missing, evidence: e.payload.evidence } : null),
  };
}));
if (mode === 'accept' || mode === 'both') summaries.push(await run('accept', 'blocked', async ({ pm, events }) => {
  const ask = '결제 화면 조건은 이제 필요 없어요. 이대로 확인해 주세요';
  note(`owner: ${ask}`);
  const posts = await pm.postMessage('owner', ask);
  for (const post of posts) note(`PM: ${post.text}`);
  const ev = await events();
  const state = project(ev);
  return { stage: 'done', posts: posts.map(p => p.text), prototypeStatus: state.tasks.get('prototype')?.status,
    checkedBy: ev.findLast(e => e.type === 'task_checked')?.actor, reason: ev.findLast(e => e.type === 'task_checked')?.payload,
    coordination: ev.filter(e => e.type === 'pm_considered').slice(-2).map(e => e.payload) };
}));
await writeFile(path.join(output, 'run-log.txt'), log.join('\n'));
await writeFile(path.join(output, 'summaries.json'), JSON.stringify(summaries, null, 2));
process.exit(0);
