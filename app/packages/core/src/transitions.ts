import type { Id, NewLedgerEvent } from "./ledger.ts";
import type { EventContext } from "./events.ts";
import { isStaleResult } from "./projection.ts";
import type { ProjectState, TaskState } from "./projection.ts";
import { automationGate } from "./action-limit.ts";
export function startKey(task: TaskState): string { return `start:${task.spec.id}:v${task.specVersion}`; }
export function planStarts(state: ProjectState, trigger: Id, ctx: EventContext): NewLedgerEvent[] {
  const events: NewLedgerEvent[] = [];
  const occupied = new Set(state.activeTurn.keys());
  const { remaining } = automationGate(state);
  for (const task of state.tasks.values()) {
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
export function checkResult(state: ProjectState, taskId: Id, resultId: Id, reason: string, ctx: EventContext): NewLedgerEvent {
  const task = submittedTask(state, taskId, resultId);
  if (isStaleResult(task, resultId)) throw new Error(`Stale result ${resultId}: task ${taskId} specification changed`);
  return { ...ctx, type: "task_checked", actor: { kind: "pm", id: "pm" }, payload: { taskId, resultId, reason } };
}
export function requestRevision(state: ProjectState, taskId: Id, resultId: Id, missing: string[], ctx: EventContext): NewLedgerEvent {
  submittedTask(state, taskId, resultId);
  return { ...ctx, type: "revision_requested", actor: { kind: "pm", id: "pm" }, payload: { taskId, resultId, missing: [...missing] } };
}
