import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { CodexSessionConnector } from '@ensemble/agents';
import { project, type AnyEvent, type NewLedgerEvent } from '@ensemble/core';
import type { LlmProvider, LlmRequest } from '@ensemble/llm';
import { MemoryLedgerStore } from '@ensemble/store';
import { ProjectManager } from '../src/pm.ts';

// QA3 S1/S3/M1/L3: PM revision requests reach the agent like answers and changes do, a person can send an
// agent result back for review, successors wait for their predecessors, and people hear acceptance.
let n = 0;
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

const REVIEW = 'record_handoff_review';
type Judge = (taskId: string, files: string, request: LlmRequest) => Record<string, unknown>;
const met = (file: string, quote: string) => ({ conditions: [{ index: 1, met: true, file, quote }], decisionConflicts: [] });
const gap = (missing: string) => ({ conditions: [{ index: 1, met: false, missing }], decisionConflicts: [] });
/** The research judge from QA3 N1: a draft with one alternative is insufficient; the table with B passes. */
const researchJudge = (always = false): Judge => (_task, files) => {
  const file = /### 파일: ([^\n]+)/.exec(files)?.[1] ?? '';
  return !always && files.includes('| B | 예약 흐름 |') ? met(file, '| B | 예약 흐름 |') : gap('대안 B와의 비교표가 없습니다. 대안 2개를 표로 비교해 주세요.');
};

async function fixture(options: { judge?: Judge; route?: (request: LlmRequest) => Record<string, unknown>; seed?: (ctx: { projectId: string; targetProductId: string }) => NewLedgerEvent[]; root?: string } = {}) {
  const ctx = { projectId: `revision-${++n}`, targetProductId: 'product' };
  const root = options.root ?? await mkdtemp(path.join(tmpdir(), 'ensemble-revision-'));
  const requests: LlmRequest[] = [];
  const judge = options.judge ?? researchJudge();
  const llm: LlmProvider = { async complete(request) {
    requests.push(request);
    const content = request.messages[0]!.content;
    const input = request.forceTool === REVIEW ? judge(/taskId: (\S+)/.exec(content)?.[1] ?? '', content.split('## 결과 파일')[1] ?? '', request)
      : request.forceTool === 'route_message' ? options.route?.(request) ?? { kind: 'chat' } : undefined;
    if (!input) throw new Error(`Unexpected call ${request.forceTool}`);
    return { text: '', model: 'fake', responseId: `r${requests.length}`, usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [{ name: request.forceTool!, input }] };
  } };
  const store = new MemoryLedgerStore();
  const make = () => {
    const connector = new CodexSessionConnector({ workspaceRoot: root, rpc: { command: process.execPath,
      args: [fileURLToPath(new URL('../../agents/test/fixtures/fake-app-server.mjs', import.meta.url))],
      env: { ...process.env, ENSEMBLE_FAKE_PROTOCOL: 'revision', ENSEMBLE_FAKE_DUPLICATE: '1' } } });
    const pm = new ProjectManager({ ...ctx, store, llm, connector, model: 'fake' });
    cleanup.push(async () => { await pm.stop(); });
    return pm;
  };
  cleanup.push(async () => { if (!options.root) await rm(root, { recursive: true, force: true }); });
  const owner = { kind: 'human' as const, id: 'owner' };
  await store.append([
    { ...ctx, actor: owner, type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: '사용자' } },
    { ...ctx, actor: owner, type: 'member_joined', payload: { memberId: 'designer', kind: 'human', displayName: '디자이너' } },
    { ...ctx, actor: owner, type: 'member_joined', payload: { memberId: 'research-agent', kind: 'agent', displayName: '조사 Agent' } },
    { ...ctx, actor: owner, type: 'goal_set', payload: { text: 'PT 예약 프로토타입', decider: 'owner', delegation: { pmMayApply: [] } } },
    { ...ctx, actor: owner, type: 'plan_committed', payload: { version: 1, basedOn: null, reason: 'approved', approvedBy: 'owner', sourceMessageIds: [], tasks: [
      { id: 'research', title: '예약 서비스 대안 조사', assignee: 'research-agent', dependsOn: [], handoffConditions: ['대안 2개가 표로 비교되어 있다'] },
      { id: 'flow', title: '흐름 설계', assignee: 'designer', dependsOn: ['research'], handoffConditions: ['가입부터 예약 확인까지 화면 목록'] },
      { id: 'test', title: '사용성 테스트', assignee: 'owner', dependsOn: ['flow'], handoffConditions: [] },
    ] } },
    ...(options.seed?.(ctx) ?? []),
  ]);
  const pm = make();
  const events = async () => await store.read({ projectId: ctx.projectId }) as AnyEvent[];
  const workspace = path.join(root, ctx.projectId, 'research-agent');
  const instructions = async () => (await readdir(workspace)).filter(name => name.startsWith('instructions-')).sort();
  const startResearch = () => pm['dispatcher'].startReady('kickoff');
  const settled = async (predicate: (events: AnyEvent[]) => boolean) => {
    await vi.waitFor(async () => { await pm.flush(); expect(predicate(await events())).toBe(true); }, { timeout: 8000 });
    return pm.flush();
  };
  return { ctx, pm, store, root, requests, events, workspace, instructions, startResearch, settled, make };
}
const status = async (f: { events: () => Promise<AnyEvent[]> }, taskId: string) => project(await f.events()).tasks.get(taskId)?.status;
const channel = (events: AnyEvent[]) => events.flatMap(e => e.type === 'reply_recorded' || e.type === 'pm_spoke' ? [e.payload.text] : []);

it('S1: an insufficient agent result goes back to the agent as a new turn, and the resubmission is checked', async () => {
  const f = await fixture();
  await f.startResearch();
  await f.settled(events => events.some(e => e.type === 'task_checked' && e.payload.taskId === 'research'));
  const events = await f.events();
  // QA3 N1: before, the ledger stopped at revision_requested with the agent's turn completed.
  const revision = events.find(e => e.type === 'revision_requested')!;
  const [firstResult] = events.flatMap(e => e.type === 'result_submitted' ? [e.payload.resultId] : []);
  expect(revision.payload).toMatchObject({ taskId: 'research', resultId: firstResult });
  const turns = events.flatMap(e => e.type === 'task_started' && e.payload.taskId === 'research' ? [e.payload.turnId] : []);
  expect(turns).toHaveLength(2);
  expect(events.find(e => e.type === 'update_sent')?.payload).toMatchObject({ updateId: `revision:${firstResult}`, turnId: turns[1] });
  expect(events.find(e => e.type === 'update_acknowledged')?.payload).toMatchObject({ updateId: `revision:${firstResult}` });
  // The follow-up turn carries only what is missing and which file to fix; the thread already has the task.
  const files = await f.instructions();
  expect(files).toHaveLength(2);
  const followUp = await readFile(path.join(f.workspace, files[1]!), 'utf8');
  expect(followUp).toContain(`변경 ID: revision:${firstResult}`);
  expect(followUp).toContain('- 보완할 점: 조건 1(대안 2개가 표로 비교되어 있다): 대안 B와의 비교표가 없습니다.');
  expect(followUp).toContain('- 수정할 파일: report-research.md');
  expect(followUp).not.toContain('# 작업 지시');
  expect(await readFile(path.join(f.workspace, 'report-research.md'), 'utf8')).toContain('| B | 예약 흐름 |');
  // The channel says the agent got it back, then the designer hears the next task can start.
  const text = channel(events);
  expect(text).toContainEqual('예약 서비스 대안 조사 결과에 보완이 필요해 조사 Agent에게 다시 맡겼습니다.\n- 조건 1(대안 2개가 표로 비교되어 있다): 대안 B와의 비교표가 없습니다.');
  expect(text.some(t => t.startsWith('@디자이너 흐름 설계를 곧 시작합니다.'))).toBe(true);
  // L2: the agent's review labels never reach people.
  expect(text.join('\n')).not.toMatch(/SOUND|PROPOSITION CHANGE|COMMITTED CHANGE|예약되었습니다/);
  expect(text).toContain('사용자 지시에 따른 요구 변경을 반영해 초안을 쓰겠습니다.');
  // Nothing goes out twice, even after a restart-style retry.
  await f.pm.deliverPendingChanges(); await f.pm.flush();
  expect((await f.events()).filter(e => e.type === 'task_started' && e.payload.taskId === 'research')).toHaveLength(2);
});

it('S1: past two revision requests the agent task stops for the decider with one line, never "보완 중" forever', async () => {
  const f = await fixture({ judge: researchJudge(true) });
  await f.startResearch();
  await f.settled(events => events.some(e => e.type === 'task_blocked'));
  const events = await f.events();
  expect(events.filter(e => e.type === 'task_started' && e.payload.taskId === 'research')).toHaveLength(3);
  expect(events.filter(e => e.type === 'revision_requested')).toHaveLength(3);
  expect(events.filter(e => e.type === 'update_sent')).toHaveLength(2);
  expect(events.find(e => e.type === 'task_blocked')?.payload).toMatchObject({ taskId: 'research', reason: '보완을 2회 요청했지만 인계 조건을 채우지 못했습니다', unblockBy: 'owner' });
  expect(await status(f, 'research')).toBe('blocked');
  const stop = channel(events).filter(t => t.startsWith('@사용자'));
  expect(stop).toEqual([`@사용자 조사 Agent의 "예약 서비스 대안 조사" 결과가 보완 2회 뒤에도 인계 조건을 채우지 못해 작업을 멈췄습니다. 지금 결과를 '이대로 확인'하거나 요청을 적어 '다시 맡기기'로 다시 맡겨 주세요. 남은 문제: 조건 1(대안 2개가 표로 비교되어 있다): 대안 B와의 비교표가 없습니다. 대안 2개를 표로 비교해 주세요.`]);
  await f.pm.deliverPendingChanges(); await f.pm.flush();
  expect((await f.events()).filter(e => e.type === 'task_started')).toHaveLength(3);
});

/** QA3 N1 as recorded: the agent's draft was judged insufficient and its turn had completed; nothing reached it. */
const n1Ledger = (ctx: { projectId: string; targetProductId: string }): NewLedgerEvent[] => {
  const report = Buffer.from('# 대안 조사 (research)\n초안: 대안 A만 정리했습니다.\n').toString('base64');
  const agent = { kind: 'agent' as const, id: 'research-agent' };
  const pmActor = { kind: 'pm' as const, id: 'pm' };
  const missing = ['인계 조건 "대안 2개가 표로 비교되어 있다"의 근거를 결과에서 확인하지 못했습니다. 이 조건을 다루는 내용을 report-research-md-0123456789ab에 분명히 적어 주세요.'];
  return [
    { ...ctx, actor: pmActor, type: 'task_start_reserved', idempotencyKey: 'start:research:v1', payload: { taskId: 'research', specVersion: 1, trigger: 'kickoff' } },
    { ...ctx, actor: agent, type: 'task_started', payload: { taskId: 'research', turnId: 'old-turn' } },
    { ...ctx, actor: agent, type: 'turn_observed', payload: { agentId: 'research-agent', taskId: 'research', turnId: 'old-turn', status: 'started' } },
    { ...ctx, actor: agent, type: 'attachment_recorded', payload: { attachmentId: 'report-research-md-0123456789ab', name: 'report-research.md', mimeType: 'text/markdown', uri: `data:text/markdown;base64,${report}`, taskId: 'research' } },
    { ...ctx, actor: agent, type: 'result_submitted', payload: { taskId: 'research', resultId: 'result:old-turn:0', planVersion: 1, summary: '조사 초안', artifactIds: ['report-research-md-0123456789ab'] } },
    { ...ctx, actor: agent, type: 'turn_observed', payload: { agentId: 'research-agent', taskId: 'research', turnId: 'old-turn', status: 'completed' } },
    { ...ctx, actor: pmActor, type: 'handoff_reviewed', payload: { taskId: 'research', resultId: 'result:old-turn:0', verdict: 'insufficient', met: [], missing, evidence: [] } },
    { ...ctx, actor: pmActor, type: 'revision_requested', payload: { taskId: 'research', resultId: 'result:old-turn:0', missing } },
  ];
};

it('S1: a revision request left undelivered by a restart (QA3 N1 ledger) reaches the agent through deliverPendingChanges', async () => {
  const f = await fixture({ seed: n1Ledger });
  expect(await status(f, 'research')).toBe('revising');
  await f.pm.deliverPendingChanges();
  await f.settled(events => events.some(e => e.type === 'task_checked' && e.payload.taskId === 'research'));
  const events = await f.events();
  expect(events.find(e => e.type === 'update_sent')?.payload).toMatchObject({ updateId: 'revision:result:old-turn:0' });
  // A new thread after the restart gets the full task instructions with the revision, the file named by its name.
  const [first] = await f.instructions();
  const text = await readFile(path.join(f.workspace, first!), 'utf8');
  expect(text).toContain('# 작업 지시: 예약 서비스 대안 조사');
  expect(text).toContain('이 조건을 다루는 내용을 "report-research.md"에 분명히 적어 주세요.');
  expect(text).toContain('- 수정할 파일: report-research.md');
  expect(text).not.toContain('0123456789ab');
});

it('S3: a person sending the agent report back for a check gets a fresh handoff review; only its verdict moves the task', async () => {
  let accept = false;
  const judge: Judge = (_task, files) => accept && files.includes('| B | 예약 흐름 |') ? met(/### 파일: ([^\n]+)/.exec(files)![1]!, '| B | 예약 흐름 |') : gap('대안 B와의 비교표가 없습니다.');
  const f = await fixture({ judge, route: () => ({ kind: 'recheck', taskId: 'research' }) });
  await f.startResearch();
  await f.settled(events => events.some(e => e.type === 'task_blocked'));
  const ask = '조사 보고서 다시 올려요. 이걸로 인계 조건 확인해 주세요';
  // An insufficient re-check is judged like any result: no task_checked and no spoken "충족".
  const again = await f.pm.postMessage('owner', ask, [{ name: 'report-research.md', mimeType: 'text/markdown', content: '# 대안 조사\n초안' }]);
  expect(again.map(p => p.text).join('\n')).not.toMatch(/충족합니다/);
  expect((await f.events()).some(e => e.type === 'task_checked')).toBe(false);
  expect(await status(f, 'research')).toBe('blocked');
  // QA3 N3: the person re-attaches the agent's report and asks the PM to check it.
  accept = true;
  const reviews = f.requests.filter(r => r.forceTool === REVIEW).length;
  const posts = await f.pm.postMessage('owner', ask, [{ name: 'report-research.md', mimeType: 'text/markdown', content: '# 대안 조사\n| 대안 | 특징 |\n|---|---|\n| A | 가입 흐름 |\n| B | 예약 흐름 |\n' }]);
  const events = await f.events();
  const message = events.findLast(e => e.type === 'message_recorded')!.payload as { messageId: string };
  expect(events.find(e => e.type === 'task_checked')?.payload).toMatchObject({ taskId: 'research', resultId: `result:${message.messageId}` });
  expect(f.requests.filter(r => r.forceTool === REVIEW).length - reviews).toBe(1);
  expect(posts.map(p => p.text)).toEqual([
    '@사용자 "예약 서비스 대안 조사" 결과를 다시 확인했어요 — 인계 조건을 충족합니다. 다음은 디자이너가 "흐름 설계"를 시작합니다.',
    '@디자이너 흐름 설계를 곧 시작합니다.',
  ]);
  // M12 W4: the decider's file on the only stopped task is its re-check without asking a model; the
  // coordinator never judged the message in conversation.
  expect(f.requests.some(r => r.forceTool === 'route_message')).toBe(false);
  expect(f.requests.some(r => r.forceTool?.endsWith('_coordination'))).toBe(false);
  expect(await status(f, 'flow')).toBe('reserved');
});

it('M1/L3: a successor result waits for its predecessor, then is judged; its submitter hears the outcome in one line', async () => {
  const judge: Judge = (task, files) => {
    const file = /### 파일: ([^\n]+)/.exec(files)?.[1] ?? '';
    if (task === 'research') return files.includes('| B | 예약 흐름 |') ? met(file, '| B | 예약 흐름 |') : gap('대안 B와의 비교표가 없습니다.');
    return files.includes('예약 확인') ? met(file, '가입 → 시간 선택 → 예약 확인') : gap('예약 확인 화면이 없습니다.');
  };
  const f = await fixture({ judge, seed: n1Ledger });
  // QA3 N4: the designer hands over the flow while research is still being revised.
  const waiting = await f.pm.postMessage('designer', '흐름 설계 올립니다', [{ name: 'flow.md', mimeType: 'text/markdown', content: '가입 → 시간 선택 → 예약 확인', taskId: 'flow' }]);
  expect(waiting.map(p => p.text)).toEqual(['@디자이너 "흐름 설계" 결과는 받아 두었어요 — 선행 작업 "예약 서비스 대안 조사"가 아직 보완 중이라 확인되면 이어서 검토합니다.']);
  let events = await f.events();
  expect(events.some(e => e.type === 'result_submitted' && e.payload.taskId === 'flow')).toBe(true);
  expect(events.some(e => (e.type === 'handoff_reviewed' || e.type === 'task_checked') && e.payload.taskId === 'flow')).toBe(false);
  expect(events.some(e => e.type === 'task_start_reserved' && e.payload.taskId === 'test')).toBe(false);
  expect(f.requests.filter(r => r.forceTool === REVIEW)).toHaveLength(0);
  // The research agent gets its revision and resubmits; then the waiting flow result is judged and the next task starts.
  await f.pm.deliverPendingChanges();
  await f.settled(all => all.some(e => e.type === 'task_checked' && e.payload.taskId === 'flow'));
  events = await f.events();
  expect(await status(f, 'test')).toBe('reserved');
  expect(channel(events)).toEqual(expect.arrayContaining([
    '@디자이너 "흐름 설계" 결과를 확인했어요. 다음은 사용자가 "사용성 테스트"를 시작합니다.',
    '@사용자 사용성 테스트를 곧 시작합니다.',
  ]));
});

it('L3: a person whose revised result is accepted hears it once, with what starts next', async () => {
  const judge: Judge = (_task, files) => files.includes('예약 확인') ? met(/### 파일: ([^\n]+)/.exec(files)![1]!, '예약 확인') : gap('예약 확인 화면이 없습니다.');
  const f = await fixture({ judge, seed: ctx => [
    { ...ctx, actor: { kind: 'agent', id: 'research-agent' }, type: 'result_submitted', payload: { taskId: 'research', resultId: 'r0', planVersion: 1, summary: '조사', artifactIds: [] } },
    { ...ctx, actor: { kind: 'pm', id: 'pm' }, type: 'task_checked', payload: { taskId: 'research', resultId: 'r0', reason: 'seed' } },
  ] });
  const first = await f.pm.postMessage('designer', '흐름 초안입니다', [{ name: 'flow.md', mimeType: 'text/markdown', content: '가입 → 시간 선택', taskId: 'flow' }]);
  expect(first.map(p => p.text)).toEqual(['@디자이너 흐름 설계 결과에 보완이 필요합니다.\n- 조건 1(가입부터 예약 확인까지 화면 목록): 예약 확인 화면이 없습니다.']);
  const second = await f.pm.postMessage('designer', '보완본입니다', [{ name: 'flow-v2.md', mimeType: 'text/markdown', content: '가입 → 시간 선택 → 예약 확인', taskId: 'flow' }]);
  expect(second.map(p => p.text)).toEqual([
    '@디자이너 "흐름 설계" 보완본을 확인했어요. 다음은 사용자가 "사용성 테스트"를 시작합니다.',
    '@사용자 사용성 테스트를 곧 시작합니다.',
  ]);
});
