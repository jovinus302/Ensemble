// Plan-op validation shared by the coordinator, the decision flow and the sweep: the shape and authority
// checks an op must pass before it is applied or offered. Kept apart so those modules import it without
// importing each other.
import { availabilityWeek, opAuthority, planOpsProblems, PRIORITIES, type Id, type PlanOp, type ProjectState } from '@ensemble/core';

export type TaskRecoveryOp = (
  | { type: 'resolve_task'; taskId: string; action: 'accept' | 'retry' | 'recheck'; note?: string }
  | { type: 'reopen_task'; taskId: string; reason: string }
) & { sourceMessageIds: string[] };
export type CoordinationOp = PlanOp | TaskRecoveryOp;
export const isRecoveryOp = (op: CoordinationOp): op is TaskRecoveryOp => op.type === 'resolve_task' || op.type === 'reopen_task';
export const DRAFT_FIELDS = ['tempId', 'title', 'assignee', 'handoffConditions', 'dependsOn', 'priority', 'routing', 'brief'];
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string' && x.length > 0);

export function validCoordinationOp(value: unknown, state: ProjectState): value is CoordinationOp {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!strings(v.sourceMessageIds) || !v.sourceMessageIds.length || !v.sourceMessageIds.every(id => state.messages.some(m => m.messageId === id && state.members.get(m.authorId)?.kind === 'human'))) return false;
  const fields: Record<string, string[]> = { set_availability: ['memberId', 'weeklyHours', 'weekStart', 'period'], exclude_scope: ['taskId', 'item'], limit_scope: ['taskId', 'items'], handoff_early: ['taskId'], reassign: ['taskId', 'assignee'], set_deadline: ['date'], change_goal: ['text'], resolve_task: ['taskId', 'action', 'note'], reopen_task: ['taskId', 'reason'], create_task: [...DRAFT_FIELDS, 'parentId'], split_task: ['taskId', 'children'], cancel_task: ['taskId', 'reason'], set_priority: ['taskId', 'priority'] };
  const allowed = fields[String(v.type)];
  if (!allowed || Object.keys(v).some(k => !['type', 'sourceMessageIds', ...allowed].includes(k))) return false;
  if (allowed.includes('taskId') && !state.plan?.tasks.some(t => t.id === v.taskId)) return false;
  switch (v.type) {
    case 'resolve_task': return ['accept', 'retry', 'recheck'].includes(String(v.action)) && (v.note === undefined || typeof v.note === 'string');
    case 'reopen_task': return typeof v.reason === 'string' && !!v.reason.trim();
    case 'set_availability': return state.members.get(String(v.memberId))?.kind === 'human' && typeof v.weeklyHours === 'number' && Number.isFinite(v.weeklyHours) && v.weeklyHours >= 0 && (v.period === undefined || ['this_week', 'ongoing', 'unclear'].includes(String(v.period))) && (v.weekStart === undefined || (typeof v.weekStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.weekStart) && availabilityWeek(new Date(`${v.weekStart}T00:00:00+09:00`)) === v.weekStart));
    case 'limit_scope': return strings(v.items) && v.items.length > 0;
    case 'exclude_scope': return typeof v.item === 'string' && !!v.item.trim();
    case 'handoff_early': return true;
    case 'reassign': return state.members.has(String(v.assignee));
    case 'set_deadline': return typeof v.date === 'string' && Number.isFinite(Date.parse(v.date));
    case 'change_goal': return typeof v.text === 'string' && !!v.text.trim();
    // Work ops: shape only here. Drafts are finished and the batch is checked by `prepareOps`/`planOpsProblems`.
    case 'create_task': return typeof v.tempId === 'string' && typeof v.title === 'string' && (v.parentId === undefined || typeof v.parentId === 'string');
    case 'split_task': return Array.isArray(v.children) && v.children.length > 0;
    case 'cancel_task': return typeof v.reason === 'string' && !!v.reason.trim();
    case 'set_priority': return PRIORITIES.includes(v.priority as never);
    default: return false;
  }
}
/** Authority cards keep their original plan-only contract. */
export function validOp(value: unknown, state: ProjectState): value is PlanOp {
  return validCoordinationOp(value, state) && !isRecoveryOp(value);
}

/**
 * Whether these plan ops would pass the decision flow if `by` approved them: the same validation and
 * authority checks the coordinator applies. Options the current code cannot apply are never offered.
 */
export function opsApplicable(state: ProjectState, ops: readonly PlanOp[], by: Id): boolean {
  if (!state.plan || !state.goal) return false;
  const probe = structuredClone(state);
  const messageId = `probe:${by}`;
  probe.messages.push({ messageId, authorId: by, text: '', seq: state.lastSeq + 1 });
  const sourced = ops.map(op => ({ ...op, sourceMessageIds: [messageId] }) as PlanOp);
  return !planOpsProblems(probe, sourced).length && sourced.every(op => validOp(op, probe) && opAuthority(probe, op).allowed);
}
