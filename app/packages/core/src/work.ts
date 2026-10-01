import type { Id } from "./ledger.ts";
import type { AnyEvent, Priority, TaskBrief, TaskOrigin, TaskRouting } from "./events.ts";
import type { ProjectState, TaskState } from "./projection.ts";

/** Work metadata from `task_meta_set`. Not part of the execution spec. */
export interface TaskMeta { priority: Priority; routing?: TaskRouting; brief?: TaskBrief; origin?: TaskOrigin }
export const DEFAULT_PRIORITY: Priority = "normal";
export function emptyTaskMeta(): TaskMeta { return { priority: DEFAULT_PRIORITY }; }

/** What people see. Derived from TaskStatus and open decision requests; not a second state machine. */
export type WorkStatus = "todo" | "in_progress" | "in_review" | "waiting_human" | "blocked" | "done" | "cancelled";
export type WorkEvent = Extract<AnyEvent, { type: "task_meta_set" | "plan_committed" }>;

/** A task with at least one child that is not cancelled. Parents never run; their status is rolled up. */
export function isParentTask(state: ProjectState, task: TaskState): boolean {
  return (task.children ?? []).some((id) => { const child = state.tasks.get(id); return child !== undefined && child.status !== "cancelled"; });
}

/**
 * Work-item reducer. `project()` calls it for `task_meta_set`, and for `plan_committed` after
 * the task specs, `ordinal`, `children` and `reassignCount` are already updated.
 * M0 stub: no-op (milestone MA implements).
 */
export function applyWorkEvent(_state: ProjectState, _event: WorkEvent): void {}

/**
 * Sets each parent's status from its children. `project()` calls it at the end of every event,
 * right before ready computation, so dependents of a parent see the rolled-up status.
 * M0 stub: no-op (milestone MA implements).
 */
export function rollupParents(_state: ProjectState): void {}

/** Pure mapping from §2.1. Open requests are those with `status: "open"`. */
export function workStatus(task: TaskState, state: ProjectState): WorkStatus {
  if (task.status === "checked") return "done";
  if (task.status === "cancelled") return "cancelled";
  if (waitingOn(state, task.spec.id)) return "waiting_human";
  switch (task.status) {
    case "waiting": case "ready": return "todo";
    case "reserved": case "running": case "revising": return "in_progress";
    case "submitted": return "in_review";
    case "blocked": return "blocked";
  }
}

/** The open decision request this task waits on, if any. */
export function waitingOn(state: ProjectState, taskId: Id): { requestId: Id; memberId: Id } | undefined {
  for (const request of state.decisionRequests.values()) {
    if (request.status === "open" && request.request.impact.blockedTaskIds.includes(taskId)) return { requestId: request.request.requestId, memberId: request.request.targetMemberId };
  }
  return undefined;
}
