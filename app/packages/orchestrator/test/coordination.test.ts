import { expect, it, vi } from 'vitest';
import { MemoryLedgerStore } from '@ensemble/store';
import { project, planStarts, forecastFromState } from '@ensemble/core';
import type { AnyEvent, EventPayloads, EventType, TaskSpec, PlanOp } from '@ensemble/core';
import type { LlmProvider, LlmRequest, LlmResponse } from '@ensemble/llm';
import type { UpdateInstructionsInput } from '@ensemble/agents';
import { Coordinator } from '../src/coordination.ts';
import type { CoordinationInterpretation, CoordinationJudgement } from '../src/coordination.ts';

const ctx = { projectId: 'coordination', targetProductId: 'product', clock: () => new Date('2026-09-28T00:00:00Z') };
const task = (id: string, assignee: string, conditions: string[] = []): TaskSpec => ({ id, title: id, assignee, dependsOn: [], handoffConditions: conditions });
const initialTasks = [task('prototype', 'agent', ['초안', '결제']), task('design', 'designer', ['초안', '결제']), task('review', 'outside', ['결제'])];
const interpret = (patch: Partial<CoordinationInterpretation> = {}): CoordinationInterpretation => ({ category: 'question', summary: '결제 제외, 초안으로 계속', ops: [], conflicts: [], conversation: { questionMessageId: null, waitingOnMemberIds: [], directedToPm: false }, factMentions: [], ...patch });
const exclusions = (sourceMessageIds = ['m1']): PlanOp[] => initialTasks.map(t => ({ type: 'exclude_scope', taskId: t.id, item: '결제', sourceMessageIds }));
const judge = (patch: Partial<CoordinationJudgement> = {}): CoordinationJudgement => ({ whoseAction: 'designer: 다음 작업 선택', alreadyKnows: 'no', evidence: ['forecast:current'], decision: 'speak', reason: '계산된 영향으로 다음 행동을 고른다', openTopics: [], text: '계산 결과를 확인해 주세요.', targetMemberIds: ['designer'], changesOpenQuestionAnswer: false, answerFactIds: [], ...patch });
function fake(responses: (object | null | ((r: LlmRequest) => object | null | Promise<object | null>))[]) {
  responses = [...responses];
  const calls: LlmRequest[] = [];
  const llm: LlmProvider = { async complete(request): Promise<LlmResponse> {
    calls.push(request);
    const next = responses.shift();
    const input = await (typeof next === 'function' ? next(request) : next);
    return { text: '', toolCalls: input ? [{ name: request.forceTool!, input: input as Record<string, unknown> }] : [], model: 'fake', responseId: `r${calls.length}`, usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  return { llm, calls };
}
async function fixture(responses: Parameters<typeof fake>[0], tasks = initialTasks, messageText = 'ㅇㅋ 결제는 빼자', authorId = 'owner', startPrototype = true) {
  const store = new MemoryLedgerStore();
  const add = async <K extends EventType>(type: K, payload: EventPayloads[K], pm = false) => store.append([{ projectId: ctx.projectId, targetProductId: ctx.targetProductId, actor: { kind: pm ? 'pm' : 'human', id: 'owner' }, type, payload }]);
  for (const memberId of ['owner', 'designer', 'outside', 'agent']) await add('member_joined', { memberId, kind: memberId === 'agent' ? 'agent' : 'human', displayName: memberId });
  await add('goal_set', { text: '시제품', deadline: '2026-10-05T00:00:00Z', decider: 'owner', delegation: { pmMayApply: ['scope_reduce', 'reorder', 'reassign_agent'] } });
  await add('plan_committed', { version: 1, basedOn: null, tasks, reason: '초기 합의', approvedBy: 'owner', sourceMessageIds: [] });
  for (const spec of tasks) await add('estimate_updated', { taskId: spec.id, hours: { min: 10, max: 10 }, source: 'human' });
  for (const memberId of ['designer', 'outside']) await add('availability_updated', { memberId, weeklyHours: 10 });
  if (startPrototype && tasks.some(t => t.id === 'prototype')) {
    await add('task_start_reserved', { taskId: 'prototype', specVersion: 1, trigger: 'initial' });
    await add('task_started', { taskId: 'prototype', turnId: 'turn-1' });
  }
  const message = (messageId = 'm1', authorId = 'owner', text = 'ㅇㅋ 결제는 빼자') => add('message_recorded', { messageId, authorId, text, attachmentIds: [] });
  await message('m1', authorId, messageText);
  const { llm, calls } = fake(responses);
  const connector = { sendUpdate: vi.fn(async (_agentId: string, _input: UpdateInstructionsInput) => ({ sent: true as boolean, reason: 'finished' })) };
  const coordinator = new Coordinator(store, llm, connector, ctx);
  const read = async () => await store.read() as AnyEvent[];
  return { store, add, message, calls, connector, coordinator, read };
}

it('records silence and the three answers while people coordinate a vacation', async () => {
  const f = await fixture([interpret({ category: 'availability', ops: [{ type: 'set_availability', memberId: 'designer', weeklyHours: 5, sourceMessageIds: ['m1'] }] }), judge({ decision: 'silent', evidence: ['msg:m1'], whoseAction: null, alreadyKnows: 'yes', text: '', reason: '사람들이 조율 중', openTopics: ['휴가 후 초안'] })], initialTasks, '목요일에 휴가라 상세는 다음 주에 드려도 될까요?', 'designer');
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
it('V2 four checked tasks: records 결제 exclusion and reopens only the affected final output', async () => {
  const tasks = [task('research', 'agent'), task('interview', 'owner'), { ...task('design', 'designer', ['가입·결제 흐름']), dependsOn: ['research', 'interview'] }, { ...task('prototype', 'agent', ['가입·모의결제 포함 HTML']), title: '프로토타입', dependsOn: ['design'] }];
  const f = await fixture([interpret({ ops: [{ type: 'exclude_scope', taskId: 'design', item: '결제', sourceMessageIds: ['proposal', 'decision'] }] }), judge({ decision: 'silent', text: '', reason: '연산으로 반영' })], tasks, '시작', 'owner', false);
  for (const t of tasks) { await f.add('result_submitted', { taskId: t.id, resultId: `r-${t.id}`, planVersion: 1, summary: t.title, artifactIds: [] }); await f.add('task_checked', { taskId: t.id, resultId: `r-${t.id}`, reason: '확인' }); }
  await f.message('proposal', 'designer', '결제 쪽은 아직 애매해서 빼면 좋겠어요');
  await f.message('decision', 'owner', 'ㅇㅋ 결제는 이번엔 빼자');
  const r = await f.coordinator.onMessage('decision');
  expect(project(await f.read()).tasks.get('prototype')).toMatchObject({ status: 'checked', spec: { exclusions: ['결제'] } });
  expect(r.reopens).toEqual([{ taskId: 'prototype', reason: '결제 제외 반영', announcement: expect.stringMatching(/정리하면.*다시/) }]);
  expect(r.posts).toEqual([]);
  expect(project(await f.read()).tasks.get('design')?.spec.exclusions ?? []).toEqual([]);
});

it('V2 unknown affected output asks the decider instead of silently dropping the decision', async () => {
  const f = await fixture([interpret({ ops: [{ type: 'exclude_scope', taskId: 'prototype', item: '결제', sourceMessageIds: ['m1'] }] }), judge({ decision: 'silent', text: '' })], [task('prototype', 'agent', ['일반 결과'])], 'ㅇㅋ 결제는 이번엔 빼자', 'owner', false);
  await f.add('result_submitted', { taskId: 'prototype', resultId: 'r', planVersion: 1, summary: '일반 결과', artifactIds: [] });
  await f.add('task_checked', { taskId: 'prototype', resultId: 'r', reason: '확인' });
  const r = await f.coordinator.onMessage('m1');
  expect(r.reopens ?? []).toEqual([]);
  expect(r.posts.some(p => /어느 작업/.test(p.text))).toBe(true);
});

it.each(['agent', 'designer'])('V2 checked %s output can be limited, with original conditions and acceptance evidence intact', async assignee => {
  const specs = [task('prototype', assignee, ['가입·예약·결제 포함', '개인정보 저장 없음'])];
  const f = await fixture([interpret({ ops: [{ type: 'limit_scope', taskId: 'prototype', items: ['가입', '예약'], sourceMessageIds: ['m1'] }] }), judge({ decision: 'silent', text: '' })], specs, '가입과 예약까지만 하자', 'owner', false);
  await f.add('result_submitted', { taskId: 'prototype', resultId: 'r', planVersion: 1, summary: '가입 예약 결제', artifactIds: [] });
  await f.add('task_checked', { taskId: 'prototype', resultId: 'r', reason: '확인' });
  const result = await f.coordinator.onMessage('m1');
  expect(result.reopens).toEqual([{ taskId: 'prototype', reason: '가입·예약 범위 한정 반영', announcement: expect.stringContaining('정리하면') }]);
  expect(result.posts).toEqual([]);
  expect(project(await f.read()).tasks.get('prototype')).toMatchObject({ status: 'checked', checkedResultId: 'r', spec: { handoffConditions: specs[0]!.handoffConditions, limits: ['가입', '예약'] } });
});

it('V2 a designer proposal cannot reopen checked work before the decider approves', async () => {
  const f = await fixture([interpret({ ops: [{ type: 'exclude_scope', taskId: 'prototype', item: '결제', sourceMessageIds: ['m1'] }] }), judge({ decision: 'silent', text: '' })], [task('prototype', 'agent', ['결제 포함'])], '결제 쪽은 아직 애매해서 빼면 좋겠어요', 'designer', false);
  await f.add('result_submitted', { taskId: 'prototype', resultId: 'r', planVersion: 1, summary: '결제 포함', artifactIds: [] });
  await f.add('task_checked', { taskId: 'prototype', resultId: 'r', reason: '확인' });
  expect((await f.coordinator.onMessage('m1')).reopens ?? []).toEqual([]);
  expect(project(await f.read()).plan?.version).toBe(1);
});

it('W5 이번 주 5시간 followed by 그럼 프로토타입이 밀리나 answers from recorded weekly capacity', async () => {
  const f = await fixture([interpret({ conversation: { questionMessageId: 'question', waitingOnMemberIds: [], directedToPm: true }, ops: [{ type: 'set_availability', memberId: 'designer', weeklyHours: 5, period: 'unclear', sourceMessageIds: ['capacity'] } as PlanOp] }), judge({ evidence: ['forecast:current'], answerFactIds: ['forecast:current'], text: '이번 주만인가요, 매주인가요?' })], initialTasks, '시작');
  await f.message('capacity', 'designer', '이번 주 5시간 가능해요');
  await f.add('availability_updated', { memberId: 'designer', weeklyHours: 5, weekStart: '2026-09-28' });
  await f.message('question', 'owner', '그럼 프로토타입이 밀리나?');
  const r = await f.coordinator.onMessage('question');
  expect(r.posts.map(p => p.text).join(' ')).not.toMatch(/이번 주만인가|매주.*인가/);
  expect(r.posts.map(p => p.text).join(' ')).toMatch(/예상 종료|기한|일/);
  expect(project(await f.read()).availability.get('designer')).toBe(10);
});

it('W5 a direct task-delay answer cannot contradict the calculated before/after availability forecast', async () => {
  const specs = [{ ...task('design', 'designer'), title: '흐름 초안' }, { ...task('prototype', 'agent'), title: '프로토타입', dependsOn: ['design'] }];
  const f = await fixture([interpret({ conversation: { questionMessageId: 'question', waitingOnMemberIds: [], directedToPm: true } }), judge({ evidence: ['forecast:current'], answerFactIds: ['forecast:current'], text: '프로토타입 자체 시작일은 바뀌지 않아요.' })], specs, '시작', 'owner', false);
  await f.message('capacity', 'designer', '이번 주 5시간 가능해요');
  await f.add('availability_updated', { memberId: 'designer', weeklyHours: 5, weekStart: '2026-09-28' });
  await f.message('question', 'owner', '그럼 프로토타입이 밀리나?');
  const result = await f.coordinator.onMessage('question');
  expect(result.posts[0]?.text).toContain('프로토타입');
  expect(result.posts[0]?.text).toContain('3.3일');
  expect(result.posts[0]?.text).toContain('늦어');
  expect(result.posts[0]?.text).not.toContain('바뀌지');
});
it.each([
  ['accept', '결제 화면 조건은 이제 필요 없어요. 이대로 확인해 주세요'],
  ['retry', '@프로토타입 Agent 다시 맡길게요. 결제 없이 다시 만들어 주세요'],
  ['recheck', '다시 검토해 주세요'],
] as const)('T1 returns an authorized %s recovery request', async (action, text) => {
  const op = { type: 'resolve_task', taskId: 'prototype', action, note: text, sourceMessageIds: ['m1'] };
  const f = await fixture([interpret({ ops: [op as never] }), judge({ decision: 'silent', text: '' })], initialTasks, text);
  await f.add('result_submitted', { taskId: 'prototype', resultId: 'r', planVersion: 1, summary: '결과', artifactIds: [] });
  if (action !== 'recheck') await f.add('task_blocked', { taskId: 'prototype', reason: '보완 한도' });
  const r = await f.coordinator.onMessage('m1');
  expect(r).toMatchObject({ resolutions: [{ taskId: 'prototype', action, note: text }] });
  expect(r.events.some(e => e.type === 'task_checked')).toBe(false);
});
it('T3 reopens a checked result for the exact missing calendar button request', async () => {
  const reason = "@프로토타입 Agent 예약 확인 화면에 '캘린더에 추가' 버튼이 없어요. 추가해서 다시 올려 주세요";
  const f = await fixture([interpret({ ops: [{ type: 'reopen_task', taskId: 'prototype', reason, sourceMessageIds: ['m1'] } as never] }), judge({ decision: 'silent', text: '' })], initialTasks, reason);
  await f.add('result_submitted', { taskId: 'prototype', resultId: 'r', planVersion: 1, summary: '결과', artifactIds: [] });
  await f.add('task_checked', { taskId: 'prototype', resultId: 'r', reason: '확인' });
  expect(await f.coordinator.onMessage('m1')).toMatchObject({ reopens: [{ taskId: 'prototype', reason }] });
});
it('Z4 records failed judgement and tells the person how to retry after both invalid responses', async () => {
  const f = await fixture([null, null], initialTasks, "@프로토타입 Agent 캘린더에 추가 버튼이 없어요. 추가해서 다시 올려 주세요");
  const result = await f.coordinator.onMessage('m1');
  expect(f.calls).toHaveLength(2);
  expect(result.posts.map(p => p.text)).toContain('제가 이 요청을 판단하지 못했어요. 무엇을 바꾸길 원하는지 한 문장으로 다시 알려 주세요');
  expect(result.events.some(e => e.type === 'judgement_failed')).toBe(true);
});
it.each([
  ['accept', 'owner', true], ['accept', 'designer', false], ['accept', 'outside', false],
  ['retry', 'owner', true], ['retry', 'designer', true], ['retry', 'outside', false],
  ['recheck', 'owner', true], ['recheck', 'designer', true], ['recheck', 'outside', true],
  ['reopen', 'owner', true], ['reopen', 'designer', true], ['reopen', 'outside', false],
] as const)('checks current human authority for %s by %s (allowed=%s)', async (action, author, allowed) => {
  const tasks = [initialTasks[0]!, { ...initialTasks[1]!, dependsOn: ['prototype'] }];
  const op = action === 'reopen' ? { type: 'reopen_task', taskId: 'prototype', reason: '캘린더에 추가 버튼 보완', sourceMessageIds: ['m1'] } as const
    : { type: 'resolve_task', taskId: 'prototype', action, sourceMessageIds: ['m1'] } as const;
  const f = await fixture([interpret({ ops: [op as never] }), judge({ decision: 'silent', text: '' })], tasks, '현재 결과를 보완해 주세요', author);
  await f.add('result_submitted', { taskId: 'prototype', resultId: 'r', planVersion: 1, summary: '결과', artifactIds: [] });
  if (action === 'reopen') await f.add('task_checked', { taskId: 'prototype', resultId: 'r', reason: '확인' });
  else if (action !== 'recheck') await f.add('task_blocked', { taskId: 'prototype', reason: '보완 한도' });
  const result = await f.coordinator.onMessage('m1');
  expect((result.resolutions?.length ?? 0) + (result.reopens?.length ?? 0)).toBe(allowed ? 1 : 0);
  // M12 X2: the refusal names who may do it, in the buttons' words.
  if (!allowed) expect(result.posts[0]?.text).toMatch(action === 'accept' ? /^"이대로 확인"은 결정권자\(.+\)만 할 수 있어요\.$/
    : action === 'retry' ? /^"다시 맡기기"는 결정권자, 담당자 또는 후행 작업 담당자만/ : /^확인된 결과의 보완은 결정권자나 후행 작업 담당자가/);
});
it('does not reuse a previous decider request to authorize a new recovery message', async () => {
  const f = await fixture([interpret({ ops: [{ type: 'resolve_task', taskId: 'prototype', action: 'accept', sourceMessageIds: ['m1'] }] }), judge()], initialTasks, '이대로 확인해 주세요');
  await f.add('result_submitted', { taskId: 'prototype', resultId: 'r', planVersion: 1, summary: '결과', artifactIds: [] });
  await f.add('task_blocked', { taskId: 'prototype', reason: '보완 한도' });
  await f.message('m2', 'outside', '내가 확인할게요');
  expect((await f.coordinator.onMessage('m2')).resolutions).toBeUndefined();
});
it('does not return a recovery twice or infer completed acceptance before execution', async () => {
  const op = { type: 'resolve_task', taskId: 'prototype', action: 'accept', sourceMessageIds: ['m1'] } as const;
  const f = await fixture([interpret({ ops: [op as never] }), judge()], initialTasks, '이대로 확인해 주세요');
  await f.add('result_submitted', { taskId: 'prototype', resultId: 'r', planVersion: 1, summary: '결과', artifactIds: [] });
  await f.add('task_blocked', { taskId: 'prototype', reason: '보완 한도' });
  const first = await f.coordinator.onMessage('m1');
  expect(first.resolutions).toHaveLength(1);
  expect(first.posts).toEqual([]);
  expect((await f.coordinator.onMessage('m1')).resolutions).toBeUndefined();
  expect(project(await f.read()).tasks.get('prototype')?.status).toBe('blocked');
});
it('rejects conflicting recovery actions and recovery of a running task', async () => {
  const op = { type: 'resolve_task', taskId: 'prototype', action: 'retry', sourceMessageIds: ['m1'] } as const;
  const f = await fixture([interpret({ ops: [op as never, { ...op, action: 'accept' } as never] }), judge()], initialTasks, '다시 맡길게요');
  expect((await f.coordinator.onMessage('m1')).resolutions).toBeUndefined();
  const running = await fixture([interpret({ ops: [op as never] }), judge()], initialTasks, '다시 맡길게요');
  expect((await running.coordinator.onMessage('m1')).resolutions).toBeUndefined();
});
it('rechecks recovery authority after concurrent reassignment while interpreting', async () => {
  const f = await fixture([interpret({ ops: [{ type: 'resolve_task', taskId: 'design', action: 'retry', sourceMessageIds: ['m1'] }] }), judge()], initialTasks, '다시 맡길게요', 'designer');
  await f.add('task_blocked', { taskId: 'design', reason: '보완 한도' });
  const original = f.store.transaction.bind(f.store);
  let changed = false;
  f.store.transaction = (async (...args: Parameters<typeof original>) => {
    if (!changed) {
      changed = true;
      await f.add('plan_committed', { version: 2, basedOn: 1, tasks: initialTasks.map(t => t.id === 'design' ? { ...t, assignee: 'outside' } : t), reason: '담당자 변경', approvedBy: 'owner', sourceMessageIds: [] });
    }
    return original(...args);
  }) as typeof f.store.transaction;
  expect((await f.coordinator.onMessage('m1')).resolutions).toBeUndefined();
});
it('does not declare handoff met from conversational model judgement alone', async () => {
  const f = await fixture([interpret({ conversation: { questionMessageId: 'm1', waitingOnMemberIds: [], directedToPm: true } }), judge({ text: '보고서가 인계 조건을 충족합니다.', evidence: ['task:prototype'], answerFactIds: ['task:prototype'] })], initialTasks, '보고서 다시 첨부했어요. 확인해 주세요.');
  const result = await f.coordinator.onMessage('m1');
  expect(result.posts.map(p => p.text).join(' ')).not.toContain('충족합니다');
  expect(result.posts.map(p => p.text).join(' ')).toContain('인계 검토');
  expect(result.events.some(e => e.type === 'task_checked')).toBe(false);
});
it('uses a short task name once for repeated scope reductions', async () => {
  const title = '로컬 실행용 클릭 가능 HTML 프로토타입 제작(가입·예약·모의 결제 포함)';
  const ops: PlanOp[] = ['결제 모형(모의 결제) 화면 및 상호작용', '결제 화면과 모의 결제 버튼'].map(item => ({ type: 'exclude_scope', taskId: 'prototype', item, sourceMessageIds: ['m1'] }));
  const f = await fixture([interpret({ ops }), judge()], [{ ...initialTasks[0]!, title }]);
  const result = await f.coordinator.onMessage('m1');
  const text = result.posts[0]!.text;
  expect(text).not.toContain(title);
  expect(text.match(/프로토타입/g)).toHaveLength(1);
  expect(text).toContain('결제');
});
it('keeps interleaved task reductions grouped so a limit refers to the correct task', async () => {
  const ops: PlanOp[] = [
    { type: 'exclude_scope', taskId: 'design', item: '결제', sourceMessageIds: ['m1'] },
    { type: 'exclude_scope', taskId: 'prototype', item: '결제', sourceMessageIds: ['m1'] },
    { type: 'limit_scope', taskId: 'design', items: ['가입'], sourceMessageIds: ['m1'] },
  ];
  const f = await fixture([interpret({ ops }), judge()]);
  const text = (await f.coordinator.onMessage('m1')).posts[0]!.text;
  expect(text.indexOf('범위를 가입')).toBeLessThan(text.indexOf('prototype에서'));
});
it('does not present an optimistic forecast answer while revision work is stopped', async () => {
  const f = await fixture([interpret({ conversation: { questionMessageId: 'm1', waitingOnMemberIds: [], directedToPm: true } }), judge({ text: '현재 계산으로는 기한 안에 끝납니다.', answerFactIds: ['forecast:current'] })], initialTasks, 'PM, 언제 끝나나요?');
  await f.add('task_blocked', { taskId: 'prototype', reason: '보완 상한 초과', unblockBy: 'owner' });
  const result = await f.coordinator.onMessage('m1');
  expect(result.posts[0]?.text).toContain('멈춘 작업 1개 — 날짜 불확실');
  expect(result.posts[0]?.text).not.toContain('기한 안');
});
it('M11 accept-1: a summary said with an accept in the same message does not warn about the task being accepted', async () => {
  const text = '결제 화면 조건은 이제 필요 없어요. 이대로 확인해 주세요';
  const f = await fixture([interpret({ ops: [{ type: 'exclude_scope', taskId: 'prototype', item: '결제 화면', sourceMessageIds: ['m1'] }, { type: 'resolve_task', taskId: 'prototype', action: 'accept', sourceMessageIds: ['m1'] } as never] }), judge()], initialTasks, text);
  await f.add('result_submitted', { taskId: 'prototype', resultId: 'r', planVersion: 1, summary: '결과', artifactIds: [] });
  await f.add('task_blocked', { taskId: 'prototype', reason: '보완 한도' });
  const result = await f.coordinator.onMessage('m1');
  expect(result.resolutions).toEqual([{ taskId: 'prototype', action: 'accept' }]);
  expect(result.posts[0]?.text).toContain('정리하면');
  expect(result.posts[0]?.text).not.toContain('날짜 불확실');
});
it('summarises, commits v2, notifies absent changed people and steers with payment dropped once', async () => {
  const f = await fixture([interpret({ ops: exclusions(['m1', 'designer-agrees']) }), judge()]);
  await f.message('designer-agrees', 'designer', '초안으로 먼저 가세요');
  const r = await f.coordinator.onMessage('designer-agrees');
  expect(r.posts[0]).toMatchObject({ kind: 'summary', text: expect.stringContaining('정리하면:') });
  expect(project(await f.read()).plan?.version).toBe(2);
  expect(project(await f.read()).plan?.tasks.map(t => t.title)).toEqual(initialTasks.map(t => `${t.title} (결제 제외)`));
  expect(f.connector.sendUpdate).toHaveBeenCalledExactlyOnceWith('agent', expect.objectContaining({ fromVersion: 1, toVersion: 2, drop: ['결제'] }));
  expect(r.events.filter(e => e.type === 'change_notified').map(e => (e.payload as EventPayloads['change_notified']).recipientId).sort()).toEqual(['agent', 'outside']);
  expect(r.events.find(e => e.type === 'plan_committed')?.payload).toMatchObject({ sourceMessageIds: ['m1', 'designer-agrees'], basedOn: 1 });
  expect((await f.coordinator.onMessage('designer-agrees')).posts).toEqual([]);
  expect(f.connector.sendUpdate).toHaveBeenCalledTimes(1);
});

it('asks the decider about another person’s deadline proposal and leaves the plan unchanged', async () => {
  const f = await fixture([interpret({ ops: [{ type: 'set_deadline', date: '2026-10-10', sourceMessageIds: ['proposal'] }] }), judge()]);
  await f.message('proposal', 'designer', '기한을 옮기면 좋겠어요');
  const r = await f.coordinator.onMessage('proposal');
  expect(r.events.find(e => e.type === 'authority_requested')?.payload).toMatchObject({ personId: 'owner', changeKinds: ['deadline_change'] });
  expect(r.posts[0]?.kind).toBe('ask');
  expect(project(await f.read()).plan?.version).toBe(1);
  expect(f.connector.sendUpdate).not.toHaveBeenCalled();
});

it.each(['owner', 'designer'])('checks a new %s message after delayed interpretation before spending a judgement call', async authorId => {
  let release!: (value: object) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const delayed = new Promise<object>(resolve => { release = resolve; });
  const f = await fixture([() => { entered(); return delayed; }, judge()]);
  let settled = false;
  const pending = f.coordinator.onMessage('m1').finally(() => { settled = true; });
  await started;
  await f.message('m2', authorId, 'A correction arrived while the model was pending');
  expect((await f.read()).some(e => e.type === 'message_recorded' && e.payload.messageId === 'm2')).toBe(true);
  expect(settled).toBe(false);
  release(interpret());
  const result = await pending;
  if (authorId === 'owner') {
    expect(f.calls.map(c => c.forceTool)).toEqual(['interpret_coordination']);
    expect(result.posts).toEqual([]);
    expect(result.events).toEqual([expect.objectContaining({ type: 'pm_considered', payload: expect.objectContaining({ considerationId: 'superseded:m1' }) })]);
  } else {
    expect(f.calls.map(c => c.forceTool)).toEqual(['interpret_coordination', 'judge_coordination']);
  }
});

it('does not repeat an answer supported by the same evidence', async () => {
  const f = await fixture([interpret(), judge(), interpret(), judge()]);
  await f.coordinator.onMessage('m1');
  await f.message('m2', 'owner', '다시 질문');
  const r = await f.coordinator.onMessage('m2');
  expect(r.posts).toEqual([]);
  expect(r.events[0]?.payload).toMatchObject({ decision: 'silent', alreadyKnows: 'yes', reason: expect.stringContaining('이미 전달한 근거') });
});

it.each([[null, null], [interpret(), null, null], [{ conclusion: true }, { conclusion: true }]])('retries once, then asks the decider to clarify rather than inventing a change: %j', async (...responses) => {
  const f = await fixture(responses);
  const r = await f.coordinator.onMessage('m1');
  expect(r.posts[0]?.text).toContain('한 문장으로 다시 알려 주세요');
  expect(r.events[0]?.payload).toMatchObject({ decision: 'speak', reason: 'judgement_failed' });
  expect(project(await f.read()).plan?.version).toBe(1);
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

it('does not restart a scope judgement for worker progress commentary', async () => {
  const f = await fixture([interpret({ ops: exclusions() }), judge()]);
  let calls = 0;
  const llm: LlmProvider = { async complete(request) {
    calls++;
    await f.add('reply_recorded', { memberId: 'agent', taskId: 'prototype', turnId: 'turn-1', text: 'Implementation is progressing.' });
    return { text: '', model: 'fake', responseId: 'r', usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [{ name: request.forceTool!, input: (request.forceTool === 'interpret_coordination' ? interpret({ ops: exclusions() }) : judge()) as unknown as Record<string, unknown> }] };
  } };
  const result = await new Coordinator(f.store, llm, f.connector, ctx).onMessage('m1');
  expect(calls).toBe(2);
  expect(result.events.some(e => e.type === 'plan_committed')).toBe(true);
  expect(f.connector.sendUpdate).toHaveBeenCalledTimes(1);
});

it('retries a changing snapshot twice, then explains the failure without stale writes or delivery', async () => {
  const f = await fixture([interpret({ ops: exclusions() }), judge()]);
  let judgements = 0;
  const llm: LlmProvider = { async complete(request) {
    if (request.forceTool === 'judge_coordination') { judgements++; await f.add('plan_committed', { version: judgements + 1, basedOn: judgements, tasks: initialTasks, approvedBy: 'owner', reason: 'concurrent', sourceMessageIds: [] }); }
    return { text: '', model: 'fake', responseId: 'r', usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [{ name: request.forceTool!, input: (request.forceTool === 'interpret_coordination' ? interpret({ ops: exclusions() }) : judge()) as unknown as Record<string, unknown> }] };
  } };
  const r = await new Coordinator(f.store, llm, f.connector, ctx).onMessage('m1');
  expect(r.posts[0]?.text).toContain('기록이 계속 바뀌어');
  expect(r.events[0]?.payload).toMatchObject({ decision: 'speak', reason: '최신 기록 재판단 두 번 후에도 경합이 계속됨' });
  expect(judgements).toBe(3);
  expect(project(await f.read()).plan?.reason).toBe('concurrent');
  expect(f.connector.sendUpdate).not.toHaveBeenCalled();
});

it('stops at the automation limit, notifies once, and never commits or steers', async () => {
  const f = await fixture([interpret({ ops: [{ type: 'handoff_early', taskId: 'design', sourceMessageIds: ['m1'] }] }), judge(), interpret(), judge({ decision: 'silent', evidence: ['msg:m2'] })], initialTasks, '초안 단계에서 넘길게요', 'designer');
  for (let i = 0; i < 12; i++) await f.add('change_notified', { changeId: `prior:${i}`, planVersion: 1, recipientId: 'agent', text: 'changed', via: 'next_turn' }, true);
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
  expect(r.posts[0]?.text).toContain('한 문장으로 다시 알려 주세요');
  expect(r.events[0]?.payload).toMatchObject({ reason: 'judgement_failed' });
  expect(project(await f.read()).plan?.version).toBe(1);
});

it('rejects fabricated evidence after one retry', async () => {
  const f = await fixture([interpret(), judge({ evidence: ['invented'] }), judge({ evidence: ['invented'] })], initialTasks, '오늘 회의 기록입니다');
  const r = await f.coordinator.onMessage('m1');
  expect(r.posts[0]?.text).toContain('한 문장으로 다시 알려 주세요');
  expect(r.events[0]?.payload).toMatchObject({ reason: 'judgement_failed' });
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

it('applies a validated explicit decider exclusion with code-owned summary when both judgements fail', async () => {
  const f = await fixture([interpret({ ops: exclusions() }), judge({ evidence: ['impact.deltaDays'] }), judge({ evidence: ['bad'] })]);
  const r = await f.coordinator.onMessage('m1');
  expect(r.posts[0]?.text).toContain('정리하면:');
  expect(project(await f.read()).plan?.version).toBe(2);
  expect(f.connector.sendUpdate).toHaveBeenCalledTimes(1);
  expect(r.posts[0]?.text).not.toContain('impact.deltaDays');
});

it('does not use the explicit-exclusion fallback for an unauthorized person or other operation', async () => {
  for (const [ops, author, text] of [
    [exclusions(), 'designer', '결제 빼자'],
    [[{ type: 'set_deadline', date: '2026-10-20', sourceMessageIds: ['m1'] }], 'owner', '기한을 바꾸자'],
  ] as [PlanOp[], string, string][]) {
    const f = await fixture([interpret({ ops }), null, null], initialTasks, text, author);
    await f.coordinator.onMessage('m1');
    expect(project(await f.read()).plan?.version).toBe(1);
    expect(project(await f.read()).goal?.deadline).toBe('2026-10-05T00:00:00Z');
    expect(f.connector.sendUpdate).not.toHaveBeenCalled();
  }
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
    interpret({ ops: [{ type: 'exclude_scope', taskId: 'prototype', item: '결제', sourceMessageIds: ['suggestion'] }, { type: 'set_deadline', date: '2026-10-12', sourceMessageIds: ['suggestion'] }] }), judge({ evidence: ['forecast:candidate'] }),
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

it('overrides a model speech citing only conversation and records why', async () => {
  const f = await fixture([interpret(), judge({ evidence: ['msg:m1'] })]);
  const r = await f.coordinator.onMessage('m1');
  expect(r.posts).toEqual([]);
  expect(r.events[0]?.payload).toMatchObject({ decision: 'silent', reason: expect.stringContaining('이미 나온 말의 반복') });
});

it('does not disguise the same forecast as new by adding another message citation', async () => {
  const f = await fixture([interpret(), judge(), interpret(), request => {
    const { facts } = JSON.parse(request.messages[0]!.content);
    expect(facts.knowledge.find((k: { factId: string }) => k.factId === 'forecast:current')).toMatchObject({ posted: true });
    return judge({ evidence: ['forecast:current', 'msg:m2'] });
  }]);
  expect((await f.coordinator.onMessage('m1')).posts).toHaveLength(1);
  await f.message('m2');
  const r = await f.coordinator.onMessage('m2');
  expect(r.posts).toEqual([]);
  expect(r.events[0]?.payload).toMatchObject({ decision: 'silent', alreadyKnows: 'yes' });
});

it('allows the same forecast ID when its calculated value changes', async () => {
  const f = await fixture([interpret(), judge(), interpret(), judge()]);
  await f.coordinator.onMessage('m1');
  await f.add('availability_updated', { memberId: 'designer', weeklyHours: 5 });
  await f.message('m2');
  expect((await f.coordinator.onMessage('m2')).posts).toHaveLength(1);
});

it('fixes alreadyKnows to yes when the target already mentioned the fact', async () => {
  const f = await fixture([interpret({ factMentions: [{ messageId: 'm1', factIds: ['availability:designer'] }] }), judge({ targetMemberIds: ['designer'], evidence: ['availability:designer'] })], initialTasks, '제 가용 시간은 주 10시간이에요', 'designer');
  const r = await f.coordinator.onMessage('m1');
  expect(r.posts).toEqual([]);
  expect(r.events[0]?.payload).toMatchObject({ alreadyKnows: 'yes', decision: 'silent' });
});

it.each([false, true])('waits on an open human question unless a new fact changes its answer: %s', async changesOpenQuestionAnswer => {
  const f = await fixture([interpret({ conversation: { questionMessageId: 'm1', waitingOnMemberIds: ['owner'], directedToPm: false } }), request => {
    expect(JSON.parse(request.messages[0]!.content).facts.openHumanQuestion).toBe(true);
    return judge({ changesOpenQuestionAnswer });
  }], initialTasks, '다음 주에 전달해도 될까요?', 'designer');
  const r = await f.coordinator.onMessage('m1');
  expect(r.posts).toHaveLength(changesOpenQuestionAnswer ? 1 : 0);
  if (!changesOpenQuestionAnswer) expect(r.events[0]?.payload).toMatchObject({ reason: '결정권자가 참여한 사람 사이 질문은 답을 기다린다' });
});

it('does not turn an open handoff proposal into a confirmed summary while recording self availability', async () => {
  const f = await fixture([interpret({
    conversation: { questionMessageId: 'm1', waitingOnMemberIds: ['owner'], directedToPm: false },
    ops: [{ type: 'set_availability', memberId: 'designer', weeklyHours: 5, sourceMessageIds: ['m1'] }, { type: 'handoff_early', taskId: 'design', sourceMessageIds: ['m1'] }],
  }), judge({ evidence: ['forecast:candidate'], changesOpenQuestionAnswer: false })], initialTasks, '주 5시간이고 초안으로 넘겨도 될까요?', 'designer');
  const r = await f.coordinator.onMessage('m1');
  const state = project(await f.read());
  expect(r.posts).toEqual([]);
  expect(state.availability.get('designer')).toBe(5);
  expect(state.plan?.version).toBe(1);
  expect(state.tasks.get('design')?.spec.handoffConditions).toEqual(['초안', '결제']);
});

it('does not accept the question itself as an answer fact', async () => {
  const f = await fixture([interpret({ conversation: { questionMessageId: 'm1', waitingOnMemberIds: [], directedToPm: true } }), judge({ evidence: ['msg:m1'], answerFactIds: ['msg:m1'] })]);
  expect((await f.coordinator.onMessage('m1')).posts).toEqual([]);
});

it.each([false, true])('permits a directly requested answer with message evidence only when it answers the question: %s', async hasAnswer => {
  const f = await fixture([interpret({ conversation: { questionMessageId: 'question', waitingOnMemberIds: [], directedToPm: true } }), judge({ evidence: ['msg:m1'], answerFactIds: hasAnswer ? ['msg:m1'] : [] })], initialTasks, '월요일에 전달합니다', 'designer');
  await f.message('question', 'owner', 'PM, 디자이너가 정한 전달일이 언제죠?');
  const r = await f.coordinator.onMessage('question');
  expect(r.posts).toHaveLength(hasAnswer ? 1 : 0);
});

it('a decider conclusion opens a new budget even after the previous window hit its cap', async () => {
  const f = await fixture([interpret({ ops: exclusions() }), judge()]);
  for (let i = 0; i < 12; i++) await f.add('change_notified', { changeId: `old:${i}`, planVersion: 1, recipientId: 'agent', text: 'changed', via: 'next_turn' }, true);
  await f.add('action_limit_reached', { count: 12, limit: 12 });
  const r = await f.coordinator.onMessage('m1');
  const state = project(await f.read());
  expect(r.posts[0]?.kind).toBe('summary');
  expect(state.plan?.version).toBe(2);
  expect(state.automation).toEqual({ actionsSinceResume: 5, limitReached: false });
  expect(f.connector.sendUpdate).toHaveBeenCalledTimes(1);
});


it('retries unsupported numeric claims once and keeps person-specific before/after capacity facts', async () => {
  const f = await fixture([interpret(), judge({ text: '999시간 늦어집니다.' }), request => {
    const { facts } = JSON.parse(request.messages[0]!.content);
    expect(facts.factList.find((f: any) => f.id === 'forecast:current').value.capacity).toContainEqual(expect.objectContaining({ memberId: 'designer', baselineWeeklyHours: 10 }));
    return judge({ text: '최대 7일 걸립니다.' });
  }]);
  expect((await f.coordinator.onMessage('m1')).posts[0]?.text).toBe('최대 7일 걸립니다.');
  expect(f.calls).toHaveLength(3);
});

it('stores this-week hours without changing baseline and asks about unclear duration', async () => {
  const f = await fixture([interpret({ ops: [{ type: 'set_availability', memberId: 'designer', weeklyHours: 4, period: 'this_week', sourceMessageIds: ['m1'] } as any] }), judge({ decision: 'silent', text: '' }), interpret({ ops: [{ type: 'set_availability', memberId: 'designer', weeklyHours: 6, period: 'unclear', sourceMessageIds: ['m2'] } as any] }), judge({ decision: 'silent', text: '' })], initialTasks, '이번 주는 4시간', 'designer');
  await f.coordinator.onMessage('m1');
  expect(project(await f.read()).availability.get('designer')).toBe(10);
  expect(project(await f.read()).availabilityOverrides.get('designer')?.get('2026-09-28')).toBe(4);
  await f.message('m2', 'designer', '당분간 6시간');
  expect((await f.coordinator.onMessage('m2')).posts[0]?.text).toContain('이번 주만인가요');
  expect(project(await f.read()).availability.get('designer')).toBe(10);
});

it('records both scope decisions, updates titles, and states remaining deadline overrun', async () => {
  const f = await fixture([interpret({ ops: [
    { type: 'exclude_scope', taskId: 'prototype', item: '결제', sourceMessageIds: ['m1'] },
    { type: 'limit_scope', taskId: 'design', items: ['요금제 비교', '가입'], sourceMessageIds: ['m1'] },
  ] }), judge()]);
  await f.add('availability_updated', { memberId: 'designer', weeklyHours: 5 });
  const result = await f.coordinator.onMessage('m1');
  expect(result.posts[0]?.text).toMatch(/결제 제외.*요금제 비교.*가입.*기한을 넘깁니다/);
  const next = project(await f.read());
  expect(next.plan?.version).toBe(2);
  expect(next.tasks.get('design')?.spec.title).toBe('design (요금제 비교·가입까지)');
  expect(next.tasks.get('prototype')?.spec.title).toContain('결제 제외');
});

it('waits for a present decider even when model wants to announce new deadline impact', async () => {
  const f = await fixture([interpret({ conversation: { questionMessageId: 'm2', waitingOnMemberIds: ['owner'], directedToPm: false } }), judge({ changesOpenQuestionAnswer: true })]);
  await f.message('m2', 'designer', '다음 주에 드려도 될까요?');
  expect((await f.coordinator.onMessage('m2')).posts).toEqual([]);
});


it('recognizes a previously spoken candidate forecast after it becomes current despite clock seconds', async () => {
  const f = await fixture([interpret({ ops: [{ type: 'set_availability', memberId: 'designer', weeklyHours: 5, sourceMessageIds: ['m1'] }] }), judge({ evidence: ['forecast:candidate'], text: '최대 14일입니다.' }), interpret(), judge({ evidence: ['forecast:current'], text: '최대 14일입니다.' })], initialTasks, '매주 5시간입니다', 'designer');
  expect((await f.coordinator.onMessage('m1')).posts).toHaveLength(1);
  await f.message('m2', 'owner', '계산 결과는요?');
  const retry = new Coordinator(f.store, fake([interpret(), judge({ evidence: ['forecast:current'], text: '최대 14일입니다.' })]).llm, f.connector, { ...ctx, clock: () => new Date('2026-09-28T00:00:20Z') });
  const r = await retry.onMessage('m2');
  expect(r.posts).toHaveLength(0);
});


it('records a declarative self-capacity update silently when the decider is in the conversation', async () => {
  const f = await fixture([interpret({ ops: [{ type: 'set_availability', memberId: 'designer', weeklyHours: 4, period: 'this_week', sourceMessageIds: ['m2'] } as any] }), judge({ whoseAction: 'designer', evidence: ['forecast:candidate'] })]);
  await f.message('m2', 'designer', '이번 주 휴가라 4시간밖에 안 돼요');
  expect((await f.coordinator.onMessage('m2')).posts).toEqual([]);
  expect(project(await f.read()).availabilityOverrides.get('designer')?.get('2026-09-28')).toBe(4);
});

it('answers a direct schedule question from calculated facts after two rejected judgements', async () => {
  const f = await fixture([
    interpret({ conversation: { questionMessageId: 'm1', directedToPm: true, waitingOnMemberIds: [] } }),
    judge({ evidence: ['invented'] }), judge({ text: '999시간 밀립니다.' }),
  ], initialTasks, 'PM, 프로토타입이 얼마나 밀리나요?');
  const r = await f.coordinator.onMessage('m1');
  expect(f.calls).toHaveLength(3);
  expect(r.posts[0]?.text).toContain('예상 종료는 10/5~10/5(서울 시간)');
  expect(r.posts[0]?.text).not.toContain('999');
  expect(r.posts.some(p => p.text === '제가 이 요청을 판단하지 못했어요. 무엇을 바꾸길 원하는지 한 문장으로 다시 알려 주세요')).toBe(true);
  expect(r.events[0]?.payload).toMatchObject({ decision: 'speak', evidence: ['forecast:current'] });
  expect(project(await f.read()).plan?.version).toBe(1);
});

it('recovers a direct schedule question when interpretation itself fails', async () => {
  const f = await fixture([null, null], initialTasks, '그럼 프로토타입이 밀리나?');
  const r = await f.coordinator.onMessage('m1');
  expect(f.calls).toHaveLength(2);
  expect(r.posts[0]?.text).toContain('현재 기록 기준 예상 종료');
});

it('explains missing forecast inputs rather than inventing a date after judgement failure', async () => {
  const f = await fixture([
    interpret({ conversation: { questionMessageId: 'm1', directedToPm: true, waitingOnMemberIds: [] } }), null, null,
  ], initialTasks, 'PM, 일정은요?');
  await f.add('plan_committed', { version: 2, basedOn: 1, tasks: [...initialTasks, task('new', 'outside')], approvedBy: 'owner', reason: 'new', sourceMessageIds: [] });
  const r = await f.coordinator.onMessage('m1');
  expect(r.posts[0]?.text).toContain('작업 예상 시간 미입력');
  expect(r.posts[0]?.text).toContain('종료일을 계산할 수 없습니다');
});

it('keeps Agent answer delivery even when its already-posted facts suppress channel speech', async () => {
  const f = await fixture([interpret(), judge(), interpret({ agentAnswers: [{ questionId: 'question:prototype:1', sourceMessageIds: ['m2'] }] }), judge()]);
  await f.coordinator.onMessage('m1');
  await f.add('pm_spoke', { considerationId: 'q', messageId: 'question:prototype:1', text: '가입 흐름만 만들까요?', kind: 'ask' });
  await f.message('m2', 'owner', '네, 가입 흐름만 만드세요');
  const r = await f.coordinator.onMessage('m2');
  expect(r.posts).toEqual([]);
  expect(r.agentAnswers).toEqual([{ taskId: 'prototype', questionId: 'question:prototype:1', text: '네, 가입 흐름만 만드세요' }]);
  expect(r.events[0]?.payload).toMatchObject({ decision: 'silent', alreadyKnows: 'yes' });
  expect((await f.coordinator.onMessage('m2')).agentAnswers).toBeUndefined();
});

it('rejects answer routing to an already-answered question', async () => {
  const answer = interpret({ agentAnswers: [{ questionId: 'question:prototype:1', sourceMessageIds: ['m1'] }] });
  const f = await fixture([answer, answer]);
  await f.add('pm_spoke', { considerationId: 'q', messageId: 'question:prototype:1', text: '가입 흐름만 만들까요?', kind: 'ask' });
  await f.add('change_notified', { changeId: 'answer:question:prototype:1', planVersion: 1, recipientId: 'agent', via: 'next_turn', text: '이미 답함' });
  expect((await f.coordinator.onMessage('m1')).agentAnswers).toBeUndefined();
});

it('reinterprets current ledger after a race and applies the human availability once', async () => {
  const f = await fixture([], initialTasks, '이번 주 4시간만 가능해요', 'designer');
  let judgements = 0;
  const snapshots: number[] = [];
  const llm: LlmProvider = { async complete(request) {
    const facts = JSON.parse(request.messages[0]!.content).facts;
    if (request.forceTool === 'interpret_coordination') snapshots.push(facts.estimates.find(([id]: [string]) => id === 'prototype')[1].hours?.max ?? facts.estimates.find(([id]: [string]) => id === 'prototype')[1].max);
    if (request.forceTool === 'judge_coordination' && judgements++ === 0) await f.add('estimate_updated', { taskId: 'prototype', hours: { min: 20, max: 20 }, source: 'human' });
    const input = request.forceTool === 'interpret_coordination' ? interpret({ ops: [{ type: 'set_availability', memberId: 'designer', weeklyHours: 4, period: 'this_week', sourceMessageIds: ['m1'] } as any] }) : judge({ decision: 'silent', text: '' });
    return { text: '', model: 'fake', responseId: 'r', usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [{ name: request.forceTool!, input: input as unknown as Record<string, unknown> }] };
  } };
  const r = await new Coordinator(f.store, llm, f.connector, ctx).onMessage('m1');
  expect(judgements).toBe(2);
  expect(snapshots).toEqual([10, 20]);
  expect(project(await f.read()).availabilityOverrides.get('designer')?.get('2026-09-28')).toBe(4);
  expect(r.events.filter(e => e.type === 'availability_updated')).toHaveLength(1);
  expect((await f.read()).filter(e => e.type === 'pm_considered' && e.payload.triggerId === 'm1')).toHaveLength(1);
});

it('offers a planning start when a human enters a goal before any committed plan', async () => {
  const store = new MemoryLedgerStore();
  const { clock: _clock, ...context } = ctx;
  await store.append([
    { ...context, actor: { kind: 'system', id: 'pm' }, type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: '사용자' } },
    { ...context, actor: { kind: 'human', id: 'owner' }, type: 'message_recorded', payload: { messageId: 'goal', authorId: 'owner', text: '2주 안에 고객 반응을 확인하고 싶어요', attachmentIds: [] } },
  ]);
  const r = await new Coordinator(store, fake([null, null]).llm, { sendUpdate: vi.fn() }, ctx).onMessage('goal');
  expect(r.posts[0]?.text).toContain('계획');
  expect(r.posts[0]?.text).toContain('자유형식');
  expect(r.events.some(e => e.type === 'plan_committed')).toBe(false);
});

it.each([false, true])('preserves accepted flow and routes scope reduction to unfinished dependents (both named: %s)', async both => {
  const tasks = initialTasks.map(t => t.id === 'prototype' ? { ...t, dependsOn: ['design'] } : t);
  const ops: PlanOp[] = [{ type: 'exclude_scope', taskId: 'design', item: '결제', sourceMessageIds: ['m1'] }, ...(both ? [{ type: 'exclude_scope' as const, taskId: 'prototype', item: '결제', sourceMessageIds: ['m1'] }] : [])];
  const f = await fixture([interpret({ ops }), judge()], tasks, '결제 빼자', 'owner', false);
  await f.add('result_submitted', { taskId: 'design', resultId: 'flow-result', planVersion: 1, summary: '완성', artifactIds: [] });
  await f.add('task_checked', { taskId: 'design', resultId: 'flow-result', reason: '충족' });
  await f.add('task_start_reserved', { taskId: 'prototype', specVersion: 1, trigger: 'flow-result' });
  await f.add('task_started', { taskId: 'prototype', turnId: 'turn-1' });
  const before = project(await f.read());
  const r = await f.coordinator.onMessage('m1');
  const state = project(await f.read());
  expect(state.tasks.get('design')).toMatchObject({ status: 'checked', checkedResultId: 'flow-result', specVersion: 1, spec: before.tasks.get('design')!.spec });
  expect(state.tasks.get('prototype')).toMatchObject({ status: 'running', spec: { handoffConditions: ['초안', '결제'], exclusions: ['결제'] } });
  expect(f.connector.sendUpdate).toHaveBeenCalledTimes(1);
  expect(r.events.filter(e => e.type === 'plan_committed')).toHaveLength(1);
  expect(planStarts(state, 'test', ctx).some(e => (e.payload as { taskId?: string }).taskId === 'design')).toBe(false);
  expect(forecastFromState(state, ctx.clock())).toEqual(forecastFromState(before, ctx.clock()));
});

it('ignores early-handoff on accepted work including a blocked accepted task', async () => {
  const f = await fixture([interpret({ ops: [{ type: 'handoff_early', taskId: 'design', sourceMessageIds: ['m1'] }] }), judge({ decision: 'silent', text: '' })]);
  await f.add('result_submitted', { taskId: 'design', resultId: 'flow-result', planVersion: 1, summary: '완성', artifactIds: [] });
  await f.add('task_checked', { taskId: 'design', resultId: 'flow-result', reason: '충족' });
  await f.add('task_blocked', { taskId: 'design', reason: '외부 확인 대기' });
  const r = await f.coordinator.onMessage('m1');
  expect(r.events.some(e => e.type === 'plan_committed')).toBe(false);
  expect(project(await f.read()).tasks.get('design')).toMatchObject({ checkedResultId: 'flow-result', blocked: { prevStatus: 'checked' } });
});

it('notifies the rework assignee and an already-running dependent when an accepted spec genuinely changes', async () => {
  const tasks = initialTasks.map(t => t.id === 'prototype' ? { ...t, dependsOn: ['design'] } : t);
  const f = await fixture([interpret({ ops: [{ type: 'reassign', taskId: 'design', assignee: 'outside', sourceMessageIds: ['m1'] }] }), judge()], tasks, '흐름 설계는 제가 다시 맡겠습니다', 'outside', false);
  await f.add('result_submitted', { taskId: 'design', resultId: 'flow-result', planVersion: 1, summary: '완성', artifactIds: [] });
  await f.add('task_checked', { taskId: 'design', resultId: 'flow-result', reason: '충족' });
  await f.add('task_start_reserved', { taskId: 'prototype', specVersion: 1, trigger: 'flow-result' });
  await f.add('task_started', { taskId: 'prototype', turnId: 'turn-1' });
  const r = await f.coordinator.onMessage('m1');
  const state = project(await f.read());
  expect(state.tasks.get('design')).toMatchObject({ status: 'ready', specVersion: 2, spec: { assignee: 'outside' } });
  expect(state.tasks.get('design')?.checkedResultId).toBeUndefined();
  expect(f.connector.sendUpdate).toHaveBeenCalledWith('agent', expect.objectContaining({ change: [expect.stringContaining('명세가 바뀌어 다시 확인이 필요')] }));
  expect(r.posts.some(p => p.text.includes('outside') && p.text.includes('다시 확인이 필요'))).toBe(true);
});

// Captured from real-provider replays of the HTTP attempt4 ledger at seq 281.
// Both arrays are invalid: that project had no decision_recorded events at all.
it.each([['task:flow', 'task:prototype'], ['847fd924-16d1-426c-b815-9af7cd377e9e']])('corrects observed non-decision conflicts %j and applies short decider assent downstream', async (...conflicts: string[]) => {
  const tasks = initialTasks.map(t => t.id === 'prototype' ? { ...t, dependsOn: ['design'] } : t);
  const accepted = interpret({
    category: 'scope_change', summary: '디자이너의 결제 제외 제안을 오너가 승인했다.',
    ops: [
      { type: 'exclude_scope', taskId: 'design', item: '결제', sourceMessageIds: ['m1', 'approval'] },
      { type: 'exclude_scope', taskId: 'prototype', item: '결제', sourceMessageIds: ['m1', 'approval'] },
    ],
  });
  const f = await fixture([{ ...accepted, conflicts }, request => {
    const input = JSON.parse(request.messages[0]!.content);
    expect(input.validationError).toContain('conflicts');
    expect(input.validationError).toContain('기존 결정이 없으므로 conflicts는 반드시 []');
    expect((request.tools![0]!.inputSchema.properties as any).conflicts).toMatchObject({ maxItems: 0 });
    return accepted;
  }, judge()], tasks, '초안으로 먼저 가주세요. 결제 쪽은 아직 애매해서 빼면 좋겠어요.', 'designer', false);
  await f.add('result_submitted', { taskId: 'design', resultId: 'flow-result', planVersion: 1, summary: '완성', artifactIds: [] });
  await f.add('task_checked', { taskId: 'design', resultId: 'flow-result', reason: '충족' });
  await f.add('task_start_reserved', { taskId: 'prototype', specVersion: 1, trigger: 'flow-result' });
  await f.add('task_started', { taskId: 'prototype', turnId: 'turn-1' });
  await f.message('approval', 'owner', 'ㅇㅋ 결제는 이번엔 빼자');
  const r = await f.coordinator.onMessage('approval');
  const state = project(await f.read());
  expect(f.calls).toHaveLength(3);
  expect(r.posts[0]?.text).toContain('정리하면:');
  expect(state.plan?.version).toBe(2);
  expect(state.tasks.get('design')).toMatchObject({ status: 'checked', specVersion: 1, checkedResultId: 'flow-result' });
  expect(state.tasks.get('prototype')?.spec).toMatchObject({ handoffConditions: ['초안', '결제'], exclusions: ['결제'] });
  expect(f.connector.sendUpdate).toHaveBeenCalledTimes(1);
});

it('applies normal short assent using both the proposal and the decider message without retry', async () => {
  const f = await fixture([interpret({ ops: [{ type: 'exclude_scope', taskId: 'prototype', item: '결제', sourceMessageIds: ['m1', 'approval'] }] }), judge()], initialTasks, '결제 쪽은 아직 애매해서 빼면 좋겠어요.', 'designer');
  await f.message('approval', 'owner', 'ㅇㅋ 결제는 이번엔 빼자');
  const r = await f.coordinator.onMessage('approval');
  expect(f.calls).toHaveLength(2);
  expect(r.posts[0]?.text).toContain('정리하면:');
  expect(project(await f.read()).plan?.version).toBe(2);
  expect(r.events.find(e => e.type === 'decision_recorded')?.payload).toMatchObject({ sourceMessageIds: ['m1', 'approval'] });
  expect(f.connector.sendUpdate).toHaveBeenCalledTimes(1);
});

it('accepts a valid recorded conflict ID and exposes only decision IDs in the schema', async () => {
  const f = await fixture([request => {
    expect((request.tools![0]!.inputSchema.properties as any).conflicts.items.enum).toEqual(['existing-decision']);
    return interpret({ ops: exclusions(), conflicts: ['existing-decision'] });
  }, judge()]);
  await f.add('decision_recorded', { decisionId: 'existing-decision', summary: '결제 포함', sourceMessageIds: [], approvedBy: 'owner', changeKinds: ['scope_add'] });
  expect((await f.coordinator.onMessage('m1')).posts[0]?.kind).toBe('summary');
  expect(project(await f.read()).plan?.version).toBe(2);
});

it('never turns a repeatedly invented conflict ID into an approved change', async () => {
  const invalid = interpret({ ops: exclusions(), conflicts: ['task:prototype'] });
  const f = await fixture([invalid, invalid]);
  const r = await f.coordinator.onMessage('m1');
  expect(r.posts[0]?.text).toContain('다시 알려 주세요');
  expect(project(await f.read()).plan?.version).toBe(1);
  expect(f.connector.sendUpdate).not.toHaveBeenCalled();
});

it('does not infer a choice from ambiguous assent to several proposals', async () => {
  const f = await fixture([interpret({ ops: [], summary: '어느 범위 제안인지 모호하다' }), judge({ decision: 'silent', text: '', openTopics: ['결제 제외와 가입 제외 중 무엇인지 확인 필요'] })], initialTasks, '결제를 뺄까요, 가입을 뺄까요?', 'designer');
  await f.message('assent', 'owner', '그걸로 하자');
  await f.coordinator.onMessage('assent');
  expect(project(await f.read()).plan?.version).toBe(1);
  expect(f.connector.sendUpdate).not.toHaveBeenCalled();
});

it('keeps one update_sent when the runner records its own steer, and counts it once toward the automation limit', async () => {
  const steer = async (recordsItself: boolean) => {
    const f = await fixture([interpret({ ops: exclusions(['m1', 'designer-agrees']) }), judge()]);
    await f.message('designer-agrees', 'designer', '초안으로 먼저 가세요');
    // Like SessionRunner.sendUpdate: the steer itself writes update_sent as the PM's action.
    f.connector.sendUpdate.mockImplementation(async (agentId: string, input: UpdateInstructionsInput) => {
      if (recordsItself) await f.store.append([{ projectId: ctx.projectId, targetProductId: ctx.targetProductId, actor: { kind: 'pm', id: 'pm' }, type: 'update_sent',
        payload: { updateId: input.updateId, taskId: 'prototype', fromVersion: input.fromVersion, toVersion: input.toVersion, turnId: 'turn-1' }, idempotencyKey: `update:${input.updateId}:sent` }]);
      return { sent: true, reason: agentId };
    });
    await f.coordinator.onMessage('designer-agrees');
    const events = await f.read();
    return { sent: events.filter(e => e.type === 'update_sent').length, actions: project(events).automation.actionsSinceResume, via: events.find(e => e.type === 'change_notified' && e.payload.recipientId === 'agent')?.payload };
  };
  const runner = await steer(true);
  const plain = await steer(false);
  expect(runner.sent).toBe(1);
  expect(plain.sent).toBe(1);
  expect(runner.actions).toBe(plain.actions);
  expect(runner.via).toMatchObject({ via: 'steer' });
});

it('defers a queued older input to the same person’s latest message without losing context', async () => {
  const f = await fixture([request => {
    const {facts} = JSON.parse(request.messages[0]!.content);
    expect(facts.messages.map((m: any) => m.messageId)).toEqual(expect.arrayContaining(['m1', 'm2']));
    return interpret();
  }, judge()]);
  await f.message('m2', 'owner', '정정: 결제는 유지하세요');
  expect((await f.coordinator.onMessage('m1')).posts).toEqual([]);
  expect(f.calls).toHaveLength(0);
  await f.coordinator.onMessage('m2');
  expect(project(await f.read()).plan?.version).toBe(1);
});

it('does not commit stale scope changes when a correction arrives during the model call', async () => {
  const f = await fixture([async () => {
    await f.message('m2', 'owner', '정정: 결제는 유지하세요');
    return interpret({ops: exclusions()});
  }, judge()]);
  const result = await f.coordinator.onMessage('m1');
  expect(result.posts).toEqual([]);
  expect(project(await f.read()).plan?.version).toBe(1);
  expect(f.connector.sendUpdate).not.toHaveBeenCalled();
});

it.each(['different author', 'attachment', 'task comment'])('does not preempt unrelated %s intake', async kind => {
  let entered!: () => void;
  let release!: (value: object) => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const delayed = new Promise<object>(resolve => { release = resolve; });
  const f = await fixture([() => { entered(); return delayed; }, judge()]);
  const pending = f.coordinator.onMessage('m1');
  await started;
  await f.add('message_recorded', { messageId: 'm2', authorId: kind === 'different author' ? 'designer' : 'owner', text: 'independent input', attachmentIds: kind === 'attachment' ? ['file'] : [], ...(kind === 'task comment' ? { threadId: 'task:prototype' } : {}) });
  await f.coordinator.messageRecorded('m2');
  expect(f.calls[0]!.signal?.aborted).toBe(false);
  release(interpret());
  const result = await pending;
  expect((result.events as AnyEvent[]).some(e => e.type === 'pm_considered' && e.payload.considerationId === 'superseded:m1')).toBe(false);
  expect(f.calls).toHaveLength(2);
});

it('preempts a pending judgement and never applies its stale plan operations', async () => {
  let entered!: () => void;
  let release!: (value: object) => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const delayed = new Promise<object>(resolve => { release = resolve; });
  const f = await fixture([interpret({ ops: exclusions() }), () => { entered(); return delayed; }]);
  const pending = f.coordinator.onMessage('m1');
  await started;
  await f.message('m2', 'owner', 'Keep all scope');
  await f.coordinator.messageRecorded('m2');
  const result = await pending;
  expect(result.events).toHaveLength(1);
  expect(result.events[0]!.payload).toMatchObject({ considerationId: 'superseded:m1' });
  const before = await f.read();
  release(judge());
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(await f.read()).toEqual(before);
  expect(project(before).plan?.version).toBe(1);
  expect(f.connector.sendUpdate).not.toHaveBeenCalled();
});

it.each(['attachment', 'task comment'])('does not preempt an earlier %s when ordinary chat arrives', async kind => {
  let entered!: () => void;
  let release!: (value: object) => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const delayed = new Promise<object>(resolve => { release = resolve; });
  const f = await fixture([() => { entered(); return delayed; }, judge()]);
  await f.add('message_recorded', { messageId: 'm2', authorId: 'owner', text: 'independent input', attachmentIds: kind === 'attachment' ? ['file'] : [], ...(kind === 'task comment' ? { threadId: 'task:prototype' } : {}) });
  const pending = f.coordinator.onMessage('m2');
  await started;
  await f.message('m3');
  await f.coordinator.messageRecorded('m3');
  expect(f.calls[0]!.signal?.aborted).toBe(false);
  release(interpret());
  const result = await pending;
  expect((result.events as AnyEvent[]).some(e => e.type === 'pm_considered' && e.payload.considerationId === 'superseded:m2')).toBe(false);
  expect(f.calls).toHaveLength(2);
});
