import { afterEach, expect, it, vi } from 'vitest';
import { project, workStatus, type AnyEvent, type DecisionOption, type EventPayloads, type NewLedgerEvent } from '@ensemble/core';
import type { LlmProvider, LlmRequest } from '@ensemble/llm';
import type { ContinueTaskInput, SessionConnector, SessionEvent, TaskInstructionsInput, UpdateInstructionsInput } from '@ensemble/agents';
import { MemoryLedgerStore } from '@ensemble/store';
import { ProjectManager } from '../src/pm.ts';
import { DecisionRequestError } from '../src/decision-flow.ts';
import { questionRequestId } from '../src/dispatch.ts';

// MC2 (§2.7, §5 acceptance 1, 2, 6): a person's answer to a decision request runs its effects through the
// existing paths — confirmed plan ops, task resolution, the answer relay — and closes the request.
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

type Route = Record<string, unknown>;
async function fixture(options: { route?: Route } = {}) {
  const ctx = { projectId: `decision-flow-${++n}`, targetProductId: 'product' };
  const requests: LlmRequest[] = [];
  const llm: LlmProvider = { async complete(request) {
    requests.push(request);
    if (request.forceTool !== 'route_message') throw new Error(`Unexpected call ${request.forceTool}`);
    return { text: '', model: 'fake', responseId: `r${requests.length}`, usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [{ name: 'route_message', input: options.route ?? { kind: 'chat' } }] };
  } };
  const store = new MemoryLedgerStore();
  const connector = new FakeConnector();
  const pm = new ProjectManager({ ...ctx, store, llm, connector, model: 'fake' });
  cleanup.push(() => pm.stop());
  const owner = { kind: 'human' as const, id: 'owner' };
  await store.append([
    { ...ctx, actor: owner, type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: '사용자' } },
    { ...ctx, actor: owner, type: 'member_joined', payload: { memberId: 'designer', kind: 'human', displayName: '디자이너' } },
    { ...ctx, actor: owner, type: 'member_joined', payload: { memberId: 'research-agent', kind: 'agent', displayName: '조사 Agent' } },
    { ...ctx, actor: owner, type: 'member_joined', payload: { memberId: 'proto-agent', kind: 'agent', displayName: '프로토타입 Agent' } },
    { ...ctx, actor: owner, type: 'member_joined', payload: { memberId: 'qa-agent', kind: 'agent', displayName: 'QA Agent' } },
    { ...ctx, actor: owner, type: 'goal_set', payload: { text: 'PT 예약 프로토타입', decider: 'owner', delegation: { pmMayApply: [] } } },
    { ...ctx, actor: owner, type: 'plan_committed', payload: { version: 1, basedOn: null, reason: 'approved', approvedBy: 'owner', sourceMessageIds: [], tasks: [
      { id: 'research', title: '예약 서비스 대안 조사', assignee: 'research-agent', dependsOn: [], handoffConditions: ['대안 2개가 표로 비교되어 있다'] },
      { id: 'flow', title: '흐름 설계', assignee: 'designer', dependsOn: ['research'], handoffConditions: ['화면 목록'] },
    ] } },
  ]);
  const events = async () => await store.read({ projectId: ctx.projectId }) as AnyEvent[];
  const state = async () => project(await events());
  const request = async (payload: Omit<EventPayloads['decision_requested'], 'sourceMessageIds'> & { sourceMessageIds?: string[] }) => {
    await store.append([{ ...ctx, actor: { kind: 'pm', id: 'pm' }, type: 'decision_requested', idempotencyKey: `decision:${payload.requestId}`, payload: { sourceMessageIds: [], ...payload } } as NewLedgerEvent]);
    expect((await state()).decisionRequests.get(payload.requestId)?.status).toBe('open');
  };
  return { ctx, pm, store, connector, requests, events, state, request };
}

const hold: DecisionOption = { optionId: 'hold', label: '보류', effects: [{ type: 'none' }], tradeoff: '그대로 둡니다' };
const reassignCard = (requestId = 'req-move') => ({
  requestId, kind: 'plan_change' as const, targetMemberId: 'owner', question: '조사 작업을 프로토타입 Agent에게 넘길까요?',
  options: [
    { optionId: 'move', label: '프로토타입 Agent에게 맡기기', effects: [{ type: 'plan_ops' as const, ops: [{ type: 'reassign' as const, taskId: 'research', assignee: 'proto-agent', sourceMessageIds: [] }] }], tradeoff: '조사 Agent는 쉬게 됩니다' },
    { optionId: 'narrow', label: '결제 빼고 진행', effects: [{ type: 'plan_ops' as const, ops: [{ type: 'exclude_scope' as const, taskId: 'research', item: '결제', sourceMessageIds: [] }] }], tradeoff: '결제 비교가 빠집니다' },
    hold,
  ],
  recommendation: { optionId: 'move', rationale: '조사 Agent가 다른 일을 하고 있습니다', evidence: ['m1'] },
  impact: { taskIds: ['research'], blockedTaskIds: ['research'] }, editable: ['assignee' as const],
});
const planTask = (state: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['state']>>, id: string) => state.plan!.tasks.find(t => t.id === id)!;

it('approve: the recommended plan ops apply through the coordinator, the request closes and the work stops waiting on the person', async () => {
  const f = await fixture();
  await f.request(reassignCard());
  const before = await f.state();
  expect(workStatus(before.tasks.get('research')!, before)).toBe('waiting_human');

  const posts = await f.pm.decideRequest('req-move', { by: 'owner', action: 'approve' });

  const after = await f.state();
  expect(after.plan!.version).toBe(2);
  expect(planTask(after, 'research').assignee).toBe('proto-agent');
  expect(after.decisionRequests.get('req-move')).toMatchObject({ status: 'approved', resolution: { outcome: 'approved', optionId: 'move', by: 'owner' } });
  expect(workStatus(after.tasks.get('research')!, after)).toBe('todo');
  expect(posts.map(p => p.text).join('\n')).toContain('정리하면');
  // The person's answer is the authority the confirmed operation carries.
  const committed = (await f.events()).findLast(e => e.type === 'plan_committed')!;
  expect(committed.type === 'plan_committed' && committed.payload.sourceMessageIds).toEqual(['decision-answer:req-move']);
  // A repeated click is a no-op.
  expect(await f.pm.decideRequest('req-move', { by: 'owner', action: 'approve' })).toEqual([]);
  expect((await f.state()).plan!.version).toBe(2);
});

it('choose another option: that option\'s effects apply instead of the recommendation', async () => {
  const f = await fixture();
  await f.request(reassignCard());
  await f.pm.decideRequest('req-move', { by: 'owner', action: 'choose', optionId: 'narrow' });
  const after = await f.state();
  expect(planTask(after, 'research')).toMatchObject({ assignee: 'research-agent', exclusions: ['결제'] });
  expect(after.decisionRequests.get('req-move')).toMatchObject({ status: 'chose_other', resolution: { optionId: 'narrow' } });
  expect(workStatus(after.tasks.get('research')!, after)).toBe('todo');
});

it('edit: only the editable field changes, the edited ops are re-validated, and an edit the answerer cannot authorize is refused with the request left open', async () => {
  const f = await fixture();
  await f.request(reassignCard());
  // Moving the work onto another person needs that person's own acceptance: the decider cannot commit them.
  const refused = await f.pm.decideRequest('req-move', { by: 'owner', action: 'edit', edits: { assignee: 'designer' } }).catch(error => error);
  expect(refused).toBeInstanceOf(DecisionRequestError);
  expect(refused).toMatchObject({ status: 400 });
  expect(refused.message).toContain('디자이너님의 승인');
  expect((await f.state()).decisionRequests.get('req-move')?.status).toBe('open');
  expect((await f.state()).plan!.version).toBe(1);

  await f.pm.decideRequest('req-move', { by: 'owner', action: 'edit', edits: { assignee: 'qa-agent' } });
  const after = await f.state();
  expect(planTask(after, 'research').assignee).toBe('qa-agent');
  expect(after.decisionRequests.get('req-move')).toMatchObject({ status: 'edited', resolution: { edits: { assignee: 'qa-agent' } } });
});

it('reject: nothing applies, the request closes as rejected and the work is released', async () => {
  const f = await fixture();
  await f.request(reassignCard());
  expect(await f.pm.decideRequest('req-move', { by: 'owner', action: 'reject', note: '지금은 그대로' })).toEqual([]);
  const after = await f.state();
  expect(after.plan!.version).toBe(1);
  expect(after.decisionRequests.get('req-move')).toMatchObject({ status: 'rejected', resolution: { note: '지금은 그대로' } });
  expect(workStatus(after.tasks.get('research')!, after)).toBe('todo');
});

it('only the asked person answers, and an unknown request is not found', async () => {
  const f = await fixture();
  await f.request(reassignCard());
  await expect(f.pm.decideRequest('req-move', { by: 'designer', action: 'approve' })).rejects.toMatchObject({ status: 403 });
  await expect(f.pm.decideRequest('nope', { by: 'owner', action: 'approve' })).rejects.toMatchObject({ status: 404 });
  expect((await f.state()).decisionRequests.get('req-move')?.status).toBe('open');
});

it('stuck_work: approving the retry resumes the stopped work through a resolve_task effect and hands it back to the agent', async () => {
  const f = await fixture();
  await f.pm['dispatcher'].startReady('kickoff');
  expect((await f.state()).tasks.get('research')?.status).toBe('running');
  await f.store.append([{ ...f.ctx, actor: { kind: 'system', id: 'session-runner' }, type: 'task_blocked', payload: { taskId: 'research', reason: 'Agent 턴이 시간 제한을 넘겼습니다' } }]);
  await f.request({ requestId: 'req-stuck', kind: 'stuck_work', targetMemberId: 'owner', question: '"예약 서비스 대안 조사" 작업이 5시간 넘게 멈춰 있어요. 어떻게 할까요?',
    options: [{ optionId: 'retry', label: '다시 맡기기', effects: [{ type: 'resolve_task', taskId: 'research', action: 'retry' }], tradeoff: '같은 담당이 이어서 합니다' }, hold],
    recommendation: { optionId: 'retry', rationale: '실행이 멈춘 경우입니다', evidence: [] }, impact: { taskIds: ['research'], blockedTaskIds: ['research'] } });

  const posts = await f.pm.decideRequest('req-stuck', { by: 'owner', action: 'approve' });

  const after = await f.state();
  expect(after.tasks.get('research')?.status).toBe('running');
  expect(after.decisionRequests.get('req-stuck')?.status).toBe('approved');
  expect(workStatus(after.tasks.get('research')!, after)).toBe('in_progress');
  expect((await f.events()).some(e => e.type === 'task_resumed' && e.payload.taskId === 'research')).toBe(true);
  expect(posts.map(p => p.text)).toEqual(['"예약 서비스 대안 조사"를 조사 Agent에게 다시 맡겼어요. 보완 횟수는 새로 셉니다.']);
  expect([...f.connector.updates, ...f.connector.continued].length).toBe(1);
});

it('decideCard accepts a decision request id and routes it to the decision flow (approve and reject)', async () => {
  const f = await fixture();
  await f.request(reassignCard('req-a'));
  await f.pm.decideCard('req-a', 'owner', true);
  expect((await f.state()).decisionRequests.get('req-a')?.status).toBe('approved');
  expect(planTask(await f.state(), 'research').assignee).toBe('proto-agent');

  await f.request({ ...reassignCard('req-b'), options: [{ ...reassignCard().options[1]! }, hold], recommendation: { optionId: 'narrow', rationale: '범위를 줄입니다', evidence: [] } });
  await f.pm.decideCard('req-b', 'owner', false);
  expect((await f.state()).decisionRequests.get('req-b')?.status).toBe('rejected');
  expect(planTask(await f.state(), 'research').exclusions ?? []).toEqual([]);
});

it('an agent question becomes a missing_info request; the answer on the card reaches the agent verbatim and the work resumes', async () => {
  const f = await fixture();
  await f.pm['dispatcher'].startReady('kickoff');
  const asked = await f.pm['dispatcher'].onQuestion('research', '결제 대안도 비교에 넣을까요?');
  const requestId = questionRequestId(asked.questionId);
  const waiting = await f.state();
  expect(waiting.decisionRequests.get(requestId)?.request).toMatchObject({ kind: 'missing_info', targetMemberId: 'owner', impact: { blockedTaskIds: ['research'] },
    recommendation: { optionId: 'answer', evidence: [asked.questionId] } });
  expect(waiting.tasks.get('research')?.status).toBe('running');
  expect(workStatus(waiting.tasks.get('research')!, waiting)).toBe('waiting_human');
  const spoke = (await f.events()).findLast(e => e.type === 'pm_spoke')!;
  expect(spoke.type === 'pm_spoke' && spoke.payload).toMatchObject({ messageId: asked.questionId, requestId, taskIds: ['research'], kind: 'ask' });

  const answer = '네, 결제 대안도 표에 넣어 주세요';
  await f.pm.decideRequest(requestId, { by: 'owner', action: 'answer', text: answer });

  const after = await f.state();
  expect(after.decisionRequests.get(requestId)).toMatchObject({ status: 'answered', resolution: { answerText: answer } });
  expect(workStatus(after.tasks.get('research')!, after)).toBe('in_progress');
  const notified = (await f.events()).findLast(e => e.type === 'change_notified')!;
  expect(notified.type === 'change_notified' && notified.payload).toMatchObject({ recipientId: 'research-agent', text: answer, via: 'steer' });
  expect(f.connector.updates.at(-1)?.input.change.join('\n')).toContain(answer);
});

it('a missing_info request is never closed by approving or picking its answer option without words (any caller)', async () => {
  const f = await fixture();
  await f.pm['dispatcher'].startReady('kickoff');
  const asked = await f.pm['dispatcher'].onQuestion('research', '결제 대안도 비교에 넣을까요?');
  const requestId = questionRequestId(asked.questionId);
  for (const answer of [{ by: 'owner', action: 'approve' as const }, { by: 'owner', action: 'choose' as const, optionId: 'answer' }]) {
    const refused = await f.pm.decideRequest(requestId, answer).then(() => undefined, (error: unknown) => error);
    expect(refused).toBeInstanceOf(DecisionRequestError);
    expect(refused).toMatchObject({ code: 'invalid_input', status: 400 });
  }
  const after = await f.state();
  expect(after.decisionRequests.get(requestId)?.status).toBe('open');
  expect(workStatus(after.tasks.get('research')!, after)).toBe('waiting_human');
  expect(f.connector.updates).toEqual([]);
  // The PM can still withdraw it.
  await f.pm.decideRequest(requestId, { by: 'pm', action: 'withdraw' });
  expect((await f.state()).decisionRequests.get(requestId)?.status).toBe('withdrawn');
});

it('a question answered in the channel closes its request as answered, and the next open question gets its own request', async () => {
  const f = await fixture({ route: { kind: 'answer', taskId: 'research', questionId: 'question:research:1' } });
  await f.pm['dispatcher'].startReady('kickoff');
  const first = await f.pm['dispatcher'].onQuestion('research', '결제 대안도 비교에 넣을까요?');
  const second = await f.pm['dispatcher'].onQuestion('research', '비교표는 몇 개 서비스까지 볼까요?');
  expect(first.questionId).toBe('question:research:1');
  // One open request per task: the second question waits for the first to close.
  expect((await f.state()).decisionRequests.has(questionRequestId(second.questionId))).toBe(false);

  vi.spyOn(f.pm['coordinator'], 'onMessage').mockResolvedValue({ posts: [], events: [] });
  await f.pm.postMessage('owner', '네, 넣어 주세요');

  const after = await f.state();
  expect(after.decisionRequests.get(questionRequestId(first.questionId))).toMatchObject({ status: 'answered', resolution: { by: 'owner', answerText: '네, 넣어 주세요' } });
  expect(after.decisionRequests.get(questionRequestId(second.questionId))).toMatchObject({ status: 'open', request: { kind: 'missing_info', targetMemberId: 'owner' } });
});

it('approving new work (create_task) records its origin with the request and starts the agent work it reserved', async () => {
  const f = await fixture();
  await f.store.append([{ ...f.ctx, actor: { kind: 'human', id: 'designer' }, type: 'message_recorded', payload: { messageId: 'm-login', authorId: 'designer', text: '로그인 화면도 만들어 주세요', attachmentIds: [] } }]);
  const draft = { tempId: 'login', title: '로그인 화면 시안', assignee: 'proto-agent', handoffConditions: ['로그인 화면 1개'], dependsOn: [], priority: 'normal' as const,
    routing: { executor: 'agent' as const, reason: 'agent_capable' as const, note: '프로토타입 Agent가 할 수 있는 일' },
    brief: { why: '예약 전에 로그인이 필요하다', sourceMessageIds: ['m-login'], decisionIds: [], attachmentIds: [], constraints: [] } };
  await f.request({ requestId: 'req-login', kind: 'plan_change', targetMemberId: 'owner', question: '디자이너가 요청한 로그인 화면 작업을 추가할까요?',
    options: [{ optionId: 'add', label: '작업 추가', effects: [{ type: 'plan_ops', ops: [{ type: 'create_task', ...draft, sourceMessageIds: ['m-login'] }] }], tradeoff: '범위가 늘어납니다' }, hold],
    recommendation: { optionId: 'add', rationale: '예약 흐름에 필요합니다', evidence: ['m-login'] }, impact: { taskIds: ['login'], blockedTaskIds: [] }, sourceMessageIds: ['m-login'] });

  await f.pm.decideRequest('req-login', { by: 'owner', action: 'approve' });

  const after = await f.state();
  expect(after.decisionRequests.get('req-login')?.status).toBe('approved');
  expect(after.tasks.get('login')?.meta?.origin).toMatchObject({ decisionRequestId: 'req-login' });
  expect(after.tasks.get('login')?.status).toBe('running');
  expect(f.connector.starts.map(s => [s.agentId, s.input.taskId])).toContainEqual(['proto-agent', 'login']);
});

it('work the coordinator reserved while handling a chat message is started by the PM (CoordinationResult.starts)', async () => {
  const f = await fixture();
  await f.store.append([{ ...f.ctx, actor: { kind: 'pm', id: 'pm' }, type: 'task_start_reserved', payload: { taskId: 'research', specVersion: 1, trigger: 'chat' } }]);
  vi.spyOn(f.pm['coordinator'], 'onMessage').mockResolvedValue({ posts: [], events: [], starts: ['research'] });
  await f.pm.postMessage('owner', '조사 작업 바로 시작해 주세요');
  expect((await f.state()).tasks.get('research')?.status).toBe('running');
  expect(f.connector.starts.map(s => s.input.taskId)).toEqual(['research']);
});
