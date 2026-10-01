import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { MemoryLedgerStore } from '@ensemble/store';
import type { LlmProvider } from '@ensemble/llm';
import { project, type AnyEvent } from '@ensemble/core';
import { FREE_FAKE_AGENT_DELAY_MS, WebRuntime } from '../../../apps/web/lib/runtime.ts';
import { FakePmLlm } from '../../../apps/web/lib/fake-connector.ts';
import type { ViewModel, VmTaskDetail } from '../../../apps/web/lib/view-model.ts';
import { GET, POST } from '../../../apps/web/app/api/[...path]/route.ts';
import { continuousScenario, conditionMet, resolveTarget, sceneEvents } from '../src/index.ts';
import { setup } from './continuous-fixture.ts';

const globalRuntime = globalThis as typeof globalThis & { ensembleRuntime?: WebRuntime };
const post = (route: string, body: unknown = {}) => POST(new Request(`http://localhost/api/${route}`, { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ path: route.split('/') }) });
async function eventually(check: () => Promise<boolean>) {
  for (let i = 0; i < 300; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 10)); }
  throw new Error('observable state did not arrive');
}
it('T1 API accepts a blocked result only for the decider and removes recovery controls after checking it', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ensemble-resolve-web-'));
  const app = new WebRuntime({ dataDir: dir, store: new MemoryLedgerStore() });
  globalRuntime.ensembleRuntime = app;
  try {
    await app.state();
    const ctx = { projectId: app.meta.projectId, targetProductId: 'test', actor: { kind: 'human' as const, id: 'owner' } };
    await app.store.append([
      { ...ctx, type: 'plan_committed', payload: { version: 1, basedOn: null, tasks: [{ id: 'flow', title: '흐름 설계', assignee: 'designer', dependsOn: [], handoffConditions: ['예약 확인'] }], approvedBy: 'owner', reason: '확인', sourceMessageIds: [] } },
      { ...ctx, type: 'result_submitted', payload: { taskId: 'flow', resultId: 'r1', planVersion: 1, summary: '초안', artifactIds: [] } },
      { ...ctx, type: 'task_blocked', payload: { taskId: 'flow', reason: '보완을 2회 요청했지만 인계 조건을 채우지 못했습니다', unblockBy: 'owner' } },
    ]);
    expect((await app.state('owner')).activity.stalled?.tasks?.[0]?.actions).toEqual(['accept', 'retry']);
    expect((await app.state('designer')).activity.stalled?.tasks?.[0]?.actions).toEqual(['retry']);
    expect((await post('tasks/flow/resolve', { me: 'designer', action: 'accept' })).status).toBe(409);
    expect((await post('tasks/flow/resolve', { me: 'owner', action: 'recheck' })).status).toBe(409);
    expect((await post('tasks/flow/resolve', { me: 'owner', action: 'accept', note: '이대로 확인해 주세요' })).status).toBe(202);
    await eventually(async () => (await app.state()).roadmap.tasks[0]?.status === 'checked');
    expect((await app.state()).activity.stalled).toBeUndefined();
    expect((await app.state()).roadmap.tasks[0]?.resolution).toBeUndefined();
    expect((await post('tasks/flow/resolve', { me: 'owner', action: 'accept' })).status).toBe(409);
  } finally { await app.stop(); delete globalRuntime.ensembleRuntime; await rm(dir, { recursive: true, force: true }); }
});
it.each([false, true])('plays all three scenes through actual API handlers (default connector: %s), preserving history', async defaultConnector => {
  const f = await setup(false);
  await f.pm.stop();
  const dir = await mkdtemp(path.join(tmpdir(), 'ensemble-web-'));
  const app = new WebRuntime({ dataDir: dir, store: new MemoryLedgerStore(), llm: f.llm, ...(defaultConnector ? {} : { connector: f.connector }), generateRevision: f.host.generateRevision });
  globalRuntime.ensembleRuntime = app;
  try {
    await app.state();
    expect((await post('scenario/start', { name: continuousScenario.key })).status).toBe(200);
    const originalId = app.meta.projectId;
    const lines: (string | undefined)[] = [];
    for (let i = 0; i < continuousScenario.steps.length; i = app.meta.script!.step) {
      if (i === 4) {
        const events = await app.store.read({ projectId: originalId });
        const state = project(events);
        expect(['ready', 'reserved']).toContain([...state.tasks.values()].find(t => t.spec.assignee === 'owner')?.status);
        expect(conditionMet(continuousScenario.steps[i]!.waitFor!, events, app.meta.script!.anchors)).toBe(true);
        expect(resolveTarget(state, { assignee: 'owner' })).toBe('interview');
      }
      // Every line offered as "다음 발언" is the one the button then posts.
      const offered = (await app.state()).scenario?.nextLine?.text;
      lines.push(offered);
      const before = (await app.store.read({ projectId: originalId })).length;
      expect((await post('scenario/next')).status).toBe(202);
      await eventually(async () => (app.meta.script!.step > i && !(await app.state()).busy) || !!app.meta.script!.stopped);
      expect(app.meta.script!.stopped).toBeUndefined();
      await app.pm.flush();
      const step = continuousScenario.steps[i]!;
      if (!['availability', 'respondToRevision'].includes(step.action ?? '')) {
        expect((await app.store.read({ projectId: originalId }) as AnyEvent[]).slice(before).some(e => e.type === 'message_recorded' && e.payload.text === offered)).toBe(true);
      }
    }
    // The PM applied the exclusion itself, so the clarification line it never asked for is not offered (it would never post).
    expect(lines).not.toContain(continuousScenario.steps.at(-1)!.text);
    const state = await app.state();
    expect(state.scenario?.done).toBe(true);
    // Nothing people read carries a serialized structure, and result files are named after their work.
    const recorded = await app.store.read({ projectId: originalId }) as AnyEvent[];
    for (const e of recorded) {
      if (e.type === 'result_submitted' || e.type === 'reply_recorded' || e.type === 'pm_spoke' || e.type === 'agent_report_recorded') expect(e.type === 'result_submitted' ? e.payload.summary : e.payload.text).not.toMatch(/\{"|"\w+":/);
      if (e.type === 'attachment_recorded') expect(e.payload.name).not.toMatch(/-v\d+-\d+\./);
    }
    for (const message of state.messages) expect(message.text).not.toMatch(/\{"|"\w+":/);
    expect(state.project.title.length).toBeLessThanOrEqual(40);
    expect(state.project.title).not.toContain('시연용');
    expect(state.project.synthetic).toBe(true);
    expect(state.roadmap.planVersion).toBe(2);
    if (defaultConnector) {
      await eventually(async () => (await app.state()).roadmap.tasks.find(t => t.id === 'prototype')?.status === 'checked');
      expect((await app.store.read() as AnyEvent[]).some(e => e.type === 'task_checked' && e.payload.taskId === 'prototype')).toBe(true);
    }
    // A channel must not mix PM's fixed 09:00 demo clock with human wall time.
    for (const message of state.messages) expect(Math.abs(Date.parse(message.at) - Date.now())).toBeLessThan(60_000);
    for (const step of continuousScenario.steps.filter(s => ['goal', 'availability', 'approvePlan'].includes(s.action ?? ''))) expect(state.messages.some(m => m.text === step.text)).toBe(true);
    const before = await app.store.read({ projectId: originalId });
    const conflict = await post('scenario/start', { name: continuousScenario.key });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: 'project_exists' } });
    expect(app.meta.projectId).toBe(originalId);
    expect((await post('scenario/start', { name: continuousScenario.key, confirmReplace: true })).status).toBe(200);
    expect(app.meta.archivedProjectIds).toContain(originalId);
    expect(await app.store.read({ projectId: originalId })).toEqual(before);
    const archives = await GET(new Request('http://localhost/api/archives'), { params: Promise.resolve({ path: ['archives'] }) });
    expect(await archives.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: originalId, archivedAt: expect.any(String) })]));
    const currentId = app.meta.projectId;
    const archive = await GET(new Request('http://localhost/api/archives/old'), { params: Promise.resolve({ path: ['archives', originalId] }) });
    expect(await archive.json()).toMatchObject({ project: { id: originalId }, readOnly: true, cards: [] });
    expect(app.meta.projectId).toBe(currentId);
    expect(await app.store.read({ projectId: originalId })).toEqual(before);
    expect((await GET(new Request('http://localhost/api/archives/missing'), { params: Promise.resolve({ path: ['archives', 'missing'] }) })).status).toBe(404);
    expect((await app.state()).messages).toEqual([]);
    await post('scenario/next');
    await eventually(async () => app.meta.script!.step === 1 && !(await app.state()).busy);
    expect((await app.state()).messages.filter(m => m.authorId === 'owner')).toHaveLength(1);
    if (defaultConnector) {
      // Reusing task IDs after archiving must not lose reservations to the previous project's keys.
      for (let step = 1; step < continuousScenario.steps.length; step = app.meta.script!.step) {
        expect((await post('scenario/next')).status).toBe(202);
        await eventually(async () => (app.meta.script!.step > step && !(await app.state()).busy) || !!app.meta.script!.stopped);
        expect(app.meta.script!.stopped).toBeUndefined();
        await app.pm.flush();
      }
      expect((await app.state()).scenario?.done).toBe(true);
      expect((await app.store.read({ projectId: currentId })).filter(e => e.type === 'task_start_reserved').length).toBeGreaterThan(0);
      expect(await app.store.read({ projectId: originalId })).toEqual(before);
    }
  } finally { await app.pm.stop(); app.store.close(); delete globalRuntime.ensembleRuntime; await rm(dir, { recursive: true, force: true }); await rm(f.workspace, { recursive: true, force: true }); }
}, 20000);

it('accepts two inputs while PM is blocked and processes them once in receipt order', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ensemble-messages-'));
  let release!: () => void;
  const blocked = new Promise<void>(r => { release = r; });
  const seen: string[] = [];
  const llm: LlmProvider = { async complete(request) {
    const { facts } = JSON.parse(request.messages[0]!.content);
    if (request.forceTool === 'interpret_coordination') { await blocked; seen.push(facts.messageId); }
    const input = request.forceTool === 'interpret_coordination'
      ? { category: 'chat', summary: '일반 대화', ops: [], conflicts: [], conversation: { questionMessageId: null, waitingOnMemberIds: [], directedToPm: false }, factMentions: [] }
      : { whoseAction: null, alreadyKnows: 'yes', evidence: [], decision: 'silent', reason: '다음 행동이 바뀌지 않음', openTopics: [], text: '', targetMemberIds: [], changesOpenQuestionAnswer: false, answerFactIds: [] };
    return { text: '', model: 'fake', responseId: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [{ name: request.forceTool!, input }] };
  } };
  const app = new WebRuntime({ dataDir: dir, store: new MemoryLedgerStore(), llm });
  globalRuntime.ensembleRuntime = app;
  try {
    await app.state();
    // Message coordination is exercised within a project; an empty project now prompts for a goal (R10).
    await app.store.append(sceneEvents(1, { projectId: app.meta.projectId, targetProductId: 'test' }));
    const [first, second] = await Promise.all([post('messages', { authorId: 'owner', text: '첫 입력' }), post('messages', { authorId: 'designer', text: '다음 입력' })]);
    expect([first.status, second.status]).toEqual([202, 202]);
    const ids = [(await first.json() as { messageId: string }).messageId, (await second.json() as { messageId: string }).messageId];
    expect(seen).toEqual([]);
    expect((await app.store.read() as AnyEvent[]).filter(e => e.type === 'message_recorded').map(e => e.payload.messageId)).toEqual(ids);
    release(); await app.pm.flush();
    expect(seen).toEqual(ids);
    await app.pm.processRecordedMessage(ids[0]!);
    expect(seen).toEqual(ids);
    expect((await app.store.read() as AnyEvent[]).filter(e => e.type === 'pm_considered').map(e => e.payload.triggerId)).toEqual(ids);
    expect((await app.state()).messages.filter(m => m.kind === 'human').map(m => m.text)).toEqual(['첫 입력', '다음 입력']);
  } finally { release(); await app.pm.stop(); app.store.close(); delete globalRuntime.ensembleRuntime; await rm(dir, { recursive: true, force: true }); }
});

it('exposes a quiet condition stall at 60 seconds and supports retry then skip without inventing a result', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ensemble-stall-'));
  const app = new WebRuntime({ dataDir: dir, store: new MemoryLedgerStore() });
  globalRuntime.ensembleRuntime = app;
  let clock: ReturnType<typeof vi.spyOn> | undefined;
  try {
    await app.state();
    await post('scenario/start', { name: continuousScenario.key });
    app.meta.script!.step = 4;
    const start = Date.now();
    clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    await post('scenario/next');
    await eventually(async () => (await app.state()).activity.kind === 'scenario_waiting');
    clock.mockReturnValue(start + 59_999);
    expect((await app.state()).activity.stalled).toBeUndefined();
    clock.mockReturnValue(start + 60_001);
    expect((await app.state()).activity.stalled).toMatchObject({ canRetry: true, canSkip: true });
    expect((await post('scenario/retry')).status).toBe(200);
    await eventually(async () => (await app.state()).activity.kind === 'scenario_waiting');
    expect((await app.state()).activity.stalled).toBeUndefined();
    clock.mockReturnValue(start + 120_002);
    const skips = await Promise.all([post('scenario/skip'), post('scenario/skip')]);
    expect(skips.map(r => r.status).sort()).toEqual([200, 409]);
    expect(app.meta.script!.step).toBe(5);
    expect(app.meta.script!.stopped).toBeUndefined();
    expect((await app.store.read()).some(e => e.type === 'result_submitted')).toBe(false);
  } finally { clock?.mockRestore(); await app.pm.stop(); app.store.close(); delete globalRuntime.ensembleRuntime; await rm(dir, { recursive: true, force: true }); }
});

it('serves text inline, HTML as download, and structured Korean errors', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ensemble-download-'));
  const app = new WebRuntime({ dataDir: dir, store: new MemoryLedgerStore() });
  globalRuntime.ensembleRuntime = app;
  try {
    await app.state();
    for (const name of ['notes.txt', 'notes.md', 'unsafe.html']) {
      await app.store.append([{ projectId: app.meta.projectId, targetProductId: 'test', actor: { kind: 'human', id: 'owner' }, type: 'attachment_recorded', payload: { attachmentId: name.replace('.', '-'), name, mimeType: 'text/html', uri: `data:text/html;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}` } }]);
      const response = await GET(new Request('http://localhost'), { params: Promise.resolve({ path: ['attachments', name.replace('.', '-')] }) });
      expect(response.headers.get('Content-Type')).toBe(name.endsWith('html') ? 'application/octet-stream' : 'text/plain; charset=utf-8');
      expect(response.headers.get('Content-Disposition')).toMatch(name.endsWith('html') ? /^attachment;/ : /^inline;/);
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    }
    const bad = await post('messages', { authorId: 'owner', text: '' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: { code: 'invalid_input', message: '메시지나 첨부를 입력해 주세요.' } });
  } finally { await app.pm.stop(); app.store.close(); delete globalRuntime.ensembleRuntime; await rm(dir, { recursive: true, force: true }); }
});

it('detects an unresponsive running agent at two minutes without resetting elapsed time on human messages', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ensemble-agent-stall-'));
  const app = new WebRuntime({ dataDir: dir, store: new MemoryLedgerStore() });
  let clock: ReturnType<typeof vi.spyOn> | undefined;
  try {
    await app.state();
    const ctx = { projectId: app.meta.projectId, targetProductId: 'test', actor: { kind: 'agent' as const, id: 'prototype-agent' } };
    await app.store.append(sceneEvents(3, ctx));
    const start = Date.now();
    await app.store.append([
      { ...ctx, at: new Date(start).toISOString(), type: 'task_start_reserved', payload: { taskId: 'prototype', specVersion: 1, trigger: 'test' } },
      { ...ctx, at: new Date(start).toISOString(), type: 'task_started', payload: { taskId: 'prototype', turnId: 'quiet' } },
    ]);
    clock = vi.spyOn(Date, 'now').mockReturnValue(start + 119999);
    const first = await app.state();
    expect(first.activity.kind).toBe('agent_working'); expect(first.activity.stalled).toBeUndefined();
    await app.store.append([{ ...ctx, actor: { kind: 'human', id: 'owner' }, at: new Date(start + 119999).toISOString(), type: 'message_recorded', payload: { messageId: 'unrelated', authorId: 'owner', text: '상태 확인', attachmentIds: [] } }]);
    clock.mockReturnValue(start + 120000);
    const stalled = await app.state();
    expect(stalled.activity.since).toBe(first.activity.since);
    expect(stalled.activity.stalled?.reason).toContain('2분');
    expect(stalled.activity.stalled?.reason).toContain('프로토타입');
    await app.store.append([{ ...ctx, at: new Date(start + 120000).toISOString(), type: 'reply_recorded', payload: { memberId: 'prototype-agent', taskId: 'prototype', turnId: 'quiet', text: '화면 작성 중' } }]);
    expect((await app.state()).activity.stalled).toBeUndefined();
    expect((await app.state()).activity.since).toBe(first.activity.since);
  } finally { clock?.mockRestore(); await app.stop(); await rm(dir, { recursive: true, force: true }); }
});

it('shows the persisted revision limit with its task title and a next action', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ensemble-stop-reason-'));
  const app = new WebRuntime({ dataDir: dir, store: new MemoryLedgerStore() });
  try {
    await app.state();
    await app.startScenario(continuousScenario.key);
    app.meta.script!.stopped = 'Step 5: 보완 2회 후 미충족: 인터뷰 결과\n@사용자 자료를 보완해 주세요.';
    const activity = (await app.state()).activity;
    expect(activity.stalled?.reason).toContain('인터뷰 결과');
    expect(activity.stalled?.reason).toContain('보완 2회');
    expect(activity.stalled?.reason).not.toContain('\n');
    expect(activity.stalled?.reason).toContain('직접 확인');
  } finally { await app.stop(); await rm(dir, { recursive: true, force: true }); }
});

it('shows a ledger-blocked task after the agent revision limit even when the script is done', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ensemble-blocked-reason-'));
  const app = new WebRuntime({ dataDir: dir, store: new MemoryLedgerStore() });
  try {
    await app.state();
    const ctx = { projectId: app.meta.projectId, targetProductId: 'test', actor: { kind: 'system' as const, id: 'dispatcher' } };
    await app.store.append(sceneEvents(3, ctx));
    await app.store.append([{ ...ctx, type: 'task_blocked', payload: { taskId: 'prototype', reason: '보완을 2회 요청했지만 인계 조건을 채우지 못했습니다', unblockBy: 'owner' } }]);
    const activity = (await app.state()).activity;
    expect(activity.stalled?.reason).toContain('프로토타입');
    expect(activity.stalled?.reason).toContain('보완을 2회');
    expect(activity.stalled?.reason).toContain('직접 확인');
  } finally { await app.stop(); await rm(dir, { recursive: true, force: true }); }
});

it('delivers a persisted next-turn change once when the web runtime restarts', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ensemble-restart-'));
  const store = new MemoryLedgerStore();
  const ctx = { projectId: 'persisted', targetProductId: 'test', actor: { kind: 'system' as const, id: 'test' } };
  const task = { id: 'prototype', title: '가입 화면', assignee: 'prototype-agent', dependsOn: [], handoffConditions: ['가입', '제외: 결제'] };
  await store.append([
    { ...ctx, type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: '사용자' } },
    { ...ctx, type: 'member_joined', payload: { memberId: 'prototype-agent', kind: 'agent', displayName: '프로토타입 Agent' } },
    { ...ctx, type: 'goal_set', payload: { text: '가입 시연', decider: 'owner', delegation: { pmMayApply: ['scope_reduce'] } } },
    { ...ctx, type: 'plan_committed', payload: { version: 1, basedOn: null, tasks: [task], reason: '확정', approvedBy: 'owner', sourceMessageIds: [] } },
    { ...ctx, type: 'task_start_reserved', payload: { taskId: task.id, specVersion: 1, trigger: 'approval' } },
    { ...ctx, type: 'task_started', payload: { taskId: task.id, turnId: 'old-turn' } },
    { ...ctx, type: 'turn_observed', payload: { agentId: task.assignee, taskId: task.id, turnId: 'old-turn', status: 'completed' } },
    { ...ctx, type: 'change_notified', payload: { changeId: 'persisted-change', planVersion: 1, recipientId: task.assignee, via: 'next_turn', text: JSON.stringify({ summary: '결제 제외', tasks: [task], drop: ['결제'] }) } },
  ]);
  await writeFile(path.join(dir, 'runtime.json'), JSON.stringify({ projectId: ctx.projectId, mode: 'free', scene: 1, step: 0 }));
  const app = new WebRuntime({ dataDir: dir, store });
  try {
    await app.state();
    await eventually(async () => (await store.read()).some(e => e.type === 'update_acknowledged'));
    expect(project(await store.read()).activeTurn.get(task.assignee)).toBe(task.id);
    expect((await store.read()).filter(e => e.type === 'task_started')).toHaveLength(2);
    await app.pm.deliverPendingChanges(); await app.pm.flush();
    expect((await store.read()).filter(e => e.type === 'update_sent')).toHaveLength(1);
    expect((await store.read() as AnyEvent[]).find(e => e.type === 'update_acknowledged')?.payload).toMatchObject({ dropped: ['결제'] });
  } finally { await app.stop(); await rm(dir, { recursive: true, force: true }); }
});

it('MD2 drives the work flow through the API with the fake PM model and fake agents', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ensemble-work-flow-'));
  const app = new WebRuntime({ dataDir: dir, store: new MemoryLedgerStore(), llm: new FakePmLlm(), fakeAgentDelayMs: 600, timers: false });
  globalRuntime.ensembleRuntime = app;
  const get = (route: string) => GET(new Request(`http://localhost/api/${route}`), { params: Promise.resolve({ path: route.split('?')[0]!.split('/') }) });
  const view = async (me: string) => await app.state(me) as unknown as ViewModel;
  const item = async (title: string) => (await view('owner')).work?.items.find(i => i.title === title);
  try {
    await app.state();
    // Before a plan there is no work projection, so the panel keeps its roadmap fallback.
    expect((await view('owner')).work).toBeUndefined();
    // Free start → hierarchical plan card for the decider.
    expect((await post('free/start', { me: 'owner', goal: '인터뷰 예약 서비스 시제품', deadline: '2026-12-01' })).status).toBe(200);
    const plan = (await view('owner')).cards.find(c => c.kind === 'plan_approval');
    expect(plan?.kind === 'plan_approval' && plan.tasks.length).toBe(6);
    // Sub-tasks carry their parent on the plan card (for the card to nest them once the contract names the field).
    expect(plan?.kind === 'plan_approval' && plan.tasks.filter(t => (t as { parentId?: string }).parentId === 'research').map(t => t.title)).toEqual(['비슷한 서비스 비교', '사용자 반응 가설 정리']);
    expect((await post(`cards/${plan!.id}`, { memberId: 'owner', approve: true })).status).toBe(200);
    // Agent work starts by itself and shows in the panel; the parent's status comes from its children.
    await eventually(async () => (await view('owner')).work!.items.some(i => i.parentId === 'research' && i.status === 'in_progress'));
    const research = (await view('owner')).work!.items.find(i => i.id === 'research')!;
    expect(research).toMatchObject({ status: 'in_progress', ownerKind: 'agent' });
    expect(research.childIds).toHaveLength(2);
    // The designer (not the decider) asks for new work: nothing is created, the decider gets a card with a recommendation.
    expect((await post('messages', { authorId: 'designer', text: '로그인 화면도 만들어 줘' })).status).toBe(202);
    await eventually(async () => ((await view('owner')).decisionCards ?? []).length === 1);
    const card = (await view('owner')).decisionCards![0]!;
    expect(card).toMatchObject({ requestKind: 'plan_change', answerMode: 'choose', impact: { taskTitles: ['로그인 화면'] } });
    expect(card.options.find(o => o.optionId === card.recommendation.optionId)?.summary.join(' ')).toContain('로그인 화면');
    expect(JSON.stringify(card)).not.toMatch(/new-work-\d/);
    expect(await item('로그인 화면')).toBeUndefined();
    expect((await view('designer')).decisionCards).toEqual([]);
    expect((await post(`decisions/${card.id}`, { me: 'designer', action: 'approve' })).status).toBe(403);
    expect((await post('decisions/missing', { me: 'owner', action: 'approve' })).status).toBe(404);
    expect((await post(`decisions/${card.id}`, { me: 'owner', action: 'approve', optionId: card.recommendation.optionId })).status).toBe(200);
    // Approved: the work exists, its agent starts, and the agent's question becomes the decider's card.
    await eventually(async () => ((await view('owner')).decisionCards ?? []).some(c => c.requestKind === 'missing_info'));
    const owner = await view('owner');
    const login = owner.work!.items.find(i => i.title === '로그인 화면')!;
    expect(login).toMatchObject({ ownerId: 'prototype-agent', ownerKind: 'agent', status: 'waiting_human', waitingOn: { memberId: 'owner' }, origin: { createdByName: '디자이너' } });
    const question = owner.decisionCards!.find(c => c.requestKind === 'missing_info')!;
    expect(owner.messages.some(m => m.cardId === question.id && m.taskIds?.includes(login.id))).toBe(true);
    // The agent's own choices are the card's options, each answering with its words; the PM recommends one, with a reason.
    const asked = project(await app.store.read()).decisionRequests.get(question.id)!.request;
    expect(asked.question).not.toMatch(/선택지|이메일만 \//);
    expect(asked.options.filter(o => o.answerText).map(o => [o.label, o.answerText])).toEqual([['이메일만', '이메일만'], ['이메일과 소셜 로그인', '이메일과 소셜 로그인']]);
    expect(question.options.map(o => o.label)).toEqual(['이메일만', '이메일과 소셜 로그인', '보류']);
    expect(asked.options.find(o => o.optionId === asked.recommendation.optionId)?.answerText).toBe('이메일만');
    expect(question.recommendation.rationale).toContain('이메일만');
    expect(question.recommendation.rationale).not.toBe('답이 있어야 작업이 이어집니다.');
    // "답하기" without words is gone: an option that is not an answer still needs words (hold is the only one left).
    expect((await view('owner')).decisionCards!.some(c => c.id === question.id)).toBe(true);
    expect((await item('로그인 화면'))?.status).toBe('waiting_human');
    // Picking the other offered answer sends exactly its words to the agent.
    const other = asked.options.find(o => o.answerText === '이메일과 소셜 로그인')!;
    expect((await post(`decisions/${question.id}`, { me: 'owner', action: 'choose', optionId: other.optionId })).status).toBe(200);
    const answered = await app.store.read() as AnyEvent[];
    expect(answered.find(e => e.type === 'decision_resolved' && e.payload.requestId === question.id)?.payload).toMatchObject({ outcome: 'answered', optionId: other.optionId, answerText: '이메일과 소셜 로그인' });
    expect(answered.some(e => e.type === 'change_notified' && e.payload.recipientId === 'prototype-agent' && e.payload.text === '이메일과 소셜 로그인')).toBe(true);
    // The answer resumes the work; a comment on it reaches the agent while it runs.
    expect((await item('로그인 화면'))?.status).toBe('in_progress');
    expect((await post(`tasks/${login.id}/comments`, { me: 'owner', text: '버튼 문구는 짧게 해 주세요' })).status).toBe(202);
    await eventually(async () => (await app.store.read() as AnyEvent[]).some(e => e.type === 'change_notified' && e.payload.changeId.startsWith('comment:') && e.payload.recipientId === 'prototype-agent'));
    await eventually(async () => (await item('로그인 화면'))?.status === 'done');
    const response = await get(`tasks/${login.id}`);
    expect(response.status).toBe(200);
    const detail = await response.json() as VmTaskDetail;
    expect(detail.item.title).toBe('로그인 화면');
    expect(detail.comments.map(c => c.text)).toEqual(['버튼 문구는 짧게 해 주세요']);
    expect(detail.activity.map(a => a.kind)).toEqual(expect.arrayContaining(['created', 'started', 'decision_requested', 'decision_resolved', 'comment', 'submitted', 'reviewed']));
    const submitted = (await app.store.read() as AnyEvent[]).findLast(e => e.type === 'result_submitted' && e.payload.taskId === login.id);
    expect(submitted?.type === 'result_submitted' && submitted.payload.summary).toContain('버튼 문구는 짧게');
    // Comments stay in the work thread, not the channel.
    expect((await view('owner')).messages.some(m => m.text === '버튼 문구는 짧게 해 주세요')).toBe(false);
    expect((await get('tasks/missing')).status).toBe(404);
    expect((await post('tasks/missing/comments', { me: 'owner', text: '확인' })).status).toBe(404);
    expect((await post(`tasks/${login.id}/comments`, { me: 'research-agent', text: '확인' })).status).toBe(403);

    // A change asked for on the finished work, by the decider: follow-up work for the same agent, built on the result,
    // with the comment as its origin — and the PM says in the thread what it did.
    expect((await post(`tasks/${login.id}/comments`, { me: 'owner', text: '비밀번호 찾기 링크도 넣어 주세요' })).status).toBe(202);
    await eventually(async () => !!(await item('로그인 화면 보완')));
    const followUp = (await item('로그인 화면 보완'))!;
    expect(followUp).toMatchObject({ ownerId: 'prototype-agent', ownerKind: 'agent', origin: { createdByName: '사용자' } });
    expect(project(await app.store.read()).tasks.get(followUp.id)?.spec.dependsOn).toEqual([login.id]);
    await eventually(async () => ((await (await get(`tasks/${login.id}`)).json()) as VmTaskDetail).comments.some(c => c.authorId === 'pm'));
    const thread = await (await get(`tasks/${login.id}`)).json() as VmTaskDetail;
    expect(thread.comments.find(c => c.authorId === 'pm')?.text).toMatch(/후속 작업 "로그인 화면 보완".*프로토타입 Agent에게 맡겼어요/);
    // The same ask from someone who is not the decider: no work yet, the decider gets a card with a recommendation, the thread hears so.
    expect((await post(`tasks/${login.id}/comments`, { me: 'designer', text: '오류 문구도 바꿔 주세요' })).status).toBe(202);
    await eventually(async () => ((await view('owner')).decisionCards ?? []).some(c => c.requestKind === 'plan_change'));
    const ask = (await view('owner')).decisionCards!.find(c => c.requestKind === 'plan_change')!;
    expect(ask.recommendation.rationale).toContain('디자이너');
    expect(ask.question).not.toMatch(/follow-up-\d/);
    await eventually(async () => ((await (await get(`tasks/${login.id}`)).json()) as VmTaskDetail).comments.filter(c => c.authorId === 'pm').length === 2);
    expect(((await (await get(`tasks/${login.id}`)).json()) as VmTaskDetail).comments.filter(c => c.authorId === 'pm')[1]!.text).toContain('사용자님께');
    // The PM log never calls a turn that put a card in front of someone "silent".
    const log = (await view('owner')).pmLog;
    expect(log.filter(l => l.spokenText?.includes('반영할까요')).every(l => l.decision === 'speak' && l.whoseAction?.includes('사용자'))).toBe(true);
    // Nothing people read carries a serialized structure or an internal work key.
    const final = await view('owner');
    for (const text of [...final.messages.map(m => m.text), ...final.pmLog.flatMap(l => [l.spokenText ?? '', l.reason])]) expect(text).not.toMatch(/\{"|"\w+":|follow-up-\d|new-work-\d/);
    for (const workItem of final.work!.items) {
      const detail = await (await get(`tasks/${workItem.id}`)).json() as VmTaskDetail;
      for (const entry of detail.activity) expect(entry.text).not.toMatch(/\{"|"\w+":/);
    }
  } finally { await app.stop(); delete globalRuntime.ensembleRuntime; await rm(dir, { recursive: true, force: true }); }
}, 30000);

it('runs the stuck-work sweep and the daily digest on its timer tick only in free projects, with the digest switchable', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ensemble-tick-'));
  const app = new WebRuntime({ dataDir: dir, store: new MemoryLedgerStore(), llm: new FakePmLlm(), timers: false, digest: false });
  try {
    await app.state();
    const sweep = vi.spyOn(app.pm, 'sweep'), digest = vi.spyOn(app.pm, 'digest');
    await app.tick(new Date('2026-10-02T01:00:00Z'));
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(digest).not.toHaveBeenCalled();
    expect(app.digestEnabled).toBe(false);
    expect(FREE_FAKE_AGENT_DELAY_MS).toBe(30_000);
    const goal = (await app.store.read() as AnyEvent[]).find(e => e.type === 'goal_set');
    expect(goal?.type === 'goal_set' && goal.payload.delegation.pmMayApply).toEqual(['reorder', 'split_task', 'reassign_agent']);
    await app.startScenario(continuousScenario.key);
    const scenarioSweep = vi.spyOn(app.pm, 'sweep');
    await app.tick();
    expect(scenarioSweep).not.toHaveBeenCalled();
  } finally { await app.stop(); await rm(dir, { recursive: true, force: true }); }
  const on = new WebRuntime({ dataDir: await mkdtemp(path.join(tmpdir(), 'ensemble-tick-on-')), store: new MemoryLedgerStore(), llm: new FakePmLlm(), timers: false });
  try {
    await on.state();
    const digest = vi.spyOn(on.pm, 'digest');
    await on.tick(new Date('2026-10-02T01:00:00Z'));
    expect(digest).toHaveBeenCalledWith(new Date('2026-10-02T01:00:00Z'));
  } finally { await on.stop(); await rm(on.dataDir, { recursive: true, force: true }); }
});
