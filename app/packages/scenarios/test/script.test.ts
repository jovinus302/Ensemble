import { expect, it, vi } from 'vitest';
import { project, type NewLedgerEvent, type TaskSpec } from '@ensemble/core';
import { MemoryLedgerStore } from '@ensemble/store';
import { resolveTarget, waitForCondition, conditionMet, advanceScript, continuousScenario, type Condition, type ScriptHost, type ScriptProgress } from '../src/index.ts';
const ctx = { projectId: 'test', targetProductId: 'product', actor: { kind: 'system' as const, id: 'test' } };
it.each([false, true])('answers a scope clarification only when the PM newly asks for it (%s)', async asks => {
  const store = new MemoryLedgerStore();
  await store.append([
    { ...ctx, type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: '사용자' } },
    { ...ctx, type: 'goal_set', payload: { text: '예약 시연', decider: 'owner', delegation: { pmMayApply: ['scope_reduce'] } } },
    { ...ctx, type: 'pm_spoke', payload: { messageId: 'old', considerationId: 'old', kind: 'answer', text: '적용할 작업과 변경할 범위를 다시 알려주시겠어요?' } },
  ]);
  const progress: ScriptProgress = { step: 1, anchors: { 0: project(await store.read()).lastSeq } };
  if (asks) await store.append([{ ...ctx, type: 'pm_spoke', payload: { messageId: 'new', considerationId: 'new', kind: 'answer', text: '변경 내용을 확인하지 못해, 적용할 작업과 변경할 범위를 다시 알려주시겠어요?' } }]);
  const postMessage = vi.fn(async () => []);
  const host = { read: () => store.read(), recordStop: vi.fn(), pm: { postMessage } } as unknown as ScriptHost;
  const reply = continuousScenario.steps.at(-1)!;
  await advanceScript(host, [{ as: 'owner', text: '결제 제외' }, reply], progress);
  expect(postMessage).toHaveBeenCalledTimes(asks ? 1 : 0);
  if (asks) expect(postMessage).toHaveBeenCalledWith('owner', reply.text);
  expect(progress.step).toBe(2);
});
const task = (id: string, assignee = 'designer', dependsOn: string[] = []): TaskSpec => ({ id, assignee, dependsOn, title: id, handoffConditions: ['done'] });
it('C4 reports the submitted user task in Korean instead of No active task for assignee owner', async () => {
  const store = await ledger([task('interview', 'owner')]);
  await store.append([
    { ...ctx, type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: '사용자' } },
    { ...ctx, type: 'result_submitted', payload: { taskId: 'interview', resultId: 'r', planVersion: 1, summary: '인터뷰 자료', artifactIds: [] } },
  ]);
  const state = project(await store.read());
  expect(() => resolveTarget(state, { assignee: 'owner' })).toThrow('사용자 작업이 진행 가능한 상태가 아닙니다(현재: 확인 중)');
});
async function ledger(tasks: TaskSpec[] = [task('later', 'designer', ['earlier']), task('earlier'), task('other', 'owner')]) {
  const store = new MemoryLedgerStore();
  await store.append([{ ...ctx, type: 'plan_committed', payload: { version: 1, basedOn: null, tasks, reason: 'test', approvedBy: 'owner', sourceMessageIds: [] } }]);
  return store;
}
it('resolves by assignee and dependency order, distinguishes active/next, and rejects absent roles', async () => {
  const store = await ledger();
  expect(resolveTarget(project(await store.read()), { assignee: 'designer', pick: 'next' })).toBe('earlier');
  expect(() => resolveTarget(project([]), { assignee: 'missing' })).toThrow('작업 없음');
  await store.append(['later', 'earlier'].map(taskId => ({ ...ctx, type: 'task_started', payload: { taskId } })));
  expect(resolveTarget(project(await store.read()), { assignee: 'designer' })).toBe('earlier');
  expect(resolveTarget(project(await store.read()), { assignee: 'owner', pick: 'next' })).toBe('other');
  expect(() => resolveTarget(project([]), { assignee: 'designer' })).toThrow();
});
const cases: [Condition, NewLedgerEvent[]][] = [
  [{ kind: 'taskOf', assignee: 'designer', status: 'running' }, [{ ...ctx, type: 'task_started', payload: { taskId: 'earlier' } }]],
  [{ kind: 'planVersionAtLeast', version: 2 }, [{ ...ctx, type: 'plan_committed', payload: { version: 2, basedOn: 1, tasks: [task('earlier')], reason: 'changed', approvedBy: 'owner', sourceMessageIds: [] } }]],
  [{ kind: 'planApprovalPending' }, [{ ...ctx, type: 'plan_proposed', payload: { proposalId: 'proposal', version: 1, tasks: [task('earlier')], estimates: [], reason: 'draft', forMemberId: 'owner' } }]],
  [{ kind: 'pmSpokeAfter', stepIndex: 0 }, [{ ...ctx, type: 'pm_spoke', payload: { messageId: 'speech', considerationId: 'c', text: 'question', kind: 'ask' } }]],
  [{ kind: 'silentAfter', stepIndex: 0 }, [{ ...ctx, type: 'pm_considered', payload: { considerationId: 'c', triggerId: 'm', whoseAction: null, alreadyKnows: 'yes', evidence: [], decision: 'silent', reason: 'known', openTopics: [] } }]],
  [{ kind: 'agentTurnFinished', agentId: 'agent' }, [{ ...ctx, type: 'turn_finished', payload: { agentId: 'agent', taskId: 'earlier' } }]],
  [{ kind: 'agentTurnRunning', agentId: 'designer' }, [
    { ...ctx, type: 'member_joined', payload: { memberId: 'designer', kind: 'agent', displayName: 'Agent' } },
    { ...ctx, type: 'task_start_reserved', payload: { taskId: 'earlier', specVersion: 1, trigger: 'start' } },
    { ...ctx, type: 'task_started', payload: { taskId: 'earlier', turnId: 'turn' } },
  ]],
  [{ kind: 'agentUpdated', agentId: 'designer', afterStep: 0 }, [{ ...ctx, type: 'update_acknowledged', payload: { taskId: 'earlier', updateId: 'u', planVersion: 2, applied: [], dropped: [] } }]],
];
it('allows an unreserved ready human task through the interview and design gates', async () => {
  const store = await ledger([task('interview', 'owner'), task('design', 'designer')]);
  const events = await store.read();
  expect(project(events).tasks.get('interview')?.status).toBe('ready');
  expect(conditionMet({ kind: 'taskOf', assignee: 'owner', status: 'reserved' }, events, {})).toBe(false);
  for (const index of [4, 6]) expect(conditionMet(continuousScenario.steps[index]!.waitFor!, events, {})).toBe(true);
  expect(resolveTarget(project(events), { assignee: 'owner' })).toBe('interview');
  expect(resolveTarget(project(events), { assignee: 'designer' })).toBe('design');
});
it.each(cases)('waits for %j and reports timeout without a matching ledger fact', async (condition, added) => {
  const store = await ledger();
  const anchors = { 0: project(await store.read()).lastSeq };
  let now = 0;
  const timed = { ...condition, timeoutMs: 10 };
  expect(conditionMet(timed, await store.read(), anchors)).toBe(false);
  await expect(waitForCondition(timed, () => store.read(), anchors, { now: () => now, pause: async ms => { now += ms; } })).rejects.toThrow('waiting for');
  await store.append(added);
  await waitForCondition(timed, () => store.read(), anchors, { pause: async () => { throw new Error('must not delay'); } });
  expect(conditionMet({ kind: 'all', conditions: [condition] }, await store.read(), anchors)).toBe(true);
  expect(conditionMet({ kind: 'any', conditions: [condition] }, await store.read(), anchors)).toBe(true);
});
it('does not count speech predating its step or an unfinished agent turn', async () => {
  const store = await ledger();
  await store.append(cases[3]![1]);
  const events = await store.read();
  expect(conditionMet(cases[3]![0], events, { 0: project(events).lastSeq })).toBe(false);
  expect(conditionMet(cases[3]![0], events, {})).toBe(false);
  expect(conditionMet({ kind: 'agentTurnFinished', agentId: 'absent' }, events, {})).toBe(false);
});
it('records the failed step once and prevents later human inputs', async () => {
  const store = await ledger();
  const recordStop = vi.fn(async () => {}), postMessage = vi.fn();
  const host = { read: () => store.read(), recordStop, pm: { postMessage } } as unknown as ScriptHost;
  const progress: ScriptProgress = { step: 0, anchors: {} };
  const steps = [{ as: 'owner', text: 'never sent', waitFor: { kind: 'planApprovalPending' as const, timeoutMs: 0 } }];
  await expect(advanceScript(host, steps, progress)).rejects.toThrow('대본 1단계');
  expect(recordStop).toHaveBeenCalledOnce();
  expect(progress.stopped).toContain('대본 진행 조건');
  await expect(advanceScript(host, steps, progress)).rejects.toThrow('대본 1단계');
  expect(postMessage).not.toHaveBeenCalled();
  expect(recordStop).toHaveBeenCalledOnce();
});
it('retries a completion wait without delivering the final human input twice', async () => {
  const store = await ledger();
  await store.append([{ ...ctx, type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: 'Owner' } }]);
  const postMessage = vi.fn(async () => []);
  const host = { read: () => store.read(), recordStop: vi.fn(), pm: { postMessage } } as unknown as ScriptHost;
  const progress: ScriptProgress = { step: 0, anchors: {} };
  const steps = [{ as: 'owner', text: 'final decision' }];
  const completion: Condition = { kind: 'planVersionAtLeast', version: 2, timeoutMs: 0 };
  await expect(advanceScript(host, steps, progress, completion)).rejects.toThrow();
  delete progress.stopped;
  await store.append([{ ...ctx, type: 'plan_committed', payload: { version: 2, basedOn: 1, tasks: [], reason: 'test', approvedBy: 'owner', sourceMessageIds: [] } }]);
  await advanceScript(host, steps, progress, completion);
  expect(postMessage).toHaveBeenCalledOnce();
  expect(progress.step).toBe(1);
});
it.each([true, false])('answers an offered choice only when PM asked (%s)', async asked => {
  const store = await ledger();
  await store.append([{ ...ctx, type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: 'Owner' } }]);
  const after = project(await store.read()).lastSeq;
  if (asked) await store.append([{ ...ctx, type: 'pm_spoke', payload: { considerationId: 'q', messageId: 'q', kind: 'ask', text: '우선 대상은? (선택지: 가입 / 결제)' } }]);
  const postMessage = vi.fn(async () => []);
  const host = { read: () => store.read(), recordStop: vi.fn(), pm: { postMessage } } as unknown as ScriptHost;
  const progress: ScriptProgress = { step: 1, anchors: { 0: after } };
  await advanceScript(host, [{ as: 'owner', text: 'interview' }, { as: 'owner', text: 'first choice', action: 'answerIfAsked' }], progress);
  if (asked) expect(postMessage).toHaveBeenCalledWith('owner', '가입');
  else expect(postMessage).not.toHaveBeenCalled();
  expect(progress.step).toBe(2);
});
it('resolves reserved and revising active tasks and leaves finished tasks out', async () => {
  const store = await ledger([task('a'), task('b')]);
  await store.append([{ ...ctx, type: 'task_start_reserved', payload: { taskId: 'a', specVersion: 1, trigger: 'test' } }]);
  expect(resolveTarget(project(await store.read()), { assignee: 'designer' })).toBe('a');
  await store.append([{ ...ctx, type: 'revision_requested', payload: { taskId: 'a', resultId: 'r', missing: ['fix'] } }]);
  expect(resolveTarget(project(await store.read()), { assignee: 'designer' })).toBe('a');
  await store.append([
    { ...ctx, type: 'result_submitted', payload: { taskId: 'a', resultId: 'r', planVersion: 1, summary: 'done', artifactIds: [] } },
    { ...ctx, type: 'task_checked', payload: { taskId: 'a', resultId: 'r', reason: 'done' } },
  ]);
  expect(resolveTarget(project(await store.read()), { assignee: 'designer', pick: 'next' })).toBe('b');
  expect(() => resolveTarget(project([]), { assignee: 'designer' })).toThrow('작업 없음');
});
it('passes over a reply line the PM never asked for, so the next line offered is always one that posts', async () => {
  const store = new MemoryLedgerStore();
  await store.append([
    { ...ctx, type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: '사용자' } },
    { ...ctx, type: 'goal_set', payload: { text: '예약 시연', decider: 'owner', delegation: { pmMayApply: ['scope_reduce'] } } },
  ]);
  const postMessage = vi.fn(async () => []);
  const host = { read: () => store.read(), recordStop: vi.fn(), pm: { postMessage } } as unknown as ScriptHost;
  const clarify = continuousScenario.steps.at(-1)!;
  const steps = [{ as: 'owner', text: 'ㅇㅋ 결제는 이번엔 빼자' }, clarify, { as: 'owner', text: '다음 이야기' }];
  const progress: ScriptProgress = { step: 0, anchors: {} };
  await advanceScript(host, steps, progress);
  // The PM applied the exclusion without asking: the clarification is never offered, the script moves to the next real line.
  expect(postMessage.mock.calls.map(c => (c as unknown[])[1])).toEqual(['ㅇㅋ 결제는 이번엔 빼자']);
  expect(progress.step).toBe(2);
  await advanceScript(host, steps, progress);
  expect(progress.step).toBe(3);
  expect(postMessage).toHaveBeenCalledTimes(2);
  // When the PM does ask, the clarification is the next line and it posts.
  const asked: ScriptProgress = { step: 0, anchors: {} };
  postMessage.mockImplementationOnce(async () => {
    await store.append([{ ...ctx, type: 'pm_spoke', payload: { messageId: 'q', considerationId: 'q', kind: 'answer', text: '변경 내용을 확인하지 못해, 적용할 작업과 변경할 범위를 다시 알려주시겠어요?' } }]);
    return [];
  });
  await advanceScript(host, steps, asked);
  expect(asked.step).toBe(1);
  await advanceScript(host, steps, asked);
  expect(postMessage).toHaveBeenLastCalledWith('owner', clarify.text);
});
