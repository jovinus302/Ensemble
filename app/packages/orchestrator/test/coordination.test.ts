import { expect, it, vi } from 'vitest';
import { MemoryLedgerStore } from '@ensemble/store';
import { project } from '@ensemble/core';
import type { AnyEvent, EventPayloads, EventType, TaskSpec, PlanOp } from '@ensemble/core';
import type { LlmProvider, LlmRequest, LlmResponse } from '@ensemble/llm';
import { Coordinator } from '../src/coordination.ts';
import type { CoordinationInterpretation, CoordinationJudgement } from '../src/coordination.ts';

const ctx = { projectId: 'coordination', targetProductId: 'product', clock: () => new Date('2026-09-28T00:00:00Z') };
const task = (id: string, assignee: string, conditions: string[] = []): TaskSpec => ({ id, title: id, assignee, dependsOn: [], handoffConditions: conditions });
const initialTasks = [task('prototype', 'agent', ['초안', '결제']), task('design', 'designer', ['초안', '결제']), task('review', 'outside', ['결제'])];
const interpret = (patch: Partial<CoordinationInterpretation> = {}): CoordinationInterpretation => ({ category: 'question', summary: '결제 제외, 초안으로 계속', ops: [], conflicts: [], ...patch });
const exclusions = (sourceMessageIds = ['m1']): PlanOp[] => initialTasks.map(t => ({ type: 'exclude_scope', taskId: t.id, item: '결제', sourceMessageIds }));
const judge = (patch: Partial<CoordinationJudgement> = {}): CoordinationJudgement => ({ whoseAction: 'designer: 다음 작업 선택', alreadyKnows: 'no', evidence: ['msg:m1'], decision: 'speak', reason: '계산된 영향으로 다음 행동을 고른다', openTopics: [], text: '계산 결과를 확인해 주세요.', ...patch });
function fake(responses: (object | null | ((r: LlmRequest) => object | null))[]) {
  responses = [...responses];
  const calls: LlmRequest[] = [];
  const llm: LlmProvider = { async complete(request): Promise<LlmResponse> {
    calls.push(request);
    const next = responses.shift();
    const input = typeof next === 'function' ? next(request) : next;
    return { text: '', toolCalls: input ? [{ name: request.forceTool!, input: input as Record<string, unknown> }] : [], model: 'fake', responseId: `r${calls.length}`, usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  return { llm, calls };
}
async function fixture(responses: Parameters<typeof fake>[0], tasks = initialTasks, messageText = 'ㅇㅋ 결제는 빼자', authorId = 'owner') {
  const store = new MemoryLedgerStore();
  const add = async <K extends EventType>(type: K, payload: EventPayloads[K], pm = false) => store.append([{ projectId: ctx.projectId, targetProductId: ctx.targetProductId, actor: { kind: pm ? 'pm' : 'human', id: 'owner' }, type, payload }]);
  for (const memberId of ['owner', 'designer', 'outside', 'agent']) await add('member_joined', { memberId, kind: memberId === 'agent' ? 'agent' : 'human', displayName: memberId });
  await add('goal_set', { text: '시제품', deadline: '2026-10-05T00:00:00Z', decider: 'owner', delegation: { pmMayApply: ['scope_reduce', 'reorder', 'reassign_agent'] } });
  await add('plan_committed', { version: 1, basedOn: null, tasks, reason: '초기 합의', approvedBy: 'owner', sourceMessageIds: [] });
  for (const spec of tasks) await add('estimate_updated', { taskId: spec.id, hours: { min: 10, max: 10 }, source: 'human' });
  for (const memberId of ['designer', 'outside']) await add('availability_updated', { memberId, weeklyHours: 10 });
  if (tasks.some(t => t.id === 'prototype')) {
    await add('task_start_reserved', { taskId: 'prototype', specVersion: 1, trigger: 'initial' });
    await add('task_started', { taskId: 'prototype', turnId: 'turn-1' });
  }
  const message = (messageId = 'm1', authorId = 'owner', text = 'ㅇㅋ 결제는 빼자') => add('message_recorded', { messageId, authorId, text, attachmentIds: [] });
  await message('m1', authorId, messageText);
  const { llm, calls } = fake(responses);
  const connector = { sendUpdate: vi.fn(async () => ({ sent: true as boolean, reason: 'finished' })) };
  const coordinator = new Coordinator(store, llm, connector, ctx);
  const read = async () => await store.read() as AnyEvent[];
  return { store, add, message, calls, connector, coordinator, read };
}

it('records silence and the three answers while people coordinate a vacation', async () => {
  const f = await fixture([interpret({ category: 'availability', ops: [{ type: 'set_availability', memberId: 'designer', weeklyHours: 5, sourceMessageIds: ['m1'] }] }), judge({ decision: 'silent', whoseAction: null, alreadyKnows: 'yes', text: '', reason: '사람들이 조율 중', openTopics: ['휴가 후 초안'] })], initialTasks, '목요일에 휴가라 상세는 다음 주에 드려도 될까요?', 'designer');
  const r = await f.coordinator.onMessage('m1');
  expect(r.posts).toEqual([]);
  expect(r.events.filter(e => e.type === 'pm_considered')).toEqual([expect.objectContaining({ type: 'pm_considered', payload: expect.objectContaining({ decision: 'silent', whoseAction: null, alreadyKnows: 'yes', evidence: ['msg:m1'], openTopics: ['휴가 후 초안'] }) })]);
  expect(project(await f.read()).automation.actionsSinceResume).toBe(0);
});

it('answers using code-calculated seven-day delay and cites the forecast fact', async () => {
  const f = await fixture([interpret({ ops: [{ type: 'set_availability', memberId: 'designer', weeklyHours: 5, sourceMessageIds: ['m1'] }] }), request => {
    const { facts } = JSON.parse(request.messages[0]!.content);
    expect(facts.impact.deltaDays.max).toBe(7);
    expect(facts.impact.proposed.lateness.maxDays).toBe(7);
    return judge({ text: `주 5시간이면 ${facts.impact.deltaDays.max}일 늦어져요. 초안으로 먼저 진행할까요?`, evidence: ['forecast:candidate'] });
  }], initialTasks, '주 5시간이면 프로토타입이 밀리나?', 'designer');
  const r = await f.coordinator.onMessage('m1');
  expect(r.posts[0]?.text).toContain('7일');
  const considered = r.events.find(e => e.type === 'pm_considered') as AnyEvent;
  expect(considered.payload).toMatchObject({ evidence: ['forecast:candidate'] });
  expect(f.calls.every(r => r.forceTool && r.messages[0]!.content.includes('"planVersion":1') && r.messages[0]!.content.includes('"messageId":"m1"'))).toBe(true);
});

const reduced = initialTasks.map(t => ({ ...t, handoffConditions: t.handoffConditions.filter(c => c !== '결제') }));
it('summarises, commits v2, notifies absent changed people and steers with payment dropped once', async () => {
  const f = await fixture([interpret({ ops: exclusions(['m1', 'designer-agrees']) }), judge()]);
  await f.message('designer-agrees', 'designer', '초안으로 먼저 가세요');
  const r = await f.coordinator.onMessage('m1');
  expect(r.posts[0]).toMatchObject({ kind: 'summary', text: expect.stringContaining('정리하면:') });
  expect(project(await f.read()).plan?.version).toBe(2);
  expect(project(await f.read()).plan?.tasks.map(t => t.title)).toEqual(initialTasks.map(t => t.title));
  expect(f.connector.sendUpdate).toHaveBeenCalledExactlyOnceWith('agent', expect.objectContaining({ fromVersion: 1, toVersion: 2, drop: ['결제'] }));
  expect(r.events.filter(e => e.type === 'change_notified').map(e => (e.payload as EventPayloads['change_notified']).recipientId).sort()).toEqual(['agent', 'outside']);
  expect(r.events.find(e => e.type === 'plan_committed')?.payload).toMatchObject({ sourceMessageIds: ['m1', 'designer-agrees'], basedOn: 1 });
  expect((await f.coordinator.onMessage('m1')).posts).toEqual([]);
  expect(f.connector.sendUpdate).toHaveBeenCalledTimes(1);
});

it('asks the decider about another person’s deadline proposal and leaves the plan unchanged', async () => {
  const f = await fixture([interpret({ ops: [{ type: 'set_deadline', date: '2026-10-10', sourceMessageIds: ['proposal'] }] }), judge()]);
  await f.message('proposal', 'designer', '기한을 옮기면 좋겠어요');
  const r = await f.coordinator.onMessage('m1');
  expect(r.events.find(e => e.type === 'authority_requested')?.payload).toMatchObject({ personId: 'owner', changeKinds: ['deadline_change'] });
  expect(r.posts[0]?.kind).toBe('ask');
  expect(project(await f.read()).plan?.version).toBe(1);
  expect(f.connector.sendUpdate).not.toHaveBeenCalled();
});

it('does not repeat an answer supported by the same evidence', async () => {
  const f = await fixture([interpret(), judge(), interpret(), judge()]);
  await f.coordinator.onMessage('m1');
  await f.message('m2', 'owner', '다시 질문');
  const r = await f.coordinator.onMessage('m2');
  expect(r.posts).toEqual([]);
  expect(r.events[0]?.payload).toMatchObject({ decision: 'silent', reason: '이미 전달한 근거' });
});

it.each([[null, null], [interpret(), null, null], [{ conclusion: true }, { conclusion: true }]])('retries invalid or empty responses once, then records inability without inventing speech: %j', async (...responses) => {
  const f = await fixture(responses);
  const r = await f.coordinator.onMessage('m1');
  expect(r.posts).toEqual([]);
  expect(r.events[0]?.payload).toMatchObject({ decision: 'silent', reason: '판단 불가' });
  expect(f.calls.length).toBe(responses.length);
});

it('records next_turn on steer rejection without cancelling the task', async () => {
  const f = await fixture([interpret({ ops: [{ type: 'exclude_scope', taskId: 'prototype', item: '결제', sourceMessageIds: ['m1'] }] }), judge()]);
  f.connector.sendUpdate.mockResolvedValue({ sent: false, reason: 'turn completed' });
  const r = await f.coordinator.onMessage('m1');
  expect(f.connector.sendUpdate).toHaveBeenCalledWith('agent', expect.objectContaining({ drop: ['결제'] }));
  expect(r.events.find(e => e.type === 'change_notified')?.payload).toMatchObject({ recipientId: 'agent', via: 'next_turn' });
  expect(project(await f.read()).tasks.get('prototype')?.status).toBe('running');
});

it('cannot relabel a human commitment as a delegated reorder', async () => {
  const f = await fixture([interpret({ ops: [{ type: 'set_availability', memberId: 'designer', weeklyHours: 20, sourceMessageIds: ['m1'] }] }), judge()]);
  const r = await f.coordinator.onMessage('m1');
  expect(r.events.find(e => e.type === 'authority_requested')?.payload).toMatchObject({ personId: 'designer' });
  expect(project(await f.read()).availability.get('designer')).toBe(10);
});

it('rejects a stale snapshot when a plan is committed during model judgement', async () => {
  const f = await fixture([interpret({ ops: exclusions() }), judge()]);
  const llm: LlmProvider = { async complete(request) {
    if (request.forceTool === 'judge_coordination') await f.add('plan_committed', { version: 2, basedOn: 1, tasks: initialTasks, approvedBy: 'owner', reason: 'concurrent', sourceMessageIds: [] });
    return { text: '', model: 'fake', responseId: 'r', usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [{ name: request.forceTool!, input: (request.forceTool === 'interpret_coordination' ? interpret({ ops: exclusions() }) : judge()) as unknown as Record<string, unknown> }] };
  } };
  const r = await new Coordinator(f.store, llm, f.connector, ctx).onMessage('m1');
  expect(r.posts).toEqual([]);
  expect(r.events[0]?.payload).toMatchObject({ decision: 'silent', reason: '기록이 변경되어 재판단 필요' });
  expect(project(await f.read()).plan?.reason).toBe('concurrent');
  expect(f.connector.sendUpdate).not.toHaveBeenCalled();
});

it('stops at the automation limit, notifies once, and never commits or steers', async () => {
  const f = await fixture([interpret({ ops: exclusions() }), judge(), interpret(), judge({ evidence: ['msg:m2'] })]);
  for (let i = 0; i < 12; i++) await f.add('reply_recorded', { memberId: 'pm', text: `prior ${i}` }, true);
  const first = await f.coordinator.onMessage('m1');
  await f.message('m2');
  const second = await f.coordinator.onMessage('m2');
  expect(first.posts).toHaveLength(1);
  expect(second.posts).toEqual([]);
  expect((await f.read()).filter(e => e.type === 'action_limit_reached')).toHaveLength(1);
  expect(project(await f.read()).plan?.version).toBe(1);
  expect(f.connector.sendUpdate).not.toHaveBeenCalled();
});

it('preserves prior decisions and plans when a correction becomes v3', async () => {
  const corrected = reduced.map(t => t.id === 'review' ? { ...t, dependsOn: ['prototype'] } : t);
  const f = await fixture([interpret({ ops: exclusions() }), judge(), interpret({ ops: [{ type: 'handoff_early', taskId: 'review', sourceMessageIds: ['m2'] }], summary: '초안 단계 인계' }), judge({ evidence: ['msg:m2'] })]);
  await f.coordinator.onMessage('m1');
  await f.message('m2', 'owner', '아니, 검토는 프로토타입 다음이야');
  await f.coordinator.onMessage('m2');
  const events = await f.read();
  expect(events.filter(e => e.type === 'plan_committed').map(e => e.payload.version)).toEqual([1, 2, 3]);
  expect(events.filter(e => e.type === 'decision_recorded')).toHaveLength(2);
  expect(project(events).messages.find(m => m.messageId === 'm1')?.text).toBe('ㅇㅋ 결제는 빼자');
});

it('records next-turn context for a changed agent that is not running', async () => {
  const f = await fixture([interpret({ ops: exclusions() }), judge()]);
  await f.add('turn_finished', { agentId: 'agent', taskId: 'prototype' });
  const r = await f.coordinator.onMessage('m1');
  expect(r.events.find(e => e.type === 'change_notified' && (e.payload as EventPayloads['change_notified']).recipientId === 'agent')?.payload).toMatchObject({ via: 'next_turn', text: expect.stringContaining('결제') });
  expect(f.connector.sendUpdate).not.toHaveBeenCalled();
  expect(r.posts.some(p => p.text.startsWith('{'))).toBe(false);
});

it('rejects free-form rewrites and unknown task operations', async () => {
  const f = await fixture([{ ...interpret(), tasks: reduced }, interpret({ ops: [{ type: 'handoff_early', taskId: 'missing', sourceMessageIds: ['m1'] }] })]);
  const r = await f.coordinator.onMessage('m1');
  expect(r.posts).toEqual([]);
  expect(r.events[0]?.payload).toMatchObject({ reason: '판단 불가' });
  expect(project(await f.read()).plan?.version).toBe(1);
});

it('rejects fabricated evidence after one retry', async () => {
  const f = await fixture([interpret(), judge({ evidence: ['invented'] }), judge({ evidence: ['invented'] })]);
  const r = await f.coordinator.onMessage('m1');
  expect(r.posts).toEqual([]);
  expect(r.events[0]?.payload).toMatchObject({ reason: '판단 불가' });
});

it('concurrent duplicate deliveries produce one decision and one steer', async () => {
  const responses = [interpret({ ops: exclusions() }), judge()];
  const f = await fixture(responses);
  const second = new Coordinator(f.store, fake(responses).llm, f.connector, ctx);
  const results = await Promise.all([f.coordinator.onMessage('m1'), second.onMessage('m1')]);
  expect(results.flatMap(r => r.events).filter(e => e.type === 'plan_committed')).toHaveLength(1);
  expect(f.connector.sendUpdate).toHaveBeenCalledTimes(1);
});

it('retries evidence outside the enum and speaks with a valid forecast fact', async () => {
  const f = await fixture([interpret(), judge({ evidence: ['impact.deltaDays'] }), request => {
    const { facts } = JSON.parse(request.messages[0]!.content);
    const property = (request.tools![0]!.inputSchema.properties as Record<string, any>).evidence;
    expect(property.items.enum).toContain('forecast:current');
    expect(property.items.enum).not.toContain('impact.deltaDays');
    const forecast = facts.factList.find((f: { id: string }) => f.id === 'forecast:current').value;
    return judge({ evidence: ['forecast:current'], text: `현재 최대 ${forecast.days.max}일 걸립니다.` });
  }]);
  const r = await f.coordinator.onMessage('m1');
  expect(f.calls).toHaveLength(3);
  expect(r.posts[0]?.text).toMatch(/현재 최대 \d+일/);
});

it('records a person’s own availability without asking them again or changing plan version', async () => {
  const f = await fixture([interpret({ ops: [{ type: 'set_availability', memberId: 'designer', weeklyHours: 5, sourceMessageIds: ['self'] }] }), judge({ decision: 'silent', text: '' })]);
  await f.message('self', 'designer', '이번 주 가용 시간은 5시간이에요');
  const r = await f.coordinator.onMessage('self');
  expect(r.events.filter(e => e.type === 'availability_updated')).toHaveLength(1);
  expect(r.events.some(e => e.type === 'authority_requested')).toBe(false);
  expect(project(await f.read()).availability.get('designer')).toBe(5);
  expect(project(await f.read()).plan?.version).toBe(1);
});

it('keeps a designer’s scope suggestion open even when the model wants to speak', async () => {
  const f = await fixture([interpret({ ops: exclusions(['suggestion']) }), judge()]);
  await f.message('suggestion', 'designer', '결제는 빼면 좋겠어요');
  await f.coordinator.onMessage('suggestion');
  const state = project(await f.read());
  expect(state.plan?.version).toBe(1);
  expect(state.openTopics.join(' ')).toContain('결제');
  expect(state.openTopics.join(' ')).toContain('owner');
  expect(f.connector.sendUpdate).not.toHaveBeenCalled();
});

it('applies consented availability separately from a scope approval request', async () => {
  const f = await fixture([interpret({ ops: [{ type: 'set_availability', memberId: 'designer', weeklyHours: 5, sourceMessageIds: ['self'] }, ...exclusions(['self'])] }), judge()]);
  await f.message('self', 'designer', '주 5시간이고 결제는 빼면 좋겠어요');
  const r = await f.coordinator.onMessage('self');
  expect(project(await f.read()).availability.get('designer')).toBe(5);
  const requests = r.events.filter(e => e.type === 'authority_requested');
  expect(requests).toHaveLength(3);
  for (const e of requests) expect(e.payload).toMatchObject({ personId: 'owner', changeKinds: ['scope_reduce'] });
  expect(r.posts.every(p => !p.text.includes('가용 시간'))).toBe(true);
});

it('does not apply a plan operation when both judgement attempts cite invalid evidence', async () => {
  const f = await fixture([interpret({ ops: exclusions() }), judge({ evidence: ['impact.deltaDays'] }), judge({ evidence: ['bad'] })]);
  const r = await f.coordinator.onMessage('m1');
  expect(r.posts).toEqual([]);
  expect(project(await f.read()).plan?.version).toBe(1);
  expect(f.connector.sendUpdate).not.toHaveBeenCalled();
});

it('applies the decider’s deadline and goal messages without an unnecessary second approval', async () => {
  const f = await fixture([interpret({ ops: [
    { type: 'set_deadline', date: '2026-10-12', sourceMessageIds: ['m1'] },
    { type: 'change_goal', text: '고객 반응 확인', sourceMessageIds: ['m1'] },
  ] }), judge()]);
  const r = await f.coordinator.onMessage('m1');
  expect(project(await f.read()).goal).toMatchObject({ text: '고객 반응 확인', deadline: '2026-10-12' });
  expect(project(await f.read()).plan?.version).toBe(1);
  expect(r.events.some(e => e.type === 'authority_requested')).toBe(false);
});

it('settles only the matching approval request when the decider confirms the operation', async () => {
  const f = await fixture([
    interpret({ ops: [{ type: 'exclude_scope', taskId: 'prototype', item: '결제', sourceMessageIds: ['suggestion'] }, { type: 'set_deadline', date: '2026-10-12', sourceMessageIds: ['suggestion'] }] }), judge({ evidence: ['msg:suggestion'] }),
    interpret({ ops: [{ type: 'exclude_scope', taskId: 'prototype', item: '결제', sourceMessageIds: ['agreement'] }] }), judge({ evidence: ['msg:agreement'] }),
  ]);
  await f.message('suggestion', 'designer', '결제는 빼고 기한은 늦추면 좋겠어요');
  await f.coordinator.onMessage('suggestion');
  expect(project(await f.read()).pendingAuthority.size).toBe(2);
  await f.message('agreement', 'owner', '결제만 빼자');
  await f.coordinator.onMessage('agreement');
  const state = project(await f.read());
  expect(state.pendingAuthority.size).toBe(1);
  expect([...state.pendingAuthority.values()][0]?.changeKinds).toEqual(['deadline_change']);
  expect(state.plan?.version).toBe(2);
});
