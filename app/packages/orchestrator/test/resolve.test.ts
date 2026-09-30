import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { CodexSessionConnector } from '@ensemble/agents';
import { project, type AnyEvent, type NewLedgerEvent } from '@ensemble/core';
import type { LlmProvider, LlmRequest } from '@ensemble/llm';
import { MemoryLedgerStore } from '@ensemble/store';
import { ProjectManager, TaskResolutionError } from '../src/pm.ts';
import { revisionCount } from '../src/context.ts';

// M11 T1/T3/U2/U3: a stopped task can be accepted, handed back or re-checked; a checked result can be
// reopened by a person's request; people's tasks stop at the revision cap too; acceptance is announced.
let n = 0;
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

const REVIEW = 'record_handoff_review';
type Judge = (taskId: string, files: string, request: LlmRequest) => Record<string, unknown> | Error;
const met = (file: string, quote: string) => ({ conditions: [{ index: 1, met: true, file, quote }], decisionConflicts: [] });
const gap = (missing: string) => ({ conditions: [{ index: 1, met: false, missing }], decisionConflicts: [] });
const fileOf = (files: string) => /### 파일: ([^\n]+)/.exec(files)?.[1] ?? '';
type Coordinated = { posts: { text: string; kind: 'fact' }[]; events: []; resolutions?: { taskId: string; action: 'accept' | 'retry' | 'recheck'; note?: string }[]; reopens?: { taskId: string; reason: string }[] };

async function fixture(options: { judge: Judge; seed?: (ctx: { projectId: string; targetProductId: string }) => NewLedgerEvent[] }) {
  const ctx = { projectId: `resolve-${++n}`, targetProductId: 'product' };
  const root = await mkdtemp(path.join(tmpdir(), 'ensemble-resolve-'));
  const requests: LlmRequest[] = [];
  const llm: LlmProvider = { async complete(request) {
    requests.push(request);
    const content = request.messages[0]!.content;
    const input = request.forceTool === REVIEW ? options.judge(/taskId: (\S+)/.exec(content)?.[1] ?? '', content.split('## 결과 파일')[1] ?? '', request)
      : request.forceTool === 'route_message' ? { kind: 'chat' } : undefined;
    if (!input) throw new Error(`Unexpected call ${request.forceTool}`);
    if (input instanceof Error) throw input;
    return { text: '', model: 'fake', responseId: `r${requests.length}`, usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [{ name: request.forceTool!, input }] };
  } };
  const store = new MemoryLedgerStore();
  const connector = new CodexSessionConnector({ workspaceRoot: root, rpc: { command: process.execPath,
    args: [fileURLToPath(new URL('../../agents/test/fixtures/fake-app-server.mjs', import.meta.url))],
    env: { ...process.env, ENSEMBLE_FAKE_PROTOCOL: 'revision' } } });
  const pm = new ProjectManager({ ...ctx, store, llm, connector, model: 'fake' });
  cleanup.push(async () => { await pm.stop(); await rm(root, { recursive: true, force: true }); });
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
  const events = async () => await store.read({ projectId: ctx.projectId }) as AnyEvent[];
  const workspace = path.join(root, ctx.projectId, 'research-agent');
  const instructions = async () => (await readdir(workspace)).filter(name => name.startsWith('instructions-')).sort((a, b) => Number(/(\d+)/.exec(a)![1]) - Number(/(\d+)/.exec(b)![1]));
  const settled = async (predicate: (events: AnyEvent[]) => boolean) => {
    await vi.waitFor(async () => { await pm.flush(); expect(predicate(await events())).toBe(true); }, { timeout: 8000 });
    return pm.flush();
  };
  /** What the coordinator (W-B) returns for the next message: its interpretation is not under test here. */
  const coordinate = (result: Omit<Coordinated, 'posts' | 'events'>) => vi.spyOn(pm['coordinator'], 'onMessage').mockResolvedValueOnce({ posts: [], events: [], ...result } as never);
  return { ctx, pm, store, requests, events, workspace, instructions, settled, coordinate };
}
const status = async (f: { events: () => Promise<AnyEvent[]> }, taskId: string) => project(await f.events()).tasks.get(taskId)?.status;
const channel = (events: AnyEvent[]) => events.flatMap(e => e.type === 'reply_recorded' || e.type === 'pm_spoke' ? [e.payload.text] : []);
const reviews = (requests: LlmRequest[]) => requests.filter(r => r.forceTool === REVIEW).length;
const researchChecked = (ctx: { projectId: string; targetProductId: string }): NewLedgerEvent[] => [
  { ...ctx, actor: { kind: 'agent', id: 'research-agent' }, type: 'result_submitted', payload: { taskId: 'research', resultId: 'r0', planVersion: 1, summary: '조사', artifactIds: [] } },
  { ...ctx, actor: { kind: 'pm', id: 'pm' }, type: 'task_checked', payload: { taskId: 'research', resultId: 'r0', reason: 'seed' } },
];

async function blockedResearch(judge: Judge) {
  const f = await fixture({ judge });
  await f.pm['dispatcher'].startReady('kickoff');
  await f.settled(events => events.some(e => e.type === 'task_blocked'));
  expect(await status(f, 'research')).toBe('blocked');
  return f;
}

it('Z1 ①: "결제 화면 조건은 이제 필요 없어요. 이대로 확인해 주세요" accepts the stopped result and the next task starts', async () => {
  const f = await blockedResearch((_t, files) => gap('대안 B와의 비교표가 없습니다.'));
  const judged = reviews(f.requests);
  f.coordinate({ resolutions: [{ taskId: 'research', action: 'accept' }] });
  const posts = await f.pm.postMessage('owner', '결제 화면 조건은 이제 필요 없어요. 이대로 확인해 주세요');
  const events = await f.events();
  // QA4 Z1: the same stop notice again, nothing moved. Now the decider's acceptance checks the result.
  expect(await status(f, 'research')).toBe('checked');
  expect(events.findLast(e => e.type === 'task_checked')).toMatchObject({ actor: { kind: 'human', id: 'owner' }, payload: { taskId: 'research', reason: expect.stringContaining('사용자') } });
  expect(await status(f, 'flow')).toBe('reserved');
  expect(posts.map(p => p.text)).toEqual([
    '"예약 서비스 대안 조사" 결과를 사용자의 결정으로 지금 상태 그대로 확인했어요. 다음은 디자이너가 "흐름 설계"를 시작합니다.',
    '@디자이너 흐름 설계를 곧 시작합니다.',
  ]);
  // No new review and no message routing ran on the decision: it is not a re-check.
  expect(reviews(f.requests)).toBe(judged);
  expect(f.requests.some(r => r.forceTool === 'route_message')).toBe(false);
});

it('Z1 ②: "@조사 Agent 다시 맡길게요 …" hands the task back with the note in a new turn, with a fresh revision count', async () => {
  let pass = false;
  const f = await blockedResearch((_t, files) => pass && files.includes('| B | 예약 흐름 |') ? met(fileOf(files), '| B | 예약 흐름 |') : gap('대안 B와의 비교표가 없습니다.'));
  expect(revisionCount(await f.events(), 'research')).toBe(3);
  pass = true;
  const note = '결제 없이 대안 B까지 표로 다시 만들어 주세요';
  f.coordinate({ resolutions: [{ taskId: 'research', action: 'retry', note }] });
  const posts = await f.pm.postMessage('owner', `@조사 Agent 다시 맡길게요. ${note}`);
  expect(posts.map(p => p.text)).toEqual(['"예약 서비스 대안 조사"를 조사 Agent에게 다시 맡겼어요. 보완 횟수는 새로 셉니다.']);
  await f.settled(events => events.some(e => e.type === 'task_checked' && e.payload.taskId === 'research'));
  const events = await f.events();
  expect(events.filter(e => e.type === 'task_started' && e.payload.taskId === 'research')).toHaveLength(4);
  const files = await f.instructions();
  const followUp = await readFile(path.join(f.workspace, files.at(-1)!), 'utf8');
  expect(followUp).toContain(`사용자 요청: ${note}`);
  expect(followUp).toContain('- 수정할 파일: report-research.md');
  expect(await status(f, 'flow')).toBe('reserved');
});

it('Z1: a retry that still falls short gets PM revisions again before it stops (the count restarted)', async () => {
  const f = await blockedResearch(() => gap('대안 B와의 비교표가 없습니다.'));
  await f.pm.resolveTask('research', { action: 'retry', by: 'owner', note: '표를 다시 만들어 주세요' });
  await f.settled(events => events.filter(e => e.type === 'task_blocked').length === 2);
  const events = await f.events();
  // 3 turns up to the first stop, then the retry turn plus two PM revision turns.
  expect(events.filter(e => e.type === 'task_started' && e.payload.taskId === 'research')).toHaveLength(6);
});

it('C1: a person result stuck in "submitted" after a technical review failure is re-checked and checked', async () => {
  let broken = true;
  const f = await fixture({ seed: researchChecked, judge: (_t, files) => broken ? new Error('proxy 502') : met(fileOf(files), '가입 → 시간 선택 → 예약 확인') });
  const failed = await f.pm.postMessage('designer', '흐름 설계 올립니다', [{ name: 'flow.md', mimeType: 'text/markdown', content: '가입 → 시간 선택 → 예약 확인', taskId: 'flow' }]);
  expect(failed.map(p => p.text).join('\n')).toContain('결과 인계 판단을 마치지 못했습니다');
  expect(failed.map(p => p.text).join('\n')).toContain('다시 검토');
  expect(await status(f, 'flow')).toBe('submitted');
  // The web recognizes the technical failure by this recorded reason.
  expect((await f.events()).some(e => e.type === 'pm_considered' && e.payload.reason === '결과 내용이 아니라 판단 과정의 문제라 사람이 결과를 확인해야 한다')).toBe(true);
  broken = false;
  const posts = await f.pm.resolveTask('flow', { action: 'recheck', by: 'owner' });
  expect(await status(f, 'flow')).toBe('checked');
  expect(await status(f, 'test')).toBe('reserved');
  expect(posts.map(p => p.text)).toEqual(expect.arrayContaining(['@디자이너 "흐름 설계" 결과를 확인했어요. 다음은 사용자가 "사용성 테스트"를 시작합니다.']));
});

it('C1/C4: the decider re-attaching a stuck person result is a re-check on their behalf, never an English error', async () => {
  let broken = true;
  const f = await fixture({ seed: researchChecked, judge: (_t, files) => broken ? new Error('proxy 502') : met(fileOf(files), '가입 → 시간 선택 → 예약 확인') });
  await f.pm.postMessage('designer', '흐름 설계 올립니다', [{ name: 'flow.md', mimeType: 'text/markdown', content: '가입 → 시간 선택 → 예약 확인', taskId: 'flow' }]);
  broken = false;
  const posts = await f.pm.postMessage('owner', '같은 파일 다시 올려요', [{ name: 'flow.md', mimeType: 'text/markdown', content: '가입 → 시간 선택 → 예약 확인', taskId: 'flow' }]);
  expect(await status(f, 'flow')).toBe('checked');
  expect(posts.map(p => p.text)[0]).toBe('@사용자 "흐름 설계" 결과를 다시 확인했어요 — 인계 조건을 충족합니다. 다음은 사용자가 "사용성 테스트"를 시작합니다.');
});

it('T1: only the decider accepts, and a task with nothing stopped gets a Korean answer', async () => {
  const f = await blockedResearch(() => gap('대안 B와의 비교표가 없습니다.'));
  const denied = f.pm.resolveTask('research', { action: 'accept', by: 'designer' });
  await expect(denied).rejects.toBeInstanceOf(TaskResolutionError);
  await expect(f.pm.resolveTask('research', { action: 'accept', by: 'designer' })).rejects.toThrow('"이대로 확인"은 결정권자(사용자)만 할 수 있어요.');
  await expect(f.pm.resolveTask('test', { action: 'retry', by: 'owner' })).rejects.toThrow('"사용성 테스트" 작업은 지금 시작 전이라 처리할 멈춤이 없어요.');
  await expect(f.pm.resolveTask('nope', { action: 'recheck', by: 'owner' })).rejects.toThrow('작업을 찾지 못했습니다.');
  expect(await status(f, 'research')).toBe('blocked');
});

it('U2: a person task stops at the revision cap too, with a resolve hint; a hand-back starts the count over', async () => {
  const f = await fixture({ seed: researchChecked, judge: () => gap('예약 확인 화면이 없습니다.') });
  const submit = (i: number) => f.pm.postMessage('designer', `흐름 ${i}`, [{ name: `flow-${i}.md`, mimeType: 'text/markdown', content: '가입 → 시간 선택', taskId: 'flow' }]);
  await submit(1); await submit(2);
  expect(await status(f, 'flow')).toBe('revising');
  const third = await submit(3);
  expect(await status(f, 'flow')).toBe('blocked');
  expect(third.map(p => p.text)).toEqual(['@사용자 디자이너의 "흐름 설계" 결과가 보완 2회 뒤에도 인계 조건을 채우지 못해 작업을 멈췄습니다. 지금 결과를 \'이대로 확인\'하거나 요청을 적어 \'다시 맡기기\'로 다시 맡겨 주세요. 남은 문제: 조건 1(가입부터 예약 확인까지 화면 목록): 예약 확인 화면이 없습니다.']);
  const handed = await f.pm.resolveTask('flow', { action: 'retry', by: 'owner', note: '예약 확인 화면만 추가해 주세요' });
  expect(handed.map(p => p.text)).toEqual(['@디자이너 사용자가 "흐름 설계"를 다시 맡겼어요: 예약 확인 화면만 추가해 주세요. 보완본을 이 작업에 첨부해 올려 주세요.']);
  expect(await status(f, 'flow')).toBe('revising');
  // The count-reset marker and the spoken line are two separate PM records.
  const records = (await f.events()).flatMap(e => e.type === 'pm_considered' && e.payload.considerationId.startsWith('resolve:retry:flow:') ? [e.payload.decision] : []);
  expect(records.sort()).toEqual(['silent', 'speak']);
  const fourth = await submit(4);
  expect(fourth.map(p => p.text)[0]).toMatch(/^@디자이너 흐름 설계 결과에 보완이 필요합니다\./);
  expect(await status(f, 'flow')).toBe('revising');
});

it('T3/U3: a person reopens a checked agent result; the agent revises it in a new turn and everyone hears the outcome', async () => {
  let reopened = false;
  const f = await fixture({ judge: (task, files, request) => {
    if (task === 'research' && !reopened) return met(fileOf(files), '대안 A만 정리했습니다');
    // After the reopen the person's request is judged as condition 2.
    if (task === 'research') return files.includes('| B | 예약 흐름 |') && request.messages[0]!.content.includes('\n2. 사용자 요청: ')
      ? { conditions: [{ index: 1, met: true, file: fileOf(files), quote: '| B | 예약 흐름 |' }, { index: 2, met: true, file: fileOf(files), quote: '| B | 예약 흐름 |' }], decisionConflicts: [] }
      : gap('대안 B가 없습니다.');
    return met(fileOf(files), '가입 → 시간 선택 → 예약 확인');
  } });
  // The fake agent's first draft passes; only the reopened revision adds the B row.
  await f.pm['dispatcher'].startReady('kickoff');
  await f.settled(events => events.some(e => e.type === 'task_checked' && e.payload.taskId === 'research'));
  // U3: a person's first result that passes is announced with what starts next.
  const flow = await f.pm.postMessage('designer', '흐름 설계 올립니다', [{ name: 'flow.md', mimeType: 'text/markdown', content: '가입 → 시간 선택 → 예약 확인', taskId: 'flow' }]);
  expect(flow.map(p => p.text)).toEqual([
    '@디자이너 "흐름 설계" 결과를 확인했어요. 다음은 사용자가 "사용성 테스트"를 시작합니다.',
    '@사용자 사용성 테스트를 곧 시작합니다.',
  ]);
  const turnsBefore = (await f.events()).filter(e => e.type === 'task_started' && e.payload.taskId === 'research').length;
  reopened = true;
  const reason = '예약 확인 화면 비교에 대안 B가 없어요. 추가해서 다시 올려 주세요';
  f.coordinate({ reopens: [{ taskId: 'research', reason }] });
  const posts = await f.pm.postMessage('owner', `@조사 Agent ${reason}`);
  expect(posts.map(p => p.text)).toEqual(['확인된 "예약 서비스 대안 조사" 결과를 다시 열어 조사 Agent에게 보완을 맡겼어요. 진행 중인 후행 작업 "사용성 테스트"는 그대로 둡니다.']);
  await f.settled(events => events.filter(e => e.type === 'task_checked' && e.payload.taskId === 'research').length === 2);
  const events = await f.events();
  expect(events.filter(e => e.type === 'task_started' && e.payload.taskId === 'research')).toHaveLength(turnsBefore + 1);
  const followUp = await readFile(path.join(f.workspace, (await f.instructions()).at(-1)!), 'utf8');
  expect(followUp).toContain(`사용자 요청: ${reason}`);
  expect(followUp).toContain('확인된 결과에 사용자가 보완을 요청했습니다');
  expect(channel(events)).toContain('@사용자 요청하신 "예약 서비스 대안 조사" 보완본을 확인했어요.');
  const reReview = f.requests.filter(r => r.forceTool === REVIEW).at(-1)!.messages[0]!.content;
  expect(reReview).toContain(`## 인계 조건
1. 대안 2개가 표로 비교되어 있다
2. 사용자 요청: ${reason}`);
  expect(await status(f, 'test')).toBe('reserved');
  // U3: the last task checked closes the project in one line.
  const done = await f.pm.postMessage('owner', '테스트 결과입니다', [{ name: 'test.md', mimeType: 'text/markdown', content: '5명 테스트 완료', taskId: 'test' }]);
  expect(done.map(p => p.text)).toContain('프로젝트 작업이 모두 확인됐어요.');
});

it('T3: only the decider or a downstream assignee reopens a checked result; the PM says so in Korean', async () => {
  const f = await fixture({ seed: researchChecked, judge: () => gap('x') });
  f.coordinate({ reopens: [{ taskId: 'flow', reason: '다시' }] });
  const posts = await f.pm.postMessage('designer', '흐름 다시 볼게요');
  expect(posts.map(p => p.text)).toEqual(['"흐름 설계" 작업은 아직 확인 전(시작 전)이라 다시 열 결과가 없어요.']);
});
