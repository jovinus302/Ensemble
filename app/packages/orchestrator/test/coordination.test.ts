import { expect, it, vi } from 'vitest';
import { MemoryLedgerStore } from '@ensemble/store';
import { project } from '@ensemble/core';
import type { AnyEvent, EventPayloads, EventType, TaskSpec } from '@ensemble/core';
import type { LlmProvider, LlmRequest, LlmResponse } from '@ensemble/llm';
import { Coordinator } from '../src/coordination.ts';
import type { CoordinationInterpretation, CoordinationJudgement } from '../src/coordination.ts';

const ctx = { projectId: 'coordination', targetProductId: 'product', clock: () => new Date('2026-09-28T00:00:00Z') };
const task = (id: string, assignee: string, conditions: string[] = []): TaskSpec => ({ id, title: id, assignee, dependsOn: [], handoffConditions: conditions });
const initialTasks = [task('prototype', 'agent', ['초안', '결제']), task('design', 'designer', ['초안', '결제']), task('review', 'outside', ['결제'])];
const interpret = (patch: Partial<CoordinationInterpretation> = {}): CoordinationInterpretation => ({ category: 'question', conclusion: false, sourceMessageIds: ['m1'], summary: '결제 제외, 초안으로 계속', changeKinds: [], drop: [], conflicts: [], ...patch });
const judge = (patch: Partial<CoordinationJudgement> = {}): CoordinationJudgement => ({ whoseAction: 'designer: 다음 작업 선택', alreadyKnows: 'no', evidence: ['m1'], decision: 'speak', reason: '계산된 영향으로 다음 행동을 고른다', openTopics: [], text: '계산 결과를 확인해 주세요.', ...patch });
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
async function fixture(responses: Parameters<typeof fake>[0], tasks = initialTasks, messageText = 'ㅇㅋ 결제는 빼자') {
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
  await message('m1', 'owner', messageText);
  const { llm, calls } = fake(responses);
  const connector = { sendUpdate: vi.fn(async () => ({ sent: true as boolean, reason: 'finished' })) };
  const coordinator = new Coordinator(store, llm, connector, ctx);
  const read = async () => await store.read() as AnyEvent[];
  return { store, add, message, calls, connector, coordinator, read };
}

it('records silence and the three answers while people coordinate a vacation', async () => {
  const f = await fixture([interpret({ category: 'availability', availability: [{ memberId: 'designer', weeklyHours: 5 }] }), judge({ decision: 'silent', whoseAction: null, alreadyKnows: 'yes', text: '', reason: '사람들이 조율 중', openTopics: ['휴가 후 초안'] })], initialTasks, '목요일에 휴가라 상세는 다음 주에 드려도 될까요?');
  const r = await f.coordinator.onMessage('m1');
  expect(r.posts).toEqual([]);
  expect(r.events).toEqual([expect.objectContaining({ type: 'pm_considered', payload: expect.objectContaining({ decision: 'silent', whoseAction: null, alreadyKnows: 'yes', evidence: ['m1'], openTopics: ['휴가 후 초안'] }) })]);
  expect(project(await f.read()).automation.actionsSinceResume).toBe(0);
});

it('answers using code-calculated seven-day delay and cites forecast input IDs', async () => {
  const f = await fixture([interpret({ availability: [{ memberId: 'designer', weeklyHours: 5 }] }), request => {
    const { facts } = JSON.parse(request.messages[0]!.content);
    expect(facts.impact.deltaDays.max).toBe(7);
    expect(facts.impact.proposed.lateness.maxDays).toBe(7);
    return judge({ text: `주 5시간이면 ${facts.impact.deltaDays.max}일 늦어져요. 초안으로 먼저 진행할까요?`, evidence: facts.impact.forecastInputIds });
  }], initialTasks, '그럼 프로토타입이 밀리나?');
  const r = await f.coordinator.onMessage('m1');
  expect(r.posts[0]?.text).toContain('7일');
  const considered = r.events.find(e => e.type === 'pm_considered') as AnyEvent;
  expect(considered.payload).toMatchObject({ evidence: expect.arrayContaining([(await f.read()).find(e => e.type === 'estimate_updated')!.id]) });
  expect(f.calls.every(r => r.forceTool && r.messages[0]!.content.includes('"planVersion":1') && r.messages[0]!.content.includes('"messageId":"m1"'))).toBe(true);
});

const reduced = initialTasks.map(t => ({ ...t, handoffConditions: t.handoffConditions.filter(c => c !== '결제') }));
it('summarises, commits v2, notifies absent changed people and steers with payment dropped once', async () => {
  const f = await fixture([interpret({ conclusion: true, tasks: reduced, changeKinds: ['scope_reduce'], drop: ['결제'], sourceMessageIds: ['m1', 'designer-agrees'] }), judge()]);
  await f.message('designer-agrees', 'designer', '초안으로 먼저 가세요');
  const r = await f.coordinator.onMessage('m1');
  expect(r.posts[0]).toMatchObject({ kind: 'summary', text: expect.stringContaining('정리하면:') });
  expect(project(await f.read()).plan?.version).toBe(2);
  expect(f.connector.sendUpdate).toHaveBeenCalledExactlyOnceWith('agent', expect.objectContaining({ fromVersion: 1, toVersion: 2, drop: ['결제'] }));
  expect(r.events.filter(e => e.type === 'change_notified').map(e => (e.payload as EventPayloads['change_notified']).recipientId).sort()).toEqual(['agent', 'outside']);
  expect(r.events.find(e => e.type === 'plan_committed')?.payload).toMatchObject({ sourceMessageIds: ['m1', 'designer-agrees'], basedOn: 1 });
  expect((await f.coordinator.onMessage('m1')).posts).toEqual([]);
  expect(f.connector.sendUpdate).toHaveBeenCalledTimes(1);
});

it('asks the decider about a deadline conclusion and leaves the plan unchanged', async () => {
  const f = await fixture([interpret({ conclusion: true, deadline: '2026-10-10', changeKinds: ['deadline_change'] }), judge()]);
  const r = await f.coordinator.onMessage('m1');
  expect(r.events.find(e => e.type === 'authority_requested')?.payload).toMatchObject({ personId: 'owner', changeKinds: ['deadline_change'] });
  expect(r.posts[0]?.kind).toBe('ask');
  expect(project(await f.read()).plan?.version).toBe(1);
  expect(f.connector.sendUpdate).not.toHaveBeenCalled();
});

it('does not repeat an answer supported by the same evidence', async () => {
  const f = await fixture([interpret(), judge(), interpret({ sourceMessageIds: ['m2'] }), judge()]);
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

it('steers an agent whose running task was removed and records next_turn on rejection', async () => {
  const f = await fixture([interpret({ conclusion: true, tasks: initialTasks.filter(t => t.id !== 'prototype'), changeKinds: ['scope_reduce'], drop: ['결제'] }), judge()]);
  f.connector.sendUpdate.mockResolvedValue({ sent: false, reason: 'turn completed' });
  const r = await f.coordinator.onMessage('m1');
  expect(f.connector.sendUpdate).toHaveBeenCalledWith('agent', expect.objectContaining({ drop: ['결제', 'prototype'], change: [expect.stringContaining('작업 중단')] }));
  expect(r.events.find(e => e.type === 'change_notified')?.payload).toMatchObject({ recipientId: 'agent', via: 'next_turn' });
  expect(project(await f.read()).tasks.get('prototype')?.status).toBe('cancelled');
});

it('cannot relabel a human commitment as a delegated reorder', async () => {
  const f = await fixture([interpret({ conclusion: true, availability: [{ memberId: 'designer', weeklyHours: 20 }], changeKinds: ['reorder'] }), judge()]);
  const r = await f.coordinator.onMessage('m1');
  expect(r.events.find(e => e.type === 'authority_requested')?.payload).toMatchObject({ personId: 'designer' });
  expect(project(await f.read()).availability.get('designer')).toBe(10);
});

it('rejects a stale snapshot when a plan is committed during model judgement', async () => {
  const f = await fixture([interpret({ conclusion: true, tasks: reduced, changeKinds: ['scope_reduce'] }), judge()]);
  const llm: LlmProvider = { async complete(request) {
    if (request.forceTool === 'judge_coordination') await f.add('plan_committed', { version: 2, basedOn: 1, tasks: initialTasks, approvedBy: 'owner', reason: 'concurrent', sourceMessageIds: [] });
    return { text: '', model: 'fake', responseId: 'r', usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [{ name: request.forceTool!, input: (request.forceTool === 'interpret_coordination' ? interpret({ conclusion: true, tasks: reduced, changeKinds: ['scope_reduce'] }) : judge()) as unknown as Record<string, unknown> }] };
  } };
  const r = await new Coordinator(f.store, llm, f.connector, ctx).onMessage('m1');
  expect(r.posts).toEqual([]);
  expect(r.events[0]?.payload).toMatchObject({ decision: 'silent', reason: '기록이 변경되어 재판단 필요' });
  expect(project(await f.read()).plan?.reason).toBe('concurrent');
  expect(f.connector.sendUpdate).not.toHaveBeenCalled();
});

it('stops at the automation limit, notifies once, and never commits or steers', async () => {
  const f = await fixture([interpret({ conclusion: true, tasks: reduced, changeKinds: ['scope_reduce'] }), judge(), interpret(), judge({ evidence: ['m2'] })]);
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
  const f = await fixture([interpret({ conclusion: true, tasks: reduced, changeKinds: ['scope_reduce'] }), judge(), interpret({ conclusion: true, tasks: corrected, changeKinds: ['reorder'], sourceMessageIds: ['m2'], summary: '검토는 프로토타입 다음' }), judge({ evidence: ['m2'] })]);
  await f.coordinator.onMessage('m1');
  await f.message('m2', 'owner', '아니, 검토는 프로토타입 다음이야');
  await f.coordinator.onMessage('m2');
  const events = await f.read();
  expect(events.filter(e => e.type === 'plan_committed').map(e => e.payload.version)).toEqual([1, 2, 3]);
  expect(events.filter(e => e.type === 'decision_recorded')).toHaveLength(2);
  expect(project(events).messages.find(m => m.messageId === 'm1')?.text).toBe('ㅇㅋ 결제는 빼자');
});

it('records next-turn context for a changed agent that is not running', async () => {
  const f = await fixture([interpret({ conclusion: true, tasks: reduced, changeKinds: ['scope_reduce'], drop: ['결제'] }), judge()]);
  await f.add('turn_finished', { agentId: 'agent', taskId: 'prototype' });
  const r = await f.coordinator.onMessage('m1');
  expect(r.events.find(e => e.type === 'change_notified' && (e.payload as EventPayloads['change_notified']).recipientId === 'agent')?.payload).toMatchObject({ via: 'next_turn', text: expect.stringContaining('결제') });
  expect(f.connector.sendUpdate).not.toHaveBeenCalled();
  expect(r.posts.some(p => p.text.startsWith('{'))).toBe(false);
});

it('does not commit a candidate with broken dependencies', async () => {
  const f = await fixture([interpret({ conclusion: true, tasks: reduced.map(t => ({ ...t, dependsOn: ['missing'] })), changeKinds: ['scope_reduce', 'reorder'] }), judge()]);
  const r = await f.coordinator.onMessage('m1');
  expect(r.posts).toEqual([]);
  expect(r.events[0]?.payload).toMatchObject({ reason: '후보 계획의 선후 관계 오류' });
  expect(project(await f.read()).plan?.version).toBe(1);
});

it('rejects fabricated evidence after one retry', async () => {
  const f = await fixture([interpret(), judge({ evidence: ['invented'] }), judge({ evidence: ['invented'] })]);
  const r = await f.coordinator.onMessage('m1');
  expect(r.posts).toEqual([]);
  expect(r.events[0]?.payload).toMatchObject({ reason: '판단 불가' });
});

it('concurrent duplicate deliveries produce one decision and one steer', async () => {
  const responses = [interpret({ conclusion: true, tasks: reduced, changeKinds: ['scope_reduce'] }), judge()];
  const f = await fixture(responses);
  const second = new Coordinator(f.store, fake(responses).llm, f.connector, ctx);
  const results = await Promise.all([f.coordinator.onMessage('m1'), second.onMessage('m1')]);
  expect(results.flatMap(r => r.events).filter(e => e.type === 'plan_committed')).toHaveLength(1);
  expect(f.connector.sendUpdate).toHaveBeenCalledTimes(1);
});
