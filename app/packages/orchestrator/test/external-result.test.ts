import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { SessionConnector, SessionEvent, TaskInstructionsInput } from '@ensemble/agents';
import { project, type AnyEvent, type NewLedgerEvent } from '@ensemble/core';
import type { LlmProvider } from '@ensemble/llm';
import { ProjectManager } from '@ensemble/orchestrator';
import { MemoryLedgerStore } from '@ensemble/store';
import { POST } from '../../../apps/web/app/api/[...path]/route.ts';
import type { WebRuntime } from '../../../apps/web/lib/runtime.ts';

// COMMITTED CHANGE; hypothesis review SOUND, recorded before implementation.
// An authenticated assignee can submit to ready/running work without message routing.
// Verify HTTP refusals leave the ledger untouched, handoff starts a dependent agent,
// concurrent submissions cannot both win, and artifacts/via survive projection replay.
class Transport implements SessionConnector {
  handlers = new Set<(event: SessionEvent) => void>();
  starts: { agentId: string; input: TaskInstructionsInput }[] = [];
  async startSession(agentId: string, projectId: string) { return { threadId: `${projectId}:${agentId}`, workspace: process.cwd() }; }
  async startTask(agentId: string, input: TaskInstructionsInput) { this.starts.push({ agentId, input }); return `turn-${this.starts.length}`; }
  async sendUpdate() { return { sent: true as const }; }
  onEvent(handler: (event: SessionEvent) => void) { this.handlers.add(handler); return () => { this.handlers.delete(handler); }; }
  async stop() {}
}
const uri = 'https://example.com/report?version=1#delivery';
const via = { channel: 'ide' as const, agent: 'personal-coding-agent' };
const body = { memberId: 'human', summary: 'Delivery report completed outside Ensemble', artifacts: [{ kind: 'url', name: 'Delivery report', uri }], via };

async function fixture(t: TestContext, verdict: 'checked' | 'revision' | 'error' = 'checked') {
  const store = new MemoryLedgerStore(), connector = new Transport(), calls: string[] = [];
  const context = { projectId: 'external-result', targetProductId: 'product' };
  const actor = { kind: 'human' as const, id: 'human' };
  const llm: LlmProvider = { async complete(request) {
    calls.push(request.forceTool ?? '');
    assert.equal(request.forceTool, 'record_handoff_review', 'external intake must never call route_message');
    if (verdict === 'error') throw new Error('Provider unavailable');
    return { text: '', model: 'stub', responseId: 'review', usage: { inputTokens: 0, outputTokens: 0 },
      toolCalls: [{ name: 'record_handoff_review', input: { conditions: [{ index: 1, met: verdict === 'checked', quote: uri, missing: 'Delivery report needs revision' }], decisionConflicts: [] } }] };
  } };
  const pm = new ProjectManager({ ...context, store, connector, llm, model: 'stub' });
  await store.append([
    ...(['human', 'other', 'agent'] as const).map(memberId => ({ ...context, actor, type: 'member_joined', payload: { memberId, kind: memberId === 'agent' ? 'agent' : 'human', displayName: memberId } } as NewLedgerEvent)),
    { ...context, actor, type: 'goal_set', payload: { text: 'Deliver a report', decider: 'human', delegation: { pmMayApply: [] } } },
    { ...context, actor, type: 'plan_committed', payload: { version: 1, basedOn: null, reason: 'Approved', approvedBy: 'human', sourceMessageIds: [], tasks: [
      { id: 'T-1', title: 'Delivery report', assignee: 'human', dependsOn: [], handoffConditions: ['Delivery report'] },
      { id: 'T-2', title: 'Use report', assignee: 'agent', dependsOn: ['T-1'], handoffConditions: [] },
    ] } },
  ]);
  const host = globalThis as typeof globalThis & { ensembleRuntime?: WebRuntime };
  const previous = host.ensembleRuntime, previousTokens = process.env.ENSEMBLE_MEMBER_TOKENS;
  // Exercise the actual HTTP handler and PM; replace only runtime hosting and external transports.
  host.ensembleRuntime = { pm, run: <T>(action: () => Promise<T>) => action() } as WebRuntime;
  delete process.env.ENSEMBLE_MEMBER_TOKENS;
  t.after(async () => {
    if (previous === undefined) delete host.ensembleRuntime; else host.ensembleRuntime = previous;
    if (previousTokens === undefined) delete process.env.ENSEMBLE_MEMBER_TOKENS; else process.env.ENSEMBLE_MEMBER_TOKENS = previousTokens;
    await pm.stop(); store.close();
  });
  const events = async () => await store.read(context) as AnyEvent[];
  const state = async () => project(await events());
  const post = (payload: unknown = body, taskId = 'T-1', token: string | null = 'dev-token') => POST(new Request(`http://localhost/api/tasks/${taskId}/result`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token === null ? {} : { Authorization: `Bearer ${token}` }) }, body: JSON.stringify(payload),
  }), { params: Promise.resolve({ path: ['tasks', taskId, 'result'] }) });
  return { pm, store, context, actor, connector, calls, events, state, post };
}

test('HTTP result checks ready human work, starts the dependent agent, and projects URL plus via', async t => {
  const f = await fixture(t);
  assert.equal((await f.state()).tasks.get('T-1')?.status, 'ready');
  const response = await f.post();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, taskId: 'T-1', resultIndex: 0 });
  const state = await f.state(), events = await f.events(), result = state.tasks.get('T-1')!.results[0]!;
  assert.equal(state.tasks.get('T-1')?.status, 'checked');
  assert.equal(state.tasks.get('T-2')?.status, 'running');
  assert.deepEqual(f.connector.starts.map(s => [s.agentId, s.input.taskId]), [['agent', 'T-2']]);
  assert.deepEqual(f.calls, ['record_handoff_review']);
  assert.deepEqual(result.via, via);
  assert.deepEqual(result.artifacts?.map(a => ({ name: a.name, uri: a.uri, mimeType: a.mimeType, taskId: a.taskId })), [{ name: 'Delivery report', uri, mimeType: 'text/uri-list', taskId: 'T-1' }]);
  const submitted = events.find(e => e.type === 'result_submitted')!;
  assert.equal(submitted.actor.id, 'human');
  assert.equal(submitted.actor.kind, 'human');
  assert.equal(events.filter(e => e.type === 'task_started' && e.payload.taskId === 'T-1').length, 1);
  assert.ok(events.findIndex(e => e.type === 'task_started' && e.payload.taskId === 'T-1') < events.indexOf(submitted));
  assert.equal(events.some(e => e.type === 'message_recorded'), false);
});

test('HTTP 401/403/404/409 refusals leave the ledger unchanged', async t => {
  const f = await fixture(t), before = await f.events();
  for (const token of [null, '', 'wrong-token']) assert.equal((await f.post(body, 'T-1', token)).status, 401);
  assert.equal((await f.post({ ...body, memberId: 'other' })).status, 403);
  assert.equal((await f.post(body, 'missing')).status, 404);
  assert.equal((await f.post({ ...body, memberId: 'agent' }, 'T-2')).status, 409);
  assert.deepEqual(await f.events(), before);
  assert.equal(f.calls.length, 0);
});

test('member tokens bind identity; configured, missing, and malformed maps never fall back to dev-token', async t => {
  const f = await fixture(t), before = await f.events();
  process.env.ENSEMBLE_MEMBER_TOKENS = JSON.stringify({ human: 'human-token', other: 'other-token' });
  for (const token of ['dev-token', 'other-token']) assert.equal((await f.post(body, 'T-1', token)).status, 401);
  assert.equal((await f.post({ ...body, memberId: 'other' }, 'T-1', 'other-token')).status, 403);
  for (const configured of ['{}', '{', 'null', '[]', '"dev-token"', '']) {
    process.env.ENSEMBLE_MEMBER_TOKENS = configured;
    assert.equal((await f.post()).status, 401);
  }
  process.env.ENSEMBLE_MEMBER_TOKENS = '{}';
  assert.equal((await f.post({ ...body, memberId: 'toString' }, 'T-1', 'dev-token')).status, 401);
  assert.deepEqual(await f.events(), before);
  process.env.ENSEMBLE_MEMBER_TOKENS = JSON.stringify({ human: 'human-token' });
  assert.equal((await f.post(body, 'T-1', 'human-token')).status, 200);
});

test('running task accepts a base64 file without via and preserves legacy projection', async t => {
  const f = await fixture(t);
  await f.store.append([{ ...f.context, actor: f.actor, type: 'task_started', payload: { taskId: 'T-1' } }]);
  const contentBase64 = Buffer.from(uri).toString('base64');
  assert.equal((await f.post({ memberId: 'human', summary: 'File report', artifacts: [{ kind: 'file', name: 'report.txt', mimeType: 'text/plain', contentBase64 }] })).status, 200);
  const events = await f.events(), state = await f.state(), result = state.tasks.get('T-1')!.results[0]!;
  assert.equal(state.tasks.get('T-1')?.status, 'checked');
  assert.equal('via' in result, false);
  assert.equal(result.artifacts?.[0]?.uri, `data:text/plain;base64,${contentBase64}`);
  assert.equal(events.filter(e => e.type === 'task_started' && e.payload.taskId === 'T-1').length, 1);
  const old = events.map(e => e.type === 'result_submitted' ? { ...e, payload: { ...e.payload, artifactIds: [] } } : e);
  assert.deepEqual(project(old).tasks.get('T-1')?.results[0], { resultId: result.resultId, planVersion: 1 });
});

test('concurrent result submissions produce one result and one dependent start', async t => {
  const f = await fixture(t);
  const responses = await Promise.all([f.post(), f.post()]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal((await f.events()).filter(e => e.type === 'result_submitted').length, 1);
  assert.equal(f.connector.starts.length, 1);
});

test('blocked, revising, submitted, reserved, checked, and cancelled tasks reject intake', async t => {
  const f = await fixture(t);
  const transitions: NewLedgerEvent[] = [
    { ...f.context, actor: f.actor, type: 'task_start_reserved', payload: { taskId: 'T-1', specVersion: 1, trigger: 'test' } },
    { ...f.context, actor: f.actor, type: 'result_submitted', payload: { taskId: 'T-1', resultId: 'prior', planVersion: 1, summary: 'prior', artifactIds: [] } },
    { ...f.context, actor: f.actor, type: 'task_checked', payload: { taskId: 'T-1', resultId: 'prior', reason: 'Accepted' } },
    { ...f.context, actor: f.actor, type: 'revision_requested', payload: { taskId: 'T-1', resultId: 'prior', missing: ['report'] } },
    { ...f.context, actor: f.actor, type: 'task_blocked', payload: { taskId: 'T-1', reason: 'stopped' } },
    { ...f.context, actor: f.actor, type: 'plan_committed', payload: { version: 2, basedOn: 1, reason: 'Remove task', approvedBy: 'human', sourceMessageIds: [], tasks: [] } },
  ];
  for (const event of transitions) {
    await f.store.append([event]);
    const before = await f.events();
    assert.equal((await f.post()).status, 409);
    assert.deepEqual(await f.events(), before);
  }
});

test('invalid input is rejected before result or attachment writes', async t => {
  const f = await fixture(t), before = await f.events();
  for (const patch of [
    { summary: '' }, { memberId: '' }, { artifacts: {} }, { artifacts: [{ kind: 'unknown' }] },
    { artifacts: [{ kind: 'url', name: 'Report', uri: '' }] },
    { artifacts: [{ kind: 'file', name: 'Report', mimeType: 'text/plain', contentBase64: '!!!' }] },
    { via: { channel: 'unknown' } }, { via: { channel: 'ide', agent: 42 } },
  ]) assert.equal((await f.post({ ...body, ...patch })).status, 400);
  assert.deepEqual(await f.events(), before);
});

test('optional artifacts are accepted and resultIndex identifies the appended result', async t => {
  const f = await fixture(t);
  await f.store.append([
    { ...f.context, actor: f.actor, type: 'result_submitted', payload: { taskId: 'T-1', resultId: 'prior', planVersion: 1, summary: 'prior', artifactIds: [] } },
    { ...f.context, actor: f.actor, type: 'task_started', payload: { taskId: 'T-1' } },
  ]);
  const response = await f.post({ memberId: 'human', summary: 'Summary only' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, taskId: 'T-1', resultIndex: 1 });
  assert.equal((await f.state()).tasks.get('T-1')?.results.length, 2);
  assert.equal(f.connector.starts.length, 0, 'existing handoff policy still requires an artifact');
});

test('review rejection and technical failure retain the submitted result without starting dependents', async t => {
  for (const verdict of ['revision', 'error'] as const) await t.test(verdict, async sub => {
    const f = await fixture(sub, verdict);
    assert.equal((await f.post()).status, 200, '200 acknowledges submission, not handoff approval');
    const state = await f.state();
    assert.equal(state.tasks.get('T-1')?.results.length, 1);
    assert.notEqual(state.tasks.get('T-1')?.status, 'checked');
    assert.equal(state.tasks.get('T-2')?.status, 'waiting');
    assert.equal(f.connector.starts.length, 0);
  });
});
