import { project, type AnyEvent, type LedgerEvent } from '@ensemble/core';

export type ResolutionAction = 'accept' | 'retry' | 'recheck';
/** A submitted result is recoverable only after a recorded technical failure, not while review is running. */
export function taskResolutions(events: readonly LedgerEvent[], me: string) {
  const state = project(events), typed = events as readonly AnyEvent[];
  return [...state.tasks.values()].flatMap(task => {
    const result = typed.findLast(e => e.type === 'result_submitted' && e.payload.taskId === task.spec.id);
    const failed = task.status === 'submitted' && result?.type === 'result_submitted' && typed.some(e => e.seq > result.seq && e.type === 'pm_considered' && e.payload.triggerId === result.payload.resultId && e.payload.reason === '결과 내용이 아니라 판단 과정의 문제라 사람이 결과를 확인해야 한다');
    if (task.status !== 'blocked' && !failed) return [];
    const authorized = state.members.get(me)?.kind === 'human' && (state.goal?.decider === me || task.spec.assignee === me);
    const actions: ResolutionAction[] = authorized ? [...(state.goal?.decider === me && result ? ['accept' as const] : []), 'retry', ...(failed ? ['recheck' as const] : [])] : [];
    return [{ taskId: task.spec.id, title: task.spec.title, reason: task.blocked?.reason ?? '인계 검토를 마치지 못했습니다. 결과를 확인하거나 다시 검토해 주세요.', actions }];
  });
}
