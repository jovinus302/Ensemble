import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { SessionConnector, SessionEvent, TaskInstructionsInput } from '@ensemble/agents';
import { project, workStatus, type AnyEvent, type EventPayloads, type NewLedgerEvent } from '@ensemble/core';
import type { LlmProvider } from '@ensemble/llm';
import { ProjectManager } from '@ensemble/orchestrator';
import { SessionRunner } from '../packages/orchestrator/src/session-runner.ts';
import { MemoryLedgerStore } from '@ensemble/store';

// Only the external transport is fake: PM decisions, queues, projection and ledger writes are real.
class Transport implements SessionConnector {
  handlers = new Set<(event: SessionEvent) => void>();
  starts: TaskInstructionsInput[] = [];
  startedAgents: string[] = [];
  async startSession(agentId: string, projectId: string) { return { threadId: `${projectId}:${agentId}`, workspace: process.cwd() }; }
  async startTask(agentId: string, input: TaskInstructionsInput) { this.startedAgents.push(agentId); this.starts.push(input); return `turn-${this.starts.length}`; }
  async sendUpdate() { return { sent: true as const }; }
  onEvent(handler: (event: SessionEvent) => void) { this.handlers.add(handler); return () => { this.handlers.delete(handler); }; }
  async stop() {}
  emit(event: SessionEvent) { for (const handler of this.handlers) handler(event); }
}
const noModel: LlmProvider = { async complete() { throw new Error('Unexpected model call in deterministic regression'); } };
async function fixture(t: TestContext, projectId = 'project-a', store = new MemoryLedgerStore(), stopped = true) {
  const context = { projectId, targetProductId: 'product' };
  const actor = { kind: 'human' as const, id: 'owner' };
  const connector = new Transport();
  const pm = new ProjectManager({ ...context, store, connector, llm: noModel, model: 'no-provider' });
  t.after(() => pm.stop());
  const seed: NewLedgerEvent[] = [
    ...(['owner', 'outsider', 'agent', 'delivery-agent'] as const).map(id => ({ ...context, actor, type: 'member_joined' as const, payload: { memberId: id, kind: id.endsWith('agent') ? 'agent' as const : 'human' as const, displayName: id } })),
    { ...context, actor, type: 'goal_set', payload: { text: 'Ship an agreed result', decider: 'owner', delegation: { pmMayApply: [] } } },
    { ...context, actor, type: 'plan_committed', payload: { version: 1, basedOn: null, reason: 'Human approved scope', approvedBy: 'owner', sourceMessageIds: [], tasks: [
      { id: 'draft', title: 'Draft', assignee: 'agent', dependsOn: [], handoffConditions: [] },
      { id: 'delivery', title: 'Delivery', assignee: 'delivery-agent', dependsOn: ['draft'], handoffConditions: [] },
    ] } },
  ];
  if (stopped) seed.push(
    { ...context, actor: { kind: 'agent', id: 'agent' }, type: 'result_submitted', payload: { taskId: 'draft', resultId: 'draft-result', planVersion: 1, summary: 'Needs human judgment', artifactIds: [] } },
    { ...context, actor, type: 'task_blocked', payload: { taskId: 'draft', reason: 'Required human decision' } },
  );
  await store.append(seed);
  const events = async () => await store.read({ projectId }) as AnyEvent[];
  const state = async () => project(await events());
  const card = async () => {
    const payload: EventPayloads['decision_requested'] = { requestId: 'decision', kind: 'stuck_work', targetMemberId: 'owner', question: 'Accept the current result?',
      options: [{ optionId: 'accept', label: 'Accept', tradeoff: 'Keep current scope', effects: [{ type: 'resolve_task', taskId: 'draft', action: 'accept' }] }, { optionId: 'hold', label: 'Hold', tradeoff: 'Remain stopped', effects: [{ type: 'none' }] }],
      recommendation: { optionId: 'accept', rationale: 'Needs owner judgment', evidence: [] }, impact: { taskIds: ['draft'], blockedTaskIds: ['draft'] }, sourceMessageIds: [] };
    await store.append([{ ...context, actor: { kind: 'pm', id: 'pm' }, type: 'decision_requested', payload }]);
  };
  return { context, connector, pm, store, events, state, card };
}

test('required human decision stays paused; another member cannot answer; rejection never hands off', async t => {
  const f = await fixture(t); await f.card();
  assert.equal(workStatus((await f.state()).tasks.get('draft')!, await f.state()), 'waiting_human');
  await assert.rejects(f.pm.decideRequest('decision', { by: 'outsider', action: 'approve' }), { code: 'forbidden' });
  assert.equal((await f.state()).decisionRequests.get('decision')?.status, 'open');
  await f.pm.decideRequest('decision', { by: 'owner', action: 'reject' });
  assert.equal((await f.state()).tasks.get('draft')?.status, 'blocked');
  assert.equal((await f.state()).decisionRequests.get('decision')?.status, 'rejected');
  assert.equal((await f.events()).filter(e => e.type === 'task_start_reserved').length, 0);
  assert.equal(f.connector.starts.length, 0);
});

test('concurrent duplicate approval records one human acceptance and one dependent handoff', async t => {
  const f = await fixture(t); await f.card();
  await Promise.all([1, 2, 3].map(() => f.pm.decideRequest('decision', { by: 'owner', action: 'approve' })));
  const events = await f.events();
  assert.equal(events.filter(e => e.type === 'decision_resolved').length, 1);
  assert.equal(events.filter(e => e.type === 'task_checked').length, 1);
  assert.equal(events.find(e => e.type === 'task_checked')?.actor.id, 'owner');
  assert.equal(events.filter(e => e.type === 'task_start_reserved' && e.payload.taskId === 'delivery').length, 1);
  assert.equal((await f.state()).tasks.get('delivery')?.status, 'running');
  assert.deepEqual(f.connector.startedAgents, ['delivery-agent']);
  assert.deepEqual(f.connector.starts.map(input => input.taskId), ['delivery']);
  assert.equal(events.filter(e => e.type === 'task_started' && e.payload.taskId === 'delivery').length, 1);
});

test('retry rejects unrelated people and resumes the original assignee once with the human note', async t => {
  const f = await fixture(t);
  await assert.rejects(f.pm.resolveTask('draft', { by: 'outsider', action: 'retry' }), { code: 'forbidden' });
  assert.equal((await f.state()).tasks.get('draft')?.status, 'blocked');
  await f.pm.resolveTask('draft', { by: 'owner', action: 'retry', note: 'Remove songs only' });
  assert.equal((await f.state()).tasks.get('draft')?.spec.assignee, 'agent');
  assert.equal((await f.state()).tasks.get('draft')?.status, 'revising');
  assert.equal((await f.events()).filter(e => e.type === 'task_resumed').length, 1);
  assert.ok((await f.events()).some(e => e.type === 'revision_requested' && e.payload.missing.join(' ').includes('Remove songs only')));
  await assert.rejects(f.pm.resolveTask('delivery', { by: 'owner', action: 'retry' }), { code: 'invalid_state' });
});

const instruction: TaskInstructionsInput = { taskId: 'draft', planVersion: 1, goalSummary: { text: 'Goal', sourceId: 'goal' }, taskTitle: { text: 'Draft', sourceId: 'plan' }, handoffConditions: [], decisions: [], inputs: [], openQuestions: [] };
async function running(t: TestContext) {
  const f = await fixture(t, 'runner', undefined, false);
  const runner = new SessionRunner(f.connector, f.store, f.context);
  t.after(() => runner.stop());
  await runner.startSession('agent');
  const turnId = await runner.startTask('agent', instruction);
  return { ...f, runner, turnId };
}

test('duplicate execution input cannot create a second active agent turn', async t => {
  const f = await running(t);
  await assert.rejects(f.runner.startTask('agent', instruction));
  assert.equal(f.connector.starts.length, 1);
  assert.equal((await f.events()).filter(e => e.type === 'task_started').length, 1);
  assert.equal((await f.state()).activeTurn.get('agent'), 'draft');
});

test('stopping the runtime detaches late transport results instead of accepting stale completion', async t => {
  const f = await running(t);
  assert.ok(f.connector.handlers.size > 0);
  await f.pm.stop(); await f.runner.stop();
  assert.equal(f.connector.handlers.size, 0);
  const before = (await f.events()).length;
  f.connector.emit({ type: 'report', agentId: 'agent', taskId: 'draft', threadId: 'runner:agent', turnId: f.turnId, itemId: 'late', index: 0,
    report: { type: 'result_report', taskId: 'draft', planVersion: 1, summary: 'Late result', files: [] } });
  await f.runner.flush();
  assert.equal((await f.events()).length, before);
  assert.equal((await f.events()).filter(e => e.type === 'result_submitted').length, 0);
});

test('same task and decision IDs in shared storage remain isolated by project', async t => {
  const store = new MemoryLedgerStore();
  const a = await fixture(t, 'project-a', store); const b = await fixture(t, 'project-b', store);
  await a.card(); await b.card();
  const beforeB = await b.events();
  await a.pm.decideRequest('decision', { by: 'owner', action: 'approve' });
  assert.equal((await a.state()).tasks.get('draft')?.status, 'checked');
  assert.deepEqual(await b.events(), beforeB);
  assert.equal((await b.state()).decisionRequests.get('decision')?.status, 'open');
  assert.equal((await b.state()).tasks.get('draft')?.status, 'blocked');
  assert.equal(b.connector.starts.length, 0);
});
