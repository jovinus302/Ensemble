import type { Id, NewLedgerEvent } from "./ledger.ts";
import type { EventContext } from "./events.ts";
import { isStaleResult, pendingUpdates } from "./projection.ts";
import type { ProjectState, TaskState } from "./projection.ts";
import { automationGate } from "./action-limit.ts";
import { isParentTask, priorityRank } from "./work.ts";
export function startKey(task: TaskState): string { return `start:${task.spec.id}:v${task.specVersion}`; }
/** Ready work in start order: higher priority first, then creation order. Parents never run. */
export function startOrder(state: ProjectState): TaskState[] {
  const order = [...state.tasks.values()].map((task, index) => ({ task, index }));
  order.sort((a, b) => priorityRank(a.task.meta?.priority) - priorityRank(b.task.meta?.priority) || (a.task.ordinal ?? a.index) - (b.task.ordinal ?? b.index));
  return order.map(({ task }) => task).filter((task) => !isParentTask(state, task));
}
export function planStarts(state: ProjectState, trigger: Id, ctx: EventContext): NewLedgerEvent[] {
  const events: NewLedgerEvent[] = [];
  const occupied = new Set(state.activeTurn.keys());
  const { remaining } = automationGate(state);
  for (const task of startOrder(state)) {
    if (events.length >= remaining) break;
    const agent = state.members.get(task.spec.assignee)?.kind === "agent";
    if (task.status !== "ready" || state.reservedStartKeys.has(startKey(task)) || (agent && occupied.has(task.spec.assignee))) continue;
    events.push({ ...ctx, type: "task_start_reserved", actor: { kind: "pm", id: "pm" }, idempotencyKey: startKey(task), payload: { taskId: task.spec.id, specVersion: task.specVersion, trigger } });
    if (agent) occupied.add(task.spec.assignee);
  }
  return events;
}
function submittedTask(state: ProjectState, taskId: Id, resultId: Id): TaskState {
  const task = state.tasks.get(taskId);
  if (!task) throw new Error(`Unknown task ${taskId}`);
  if (task.status !== "submitted") throw new Error(`Task ${taskId} must be submitted, was ${task.status}`);
  if (!task.results.some((result) => result.resultId === resultId)) throw new Error(`Unknown result ${resultId} for task ${taskId}`);
  return task;
}
/** A result cannot hand off while a plan update is unconfirmed or the result predates the confirmed version. */
function updateBlockers(task: TaskState, resultId: Id): string[] {
  const blockers = pendingUpdates(task).map((u) => `Update ${u.updateId} ${u.status === "sent" ? "not yet acknowledged" : "acknowledgement rejected"}: result ${resultId} precedes confirmation`);
  const acknowledged = task.updates.filter((u) => u.status === "acknowledged");
  const result = task.results.find((r) => r.resultId === resultId);
  if (result && acknowledged.length) {
    const confirmed = Math.max(...acknowledged.map((u) => u.toVersion));
    if (result.planVersion < confirmed) blockers.push(`Result ${resultId} is based on v${result.planVersion}, before acknowledged v${confirmed}`);
  }
  return blockers;
}
/** Every reason a result cannot be checked yet; empty means handoff is allowed. */
export function handoffBlockers(state: ProjectState, taskId: Id, resultId: Id): string[] {
  let task: TaskState;
  try { task = submittedTask(state, taskId, resultId); } catch (error) { return [(error as Error).message]; }
  const blockers = isStaleResult(task, resultId) ? [`Stale result ${resultId}: task ${taskId} specification changed`] : [];
  return [...blockers, ...updateBlockers(task, resultId)];
}
export function checkResult(state: ProjectState, taskId: Id, resultId: Id, reason: string, ctx: EventContext): NewLedgerEvent {
  const task = submittedTask(state, taskId, resultId);
  if (isStaleResult(task, resultId)) throw new Error(`Stale result ${resultId}: task ${taskId} specification changed`);
  const blockers = updateBlockers(task, resultId);
  if (blockers.length) throw new Error(blockers.join("; "));
  return { ...ctx, type: "task_checked", actor: { kind: "pm", id: "pm" }, payload: { taskId, resultId, reason } };
}
export function requestRevision(state: ProjectState, taskId: Id, resultId: Id, missing: string[], ctx: EventContext): NewLedgerEvent {
  submittedTask(state, taskId, resultId);
  return { ...ctx, type: "revision_requested", actor: { kind: "pm", id: "pm" }, payload: { taskId, resultId, missing: [...missing] } };
}
