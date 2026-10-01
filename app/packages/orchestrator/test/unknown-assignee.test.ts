import { afterEach, expect, it } from 'vitest';
import { project, type AnyEvent, type EventPayloads, type NewLedgerEvent, type TaskSpec } from '@ensemble/core';
import type { LlmProvider } from '@ensemble/llm';
import type { ContinueTaskInput, SessionConnector, SessionEvent, TaskInstructionsInput, UpdateInstructionsInput } from '@ensemble/agents';
import { MemoryLedgerStore } from '@ensemble/store';
import { ProjectManager } from '../src/pm.ts';

// Work whose assignee is not (or no longer) a team member must never crash the PM loop: the coordinator
// forecasts it on whoever routing would give it now, and asks the decider when no agent can take it.
let n = 0;
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

class FakeConnector implements SessionConnector {
  async startSession(agentId: string) { return { threadId: `thread-${agentId}`, workspace: `/workspace/${agentId}` }; }
  async startTask(_agentId: string, _input: TaskInstructionsInput) { return 'turn-1'; }
  async sendUpdate(_agentId: string, _input: UpdateInstructionsInput) { return { sent: true as const }; }
  async continueTask(_agentId: string, _input: ContinueTaskInput) { return 'turn-2'; }
  onEvent(_handler: (event: SessionEvent) => void) { return () => undefined; }
  async stop() { /* nothing to stop */ }
}

const T0 = Date.parse('2026-10-01T00:00:00.000Z');
const at = (hours: number) => new Date(T0 + hours * 3_600_000);
const iso = (hours: number) => at(hours).toISOString();
const BASE: TaskSpec[] = [
  { id: 'research', title: '예약 서비스 대안 조사', assignee: 'research-agent', dependsOn: [], handoffConditions: ['대안 2개가 표로 비교되어 있다'] },
  { id: 'flow', title: '흐름 설계', assignee: 'designer', dependsOn: ['research'], handoffConditions: ['화면 목록'] },
];
const orphan = (assignee: string): TaskSpec => ({ id: 'ops', title: '예약 운영 정리', assignee, dependsOn: [], handoffConditions: ['운영 체크리스트'] });

async function fixture(tasks: TaskSpec[]) {
  const ctx = { projectId: `unknown-assignee-${++n}`, targetProductId: 'product' };
  const llm: LlmProvider = { async complete(request) { throw new Error(`Unexpected call ${request.forceTool}`); } };
  const store = new MemoryLedgerStore();
  const pm = new ProjectManager({ ...ctx, store, llm, connector: new FakeConnector(), model: 'fake' });
  cleanup.push(() => pm.stop());
  const owner = { kind: 'human' as const, id: 'owner' };
  const seed = (type: NewLedgerEvent['type'], payload: unknown, hours = -48, actor: NewLedgerEvent['actor'] = owner): NewLedgerEvent => ({ ...ctx, type, actor, payload, at: iso(hours) });
  await store.append([
    seed('member_joined', { memberId: 'owner', kind: 'human', displayName: '사용자' }),
    seed('member_joined', { memberId: 'designer', kind: 'human', displayName: '디자이너' }),
    seed('member_joined', { memberId: 'research-agent', kind: 'agent', displayName: '조사 Agent', role: 'research-agent' }),
    seed('member_joined', { memberId: 'ops-bot', kind: 'agent', displayName: '운영 Agent', role: 'ops-agent' }),
    seed('goal_set', { text: 'PT 예약 프로토타입', decider: 'owner', delegation: { pmMayApply: [] } }),
    seed('plan_committed', { version: 1, basedOn: null, reason: 'approved', approvedBy: 'owner', sourceMessageIds: [], tasks }),
  ]);
  const events = async () => await store.read({ projectId: ctx.projectId }) as AnyEvent[];
  const request = (payload: EventPayloads['decision_requested'], hours: number) =>
    store.append([{ ...seed('decision_requested', payload, hours, { kind: 'pm', id: 'pm' }), idempotencyKey: `decision:${payload.requestId}` }]);
  return { pm, events, request };
}
const requestsOf = (events: AnyEvent[]) => events.flatMap(e => e.type === 'decision_requested' ? [e.payload] : []);
/** An unrelated plan change the decider approves while the orphaned work is still in the plan. */
const priorityRequest: EventPayloads['decision_requested'] = {
  requestId: 'req-priority', kind: 'plan_change', targetMemberId: 'owner', question: '흐름 설계를 먼저 할까요?',
  options: [
    { optionId: 'apply', label: '반영', effects: [{ type: 'plan_ops', ops: [{ type: 'set_priority', taskId: 'flow', priority: 'high', sourceMessageIds: [] }] }], tradeoff: '' },
    { optionId: 'hold', label: '보류', effects: [{ type: 'none' }], tradeoff: '' },
  ],
  recommendation: { optionId: 'apply', rationale: '디자이너가 먼저 시작할 수 있어요', evidence: [] },
  impact: { taskIds: ['flow'], blockedTaskIds: [] }, sourceMessageIds: [], remindAt: iso(24),
};

it('approving the assignment request for work whose assignee left the team reassigns it and closes the request', async () => {
  const f = await fixture([...BASE, orphan('ghost')]);
  await f.pm.sweep(at(1));
  const [request] = requestsOf(await f.events());
  expect(request).toMatchObject({ kind: 'assignment', impact: { blockedTaskIds: ['ops'] } });

  await f.pm.decideRequest(request!.requestId, { by: 'owner', action: 'approve' });

  const state = project(await f.events());
  expect(state.plan!.version).toBe(2);
  expect(state.plan!.tasks.find(t => t.id === 'ops')?.assignee).toBe('owner');
  expect(state.decisionRequests.get(request!.requestId)?.status).not.toBe('open');
});

it('an approval while orphaned work no agent can take is in the plan applies, and asks the decider to assign that work', async () => {
  const f = await fixture([...BASE, orphan('ghost')]);
  await f.request(priorityRequest, 0);

  const posts = await f.pm.decideRequest('req-priority', { by: 'owner', action: 'approve' });

  const events = await f.events();
  const state = project(events);
  expect(state.tasks.get('flow')?.meta?.priority).toBe('high');
  expect(state.decisionRequests.get('req-priority')?.status).not.toBe('open');
  const assignment = requestsOf(events).find(r => r.kind === 'assignment');
  expect(assignment).toMatchObject({
    targetMemberId: 'owner', impact: { taskIds: ['ops'], blockedTaskIds: ['ops'] },
    recommendation: { optionId: 'person' },
    options: [
      { optionId: 'person', effects: [{ type: 'plan_ops', ops: [{ type: 'reassign', taskId: 'ops', assignee: 'owner' }] }] },
      { optionId: 'hold', effects: [{ type: 'none' }] },
    ],
  });
  expect(assignment!.recommendation.rationale.trim()).not.toBe('');
  expect(state.decisionRequests.get(assignment!.requestId)?.status).toBe('open');
  expect(posts.some(p => p.kind === 'ask' && p.text.includes('예약 운영 정리'))).toBe(true);
});

it('orphaned work a capable agent could take does not crash the loop and opens no extra request from the coordinator', async () => {
  const f = await fixture([...BASE, orphan('ops-agent')]);
  await f.request(priorityRequest, 0);

  await f.pm.decideRequest('req-priority', { by: 'owner', action: 'approve' });

  const events = await f.events();
  expect(project(events).tasks.get('flow')?.meta?.priority).toBe('high');
  expect(requestsOf(events).map(r => r.requestId)).toEqual(['req-priority']);
});
