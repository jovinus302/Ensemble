import { expect, it } from 'vitest';
import { MemoryLedgerStore } from '@ensemble/store';
import { taskResolutions } from '../lib/task-resolution';

it('offers accept only to the decider and recheck only after the current submitted result failed technically', async () => {
  const store = new MemoryLedgerStore();
  const ctx = { projectId: 'p', targetProductId: 'p', actor: { kind: 'system' as const, id: 'test' } };
  await store.append([
    ...['owner', 'designer', 'other'].map(memberId => ({ ...ctx, type: 'member_joined', payload: { memberId, kind: 'human', displayName: memberId } })),
    { ...ctx, type: 'goal_set', payload: { text: '예약 서비스', decider: 'owner', delegation: { pmMayApply: [] } } },
    { ...ctx, type: 'plan_committed', payload: { version: 1, basedOn: null, tasks: [{ id: 'flow', title: '흐름 설계', assignee: 'designer', dependsOn: [], handoffConditions: ['가입'] }], reason: '계획', approvedBy: 'owner', sourceMessageIds: [] } },
    { ...ctx, type: 'result_submitted', payload: { taskId: 'flow', resultId: 'r1', planVersion: 1, summary: '초안', artifactIds: [] } },
  ]);
  expect(taskResolutions(await store.read(), 'owner')).toEqual([]);
  await store.append([{ ...ctx, type: 'pm_considered', payload: { considerationId: 'handoff-notice:r1', triggerId: 'r1', whoseAction: 'owner', alreadyKnows: 'no', evidence: ['r1'], decision: 'speak', reason: '결과 내용이 아니라 판단 과정의 문제라 사람이 결과를 확인해야 한다', openTopics: [] } }]);
  expect(taskResolutions(await store.read(), 'owner')[0]?.actions).toEqual(['accept', 'retry', 'recheck']);
  expect(taskResolutions(await store.read(), 'designer')[0]?.actions).toEqual(['retry', 'recheck']);
  expect(taskResolutions(await store.read(), 'other')[0]?.actions).toEqual([]);
  await store.append([{ ...ctx, type: 'result_submitted', payload: { taskId: 'flow', resultId: 'r2', planVersion: 1, summary: '새 초안', artifactIds: [] } }]);
  expect(taskResolutions(await store.read(), 'owner')).toEqual([]);
  await store.append([{ ...ctx, type: 'task_blocked', payload: { taskId: 'flow', reason: '보완 한도 초과', unblockBy: 'owner' } }]);
  expect(taskResolutions(await store.read(), 'owner')[0]?.actions).toEqual(['accept', 'retry']);
});
