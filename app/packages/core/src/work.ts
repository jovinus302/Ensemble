import type { Id, LedgerEvent } from "./ledger.ts";
import type { AnyEvent, Priority, TaskBrief, TaskOrigin, TaskRouting } from "./events.ts";
import type { ProjectState, TaskState } from "./projection.ts";

/** Work metadata from `task_meta_set`. Not part of the execution spec. */
export interface TaskMeta { priority: Priority; routing?: TaskRouting; brief?: TaskBrief; origin?: TaskOrigin }
export const DEFAULT_PRIORITY: Priority = "normal";
export function emptyTaskMeta(): TaskMeta { return { priority: DEFAULT_PRIORITY }; }
export const PRIORITIES: readonly Priority[] = ["high", "normal", "low"];
/** Lower runs first. Unknown values sort as normal. */
export function priorityRank(priority: Priority | undefined): number {
  const rank = PRIORITIES.indexOf(priority ?? DEFAULT_PRIORITY);
  return rank < 0 ? PRIORITIES.indexOf(DEFAULT_PRIORITY) : rank;
}

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
 * Metadata never touches the spec, `specVersion`, results or status. Fields merge one by one;
 * the origin is immutable, so only the first origin counts. Meta for an unknown task is ignored.
 */
export function applyWorkEvent(state: ProjectState, event: WorkEvent): void {
  if (event.type !== "task_meta_set") return;
  const { taskId, priority, routing, brief, origin } = event.payload;
  const task = state.tasks.get(taskId);
  if (!task) return;
  const meta = task.meta ??= emptyTaskMeta();
  if (priority !== undefined && PRIORITIES.includes(priority)) meta.priority = priority;
  if (routing !== undefined) meta.routing = routing;
  if (brief !== undefined) meta.brief = brief;
  if (origin !== undefined && meta.origin === undefined) meta.origin = origin;
}

/**
 * Sets each parent's status from its children. `project()` calls it at the end of every event,
 * right before ready computation, so dependents of a parent see the rolled-up status.
 * A parent is `checked` when every live child is checked, otherwise `waiting`; it never holds an
 * execution status. A former parent whose children were all cancelled is ordinary work again:
 * a rolled-up `checked` (no checked result of its own) goes back to `waiting`.
 */
export function rollupParents(state: ProjectState): void {
  const done = new Map<Id, boolean>();
  const visit = (task: TaskState, path: Set<Id>): boolean => {
    const id = task.spec.id;
    const known = done.get(id);
    if (known !== undefined) return known;
    if (!isParentTask(state, task) || path.has(id)) return task.status === "checked";
    path.add(id);
    const children = (task.children ?? []).map((childId) => state.tasks.get(childId)).filter((child): child is TaskState => child !== undefined && child.status !== "cancelled");
    const checked = children.map((child) => visit(child, path)).every(Boolean);
    path.delete(id);
    task.status = checked ? "checked" : "waiting";
    delete task.blocked;
    done.set(id, checked);
    return checked;
  };
  for (const task of state.tasks.values()) {
    if (isParentTask(state, task)) visit(task, new Set());
    else if (task.status === "checked" && task.checkedResultId === undefined && task.results.length === 0) task.status = "waiting";
  }
}

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

/** Same kinds as the web `VmActivityItem`, so the view maps one to one. */
export type TaskActivityKind = "created" | "assigned" | "started" | "submitted" | "reviewed" | "revision" | "blocked" | "resumed" | "changed" | "decision_requested" | "decision_resolved" | "comment";
export interface TaskActivity {
  seq: number; at: string; kind: TaskActivityKind;
  /** The ledger event this entry came from. */
  event: AnyEvent["type"];
  actorId: Id;
  /** Raw text where the ledger has one (comment, reason, missing items); the view writes the rest. */
  text?: string;
  /** A comment's own message. */
  messageId?: Id;
  /** created: the conversation that produced the work (origin first, else the plan commit). */
  source?: { createdBy?: TaskOrigin["createdBy"]; sourceMessageIds: Id[]; decisionRequestId?: Id; splitFrom?: Id };
  planVersion?: number; assignee?: Id; requestId?: Id; resultId?: Id;
  /** changed: the plan dropped the task. */
  cancelled?: true;
  /** decision_resolved: the words a person's answer sent to the agent (a typed answer or the chosen option's answer). */
  answerText?: string;
}

/** A plan change names the conversation that made it, so the work's activity links to it. */
const changeSource = (sourceMessageIds: readonly Id[]): Pick<TaskActivity, "source"> => sourceMessageIds.length ? { source: { sourceMessageIds: [...sourceMessageIds] } } : {};

/** Thread id for work comments: `message_recorded.threadId` / `pm_spoke.threadId`. */
export const taskThreadId = (taskId: Id): Id => `task:${taskId}`;

/**
 * The activity of one work item, derived from the ledger in ledger order (no activity events).
 * Covers creation with its source, assignment, start, submission, handoff review, revision, block,
 * resume, spec changes and updates sent to the agent, cancellation, decision requests that name the
 * task and their answers, and comments (thread messages, PM thread notes, agent replies and reports).
 */
export function taskActivity(events: readonly LedgerEvent[], taskId: Id): TaskActivity[] {
  const items: TaskActivity[] = [];
  const thread = taskThreadId(taskId);
  const requests = new Set<Id>();
  let spec: string | undefined, assignee: Id | undefined, created: TaskActivity | undefined, cancelled = false;
  const sorted = [...events].sort((a, b) => a.seq - b.seq) as AnyEvent[];
  for (const event of sorted) {
    const base = { seq: event.seq, at: event.at, event: event.type, actorId: event.actor.id };
    const push = (kind: TaskActivityKind, extra: Partial<TaskActivity> = {}) => items.push({ ...base, kind, ...extra });
    switch (event.type) {
      case "plan_committed": {
        const p = event.payload;
        const next = p.tasks.find((t) => t.id === taskId);
        if (!next) {
          if (spec !== undefined && !cancelled) { cancelled = true; push("changed", { planVersion: p.version, text: p.reason, cancelled: true, ...changeSource(p.sourceMessageIds) }); }
          break;
        }
        if (spec === undefined) {
          created = { ...base, kind: "created", planVersion: p.version, assignee: next.assignee, source: { sourceMessageIds: [...p.sourceMessageIds] } };
          items.push(created);
        } else if (next.assignee !== assignee) push("assigned", { planVersion: p.version, assignee: next.assignee, ...changeSource(p.sourceMessageIds) });
        else if (JSON.stringify(next) !== spec || cancelled) push("changed", { planVersion: p.version, text: p.reason, ...changeSource(p.sourceMessageIds) });
        spec = JSON.stringify(next); assignee = next.assignee; cancelled = false;
        break;
      }
      case "task_meta_set": {
        const origin = event.payload.origin;
        // The first origin replaces the plan commit's sources: it names the exact conversation.
        if (event.payload.taskId === taskId && origin && created && !created.source?.createdBy) {
          created.source = { createdBy: origin.createdBy, sourceMessageIds: [...origin.sourceMessageIds], ...(origin.decisionRequestId ? { decisionRequestId: origin.decisionRequestId } : {}), ...(origin.splitFrom ? { splitFrom: origin.splitFrom } : {}) };
        }
        break;
      }
      case "task_started": if (event.payload.taskId === taskId) push("started"); break;
      case "result_submitted": if (event.payload.taskId === taskId) push("submitted", { resultId: event.payload.resultId, text: event.payload.summary }); break;
      case "handoff_reviewed": if (event.payload.taskId === taskId) push("reviewed", { resultId: event.payload.resultId, text: event.payload.verdict }); break;
      case "task_checked": if (event.payload.taskId === taskId) push("reviewed", { resultId: event.payload.resultId, text: event.payload.reason }); break;
      case "revision_requested": if (event.payload.taskId === taskId) push("revision", { resultId: event.payload.resultId, text: event.payload.missing.join(", ") }); break;
      case "task_blocked": if (event.payload.taskId === taskId) push("blocked", { text: event.payload.reason }); break;
      case "task_resumed": if (event.payload.taskId === taskId) push("resumed"); break;
      case "update_sent": if (event.payload.taskId === taskId) push("changed", { planVersion: event.payload.toVersion }); break;
      case "decision_requested": {
        const { requestId, impact, question } = event.payload;
        if (!impact.taskIds.includes(taskId) && !impact.blockedTaskIds.includes(taskId)) break;
        requests.add(requestId);
        push("decision_requested", { requestId, text: question });
        break;
      }
      case "decision_resolved": {
        const { requestId, by, outcome, answerText } = event.payload;
        if (requests.has(requestId)) push("decision_resolved", { requestId, actorId: by, text: outcome, ...(outcome === "answered" && answerText?.trim() ? { answerText } : {}) });
        break;
      }
      case "message_recorded":
        if (event.payload.threadId === thread) push("comment", { actorId: event.payload.authorId, messageId: event.payload.messageId, text: event.payload.text });
        break;
      case "pm_spoke":
        if (event.payload.threadId === thread) push("comment", { messageId: event.payload.messageId, text: event.payload.text });
        break;
      case "reply_recorded":
        if (event.payload.taskId === taskId) push("comment", { actorId: event.payload.memberId, text: event.payload.text });
        break;
      case "agent_report_recorded":
        if (event.payload.taskId === taskId) push("comment", { actorId: event.payload.memberId, text: event.payload.text });
        break;
      default: break;
    }
  }
  return items;
}
