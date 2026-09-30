import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { MemoryLedgerStore } from '@ensemble/store';
import type { LlmProvider } from '@ensemble/llm';
import { project, type AnyEvent } from '@ensemble/core';
import { WebRuntime } from '../../../apps/web/lib/runtime.ts';
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
    for (let i = 0; i < continuousScenario.steps.length; i++) {
      if (i === 4) {
        const events = await app.store.read({ projectId: originalId });
        const state = project(events);
        expect(['ready', 'reserved']).toContain([...state.tasks.values()].find(t => t.spec.assignee === 'owner')?.status);
        expect(conditionMet(continuousScenario.steps[i]!.waitFor!, events, app.meta.script!.anchors)).toBe(true);
        expect(resolveTarget(state, { assignee: 'owner' })).toBe('interview');
      }
      expect((await post('scenario/next')).status).toBe(202);
      await eventually(async () => (app.meta.script!.step === i + 1 && !(await app.state()).busy) || !!app.meta.script!.stopped);
      expect(app.meta.script!.stopped).toBeUndefined();
      await app.pm.flush();
    }
    const state = await app.state();
    expect(state.scenario?.done).toBe(true);
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
      for (let step = 1; step < continuousScenario.steps.length; step++) {
        expect((await post('scenario/next')).status).toBe(202);
        await eventually(async () => (app.meta.script!.step === step + 1 && !(await app.state()).busy) || !!app.meta.script!.stopped);
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
