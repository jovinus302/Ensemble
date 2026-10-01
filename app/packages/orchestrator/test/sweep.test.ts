import { afterEach, expect, it } from 'vitest';
import { decisionReminderKey, pausedTaskIds, project, workStatus, type AnyEvent, type DecisionSettings, type EventPayloads, type NewLedgerEvent, type TaskSpec } from '@ensemble/core';
import type { LlmProvider } from '@ensemble/llm';
import type { ContinueTaskInput, SessionConnector, SessionEvent, TaskInstructionsInput, UpdateInstructionsInput } from '@ensemble/agents';
import { MemoryLedgerStore } from '@ensemble/store';
import { ProjectManager } from '../src/pm.ts';

// MC2 B8 (§3, §5 acceptance 4): the sweep reports — decision requests, one reminder, expiry, a check — and
// never restarts or reassigns work itself. Every write is keyed, so calling it again changes nothing.
let n = 0;
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

class FakeConnector implements SessionConnector {
  starts: { agentId: string; input: TaskInstructionsInput }[] = [];
  updates: { agentId: string; input: UpdateInstructionsInput }[] = [];
  continued: { agentId: string; input: ContinueTaskInput }[] = [];
  private turns = 0;
  async startSession(agentId: string) { return { threadId: `thread-${agentId}`, workspace: `/workspace/${agentId}` }; }
  async startTask(agentId: string, input: TaskInstructionsInput) { this.starts.push({ agentId, input }); return `turn-${++this.turns}`; }
  async sendUpdate(agentId: string, input: UpdateInstructionsInput) { this.updates.push({ agentId, input }); return { sent: true as const }; }
  async continueTask(agentId: string, input: ContinueTaskInput) { this.continued.push({ agentId, input }); return `turn-${++this.turns}`; }
  onEvent(_handler: (event: SessionEvent) => void) { return () => undefined; }
  async stop() { /* nothing to stop */ }
}

const T0 = Date.parse('2026-10-01T00:00:00.000Z'); // 09:00 Asia/Seoul
const at = (hours: number) => new Date(T0 + hours * 3_600_000);
const iso = (hours: number) => at(hours).toISOString();
const TASKS: TaskSpec[] = [
  { id: 'research', title: '예약 서비스 대안 조사', assignee: 'research-agent', dependsOn: [], handoffConditions: ['대안 2개가 표로 비교되어 있다'] },
  { id: 'flow', title: '흐름 설계', assignee: 'designer', dependsOn: ['research'], handoffConditions: ['화면 목록'] },
];

async function fixture(options: { tasks?: TaskSpec[]; decisionSettings?: DecisionSettings } = {}) {
  const ctx = { projectId: `sweep-${++n}`, targetProductId: 'product' };
  const llm: LlmProvider = { async complete(request) { throw new Error(`Unexpected call ${request.forceTool}`); } };
  const store = new MemoryLedgerStore();
  const connector = new FakeConnector();
  const pm = new ProjectManager({ ...ctx, store, llm, connector, model: 'fake', decisionSettings: options.decisionSettings });
  cleanup.push(() => pm.stop());
  const owner = { kind: 'human' as const, id: 'owner' };
  const seed = (type: NewLedgerEvent['type'], payload: unknown, hours = -48, actor: NewLedgerEvent['actor'] = owner): NewLedgerEvent => ({ ...ctx, type, actor, payload, at: iso(hours) });
  await store.append([
    seed('member_joined', { memberId: 'owner', kind: 'human', displayName: '사용자' }),
    seed('member_joined', { memberId: 'designer', kind: 'human', displayName: '디자이너' }),
    seed('member_joined', { memberId: 'research-agent', kind: 'agent', displayName: '조사 Agent', role: 'research-agent' }),
    seed('member_joined', { memberId: 'proto-agent', kind: 'agent', displayName: '프로토타입 Agent' }),
    seed('goal_set', { text: 'PT 예약 프로토타입', decider: 'owner', delegation: { pmMayApply: [] } }),
    seed('plan_committed', { version: 1, basedOn: null, reason: 'approved', approvedBy: 'owner', sourceMessageIds: [], tasks: options.tasks ?? TASKS }),
  ]);
  const events = async () => await store.read({ projectId: ctx.projectId }) as AnyEvent[];
  const state = async () => project(await events());
  const blockResearch = async (hours: number) => store.append([
    seed('task_start_reserved', { taskId: 'research', specVersion: 1, trigger: 'kickoff' }, hours - 1, { kind: 'pm', id: 'pm' }),
    seed('task_started', { taskId: 'research', turnId: 'turn-0' }, hours - 1, { kind: 'agent', id: 'research-agent' }),
    seed('task_blocked', { taskId: 'research', reason: 'Agent 턴이 시간 제한을 넘겼습니다' }, hours, { kind: 'system', id: 'session-runner' }),
  ]);
  const request = (payload: EventPayloads['decision_requested'], hours: number) =>
    store.append([{ ...seed('decision_requested', payload, hours, { kind: 'pm', id: 'pm' }), idempotencyKey: `decision:${payload.requestId}` }]);
  return { ctx, pm, store, connector, events, state, blockResearch, request };
}
const requestsOf = (events: AnyEvent[]) => events.flatMap(e => e.type === 'decision_requested' ? [e.payload] : []);
const reassignRequest = (taskId: string): EventPayloads['decision_requested'] => ({
  requestId: 'req-move', kind: 'plan_change', targetMemberId: 'owner', question: '조사 작업을 프로토타입 Agent에게 넘길까요?',
  options: [
    { optionId: 'move', label: '프로토타입 Agent에게 맡기기', effects: [{ type: 'plan_ops', ops: [{ type: 'reassign', taskId: 'research', assignee: 'proto-agent', sourceMessageIds: [] }] }], tradeoff: '' },
    { optionId: 'hold', label: '보류', effects: [{ type: 'none' }], tradeoff: '' },
  ],
  recommendation: { optionId: 'move', rationale: '조사 Agent가 바쁩니다', evidence: [] },
  impact: { taskIds: [taskId], blockedTaskIds: [taskId] }, sourceMessageIds: [], remindAt: iso(24),
});

it('work blocked four hours gets one stuck_work request to the decider; sweeping again adds nothing and nothing restarts', async () => {
  const f = await fixture();
  await f.blockResearch(0);

  const posts = await f.pm.sweep(at(5));

  const events = await f.events();
  const [request] = requestsOf(events);
  expect(requestsOf(events)).toHaveLength(1);
  expect(request).toMatchObject({ kind: 'stuck_work', targetMemberId: 'owner', impact: { blockedTaskIds: ['research'] }, recommendation: { optionId: 'retry' } });
  expect(request!.options.map(o => o.optionId)).toEqual(expect.arrayContaining(['retry', 'hold']));
  expect(request!.options.find(o => o.optionId === 'retry')!.effects).toEqual([{ type: 'resolve_task', taskId: 'research', action: 'retry' }]);
  expect(posts).toHaveLength(1);
  expect(posts[0]!.text).toContain('@사용자 "예약 서비스 대안 조사" 작업이 5시간 넘게 멈춰 있어요');
  expect(events.findLast(e => e.type === 'pm_spoke')).toMatchObject({ payload: { requestId: request!.requestId, taskIds: ['research'], kind: 'ask' } });
  const state = project(events);
  expect(workStatus(state.tasks.get('research')!, state)).toBe('waiting_human');

  const count = events.length;
  expect(await f.pm.sweep(at(5))).toEqual([]);
  expect(await f.pm.sweep(at(6))).toEqual([]);
  const after = await f.events();
  expect(after).toHaveLength(count);
  expect(requestsOf(after)).toHaveLength(1);
  expect(project(after).tasks.get('research')?.status).toBe('blocked');
  expect(after.some(e => e.type === 'task_resumed' || e.type === 'task_start_reserved' && e.at > iso(0))).toBe(false);
  expect(f.connector.starts).toHaveLength(0);
  expect(f.connector.continued).toHaveLength(0);
});

it('the stuck card offers cancelling work nothing depends on, and choosing it cancels through the coordinator', async () => {
  const f = await fixture({ tasks: [TASKS[0]!] });
  await f.blockResearch(0);
  await f.pm.sweep(at(5));
  const [request] = requestsOf(await f.events());
  expect(request!.options.map(o => o.optionId)).toEqual(['retry', 'cancel', 'hold']);
  await f.pm.decideRequest(request!.requestId, { by: 'owner', action: 'choose', optionId: 'cancel' });
  const state = await f.state();
  expect(state.tasks.get('research')?.status).toBe('cancelled');
  expect(state.decisionRequests.get(request!.requestId)?.status).toBe('chose_other');
});

it('work others depend on is never offered for cancelling (the plan would break)', async () => {
  const f = await fixture();
  await f.blockResearch(0);
  await f.pm.sweep(at(5));
  expect(requestsOf(await f.events())[0]!.options.map(o => o.optionId)).toEqual(['retry', 'hold']);
});

it('work blocked less than four hours is left alone', async () => {
  const f = await fixture();
  await f.blockResearch(0);
  expect(await f.pm.sweep(at(3))).toEqual([]);
  expect(requestsOf(await f.events())).toHaveLength(0);
});

it('an unanswered request is reminded once at remindAt, then expires and its work stays paused (Q3 default)', async () => {
  const f = await fixture();
  await f.request(reassignRequest('research'), 0);

  expect(await f.pm.sweep(at(23))).toEqual([]);
  const reminded = await f.pm.sweep(at(25));
  expect(reminded.map(p => p.text)).toEqual(['@사용자 아직 답을 기다리는 결정이 있어요: 조사 작업을 프로토타입 Agent에게 넘길까요?']);
  const reminder = (await f.events()).find(e => e.idempotencyKey === decisionReminderKey('req-move'));
  expect(reminder).toMatchObject({ type: 'pm_spoke', at: iso(25), payload: { requestId: 'req-move', kind: 'ask' } });
  expect(await f.pm.sweep(at(30))).toEqual([]);
  expect((await f.events()).filter(e => e.type === 'pm_spoke')).toHaveLength(1);

  await f.pm.sweep(at(49));
  const state = await f.state();
  expect(state.decisionRequests.get('req-move')).toMatchObject({ status: 'expired', resolution: { outcome: 'expired' } });
  expect((await f.events()).find(e => e.type === 'decision_resolved')?.idempotencyKey).toBe(`sweep:decision_expire:req-move:${at(49).toISOString().slice(0, 10)}`);
  // Never applied by silence; the work stays paused for a person.
  expect(state.plan!.version).toBe(1);
  expect(pausedTaskIds(state).has('research')).toBe(true);
  expect(await f.pm.sweep(at(50))).toEqual([]);
});

it('one setting switches expiry to applying the recommendation (Q3 apply_recommendation)', async () => {
  const f = await fixture({ decisionSettings: { unanswered: 'apply_recommendation' } });
  await f.request(reassignRequest('research'), 0);
  await f.pm.sweep(at(25));
  await f.pm.sweep(at(49));
  const state = await f.state();
  expect(state.decisionRequests.get('req-move')?.status).toBe('expired');
  expect(state.plan!.version).toBe(2);
  expect(state.plan!.tasks.find(t => t.id === 'research')?.assignee).toBe('proto-agent');
});

it('a request whose work was cancelled is withdrawn', async () => {
  const f = await fixture();
  await f.request(reassignRequest('flow'), 0);
  await f.store.append([{ ...f.ctx, actor: { kind: 'human', id: 'owner' }, type: 'plan_committed', at: iso(1), payload: { version: 2, basedOn: 1, reason: '흐름 설계 취소', approvedBy: 'owner', sourceMessageIds: [], tasks: [TASKS[0]!] } }]);
  expect(await f.pm.sweep(at(2))).toEqual([]);
  expect((await f.state()).decisionRequests.get('req-move')).toMatchObject({ status: 'withdrawn', resolution: { note: '관련 작업이 이미 끝났거나 취소됐습니다' } });
});

it('todo work whose assignee is not on the team gets one assignment request, asked of the person it would go to (Q2)', async () => {
  const f = await fixture({ tasks: [...TASKS, { id: 'ops', title: '예약 운영 정리', assignee: 'ghost', dependsOn: [], handoffConditions: ['운영 체크리스트'] }] });
  const posts = await f.pm.sweep(at(1));
  const [request] = requestsOf(await f.events());
  expect(request).toMatchObject({ kind: 'assignment', targetMemberId: 'owner', impact: { blockedTaskIds: ['ops'] }, recommendation: { optionId: 'person' } });
  expect(posts[0]!.text).toContain('"예약 운영 정리" 작업을 맡을 담당이 팀에 없어');
  expect(request!.options.find(o => o.optionId === 'person')).toMatchObject({ label: '제가 맡기', effects: [{ type: 'plan_ops', ops: [{ type: 'reassign', taskId: 'ops', assignee: 'owner' }] }] });
  expect(await f.pm.sweep(at(2))).toEqual([]);
  expect(requestsOf(await f.events())).toHaveLength(1);
});
