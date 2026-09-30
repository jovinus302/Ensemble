import type { ChangeKind, TaskSpec } from './events.ts';
import type { ProjectState } from './projection.ts';
import { whoApproves } from './authority.ts';

export type PlanOp = ({ type: 'set_availability'; memberId: string; weeklyHours: number }
  | { type: 'exclude_scope'; taskId: string; item: string }
  | { type: 'handoff_early'; taskId: string }
  | { type: 'reassign'; taskId: string; assignee: string }
  | { type: 'set_deadline'; date: string }
  | { type: 'change_goal'; text: string }) & { sourceMessageIds: string[] };

/** Only these operations can modify a plan. Input and unrelated fields are preserved. */
export function applyOps(plan: readonly TaskSpec[], ops: readonly PlanOp[]): TaskSpec[] {
  const tasks = structuredClone([...plan]);
  for (const op of ops) {
    if (!('taskId' in op)) continue;
    const task = tasks.find(t => t.id === op.taskId);
    if (!task) throw new Error(`Unknown task ${op.taskId}`);
    if (op.type === 'reassign') task.assignee = op.assignee;
    else {
      const condition = op.type === 'exclude_scope' ? `제외: ${op.item}` : '초안 단계에서 인계 가능';
      if (!task.handoffConditions.includes(condition)) task.handoffConditions.push(condition);
    }
  }
  return tasks;
}

export function opAuthority(state: ProjectState, op: PlanOp): { kind: ChangeKind; personId?: string; allowed: boolean } {
  const kind: ChangeKind = op.type === 'set_availability' ? 'human_commitment'
    : op.type === 'exclude_scope' ? 'scope_reduce' : op.type === 'handoff_early' ? 'reorder'
    : op.type === 'set_deadline' ? 'deadline_change' : op.type === 'change_goal' ? 'goal_change'
    : state.members.get(op.assignee)?.kind === 'human' || state.members.get(state.plan?.tasks.find(t => t.id === op.taskId)?.assignee ?? '')?.kind === 'human' ? 'human_commitment' : 'reassign_agent';
  const affectedPerson = op.type === 'set_availability' ? op.memberId : op.type === 'reassign'
    ? state.members.get(op.assignee)?.kind === 'human' ? op.assignee : state.plan?.tasks.find(t => t.id === op.taskId)?.assignee : undefined;
  const authors = state.messages.filter(m => op.sourceMessageIds.includes(m.messageId)).map(m => m.authorId);
  if (!state.goal) return { kind, allowed: false };
  const approval = whoApproves({ kind, affectedPerson }, state.goal);
  const personId = ['scope_reduce', 'scope_add', 'deadline_change', 'goal_change'].includes(kind)
    ? state.goal.decider : approval.by === 'person' ? approval.personId : undefined;
  return { kind, personId, allowed: personId ? authors.includes(personId) : approval.by === 'pm' };
}
