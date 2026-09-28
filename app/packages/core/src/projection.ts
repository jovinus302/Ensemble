import type { Id, LedgerEvent } from "./ledger.ts";
import type { AnyEvent, EventPayloads, TaskSpec } from "./events.ts";

export type TaskStatus = "waiting" | "ready" | "reserved" | "running" | "submitted" | "revising" | "checked" | "blocked" | "cancelled";
export interface TaskState {
  spec: TaskSpec;
  specVersion: number;
  status: TaskStatus;
  results: { resultId: Id; planVersion: number }[];
  checkedResultId?: Id;
  blocked?: { reason: string; unblockBy?: Id; prevStatus: TaskStatus };
}
export interface ProjectState {
  lastSeq: number;
  members: Map<Id, EventPayloads["member_joined"]>;
  goal?: EventPayloads["goal_set"];
  plan?: Pick<EventPayloads["plan_committed"], "version" | "tasks" | "reason" | "approvedBy">;
  tasks: Map<Id, TaskState>;
  availability: Map<Id, number>;
  estimates: Map<Id, { min: number; max: number; source: EventPayloads["estimate_updated"]["source"] }>;
  activeTurn: Map<Id, Id>;
  reservedStartKeys: Set<string>;
  automation: { actionsSinceResume: number; limitReached: boolean };
}
export function isStaleResult(task: TaskState, resultId: Id): boolean {
  const result = task.results.find((item) => item.resultId === resultId);
  if (!result) throw new Error(`Unknown result ${resultId} for task ${task.spec.id}`);
  return result.planVersion < task.specVersion;
}
/** Replay ledger order without retaining mutable references to input payloads. */
export function project(events: readonly LedgerEvent[]): ProjectState {
  const state: ProjectState = {
    lastSeq: 0, members: new Map(), tasks: new Map(), availability: new Map(),
    estimates: new Map(), activeTurn: new Map(), reservedStartKeys: new Set(),
    automation: { actionsSinceResume: 0, limitReached: false },
  };
  for (const original of events) {
    const event = structuredClone(original) as AnyEvent;
    state.lastSeq = event.seq;
    if (event.actor.kind === "pm" && event.type !== "action_limit_reached") state.automation.actionsSinceResume++;
    switch (event.type) {
      case "member_joined": state.members.set(event.payload.memberId, event.payload); break;
      case "goal_set": state.goal = event.payload; break;
      case "plan_committed": {
        const p = event.payload;
        state.plan = { version: p.version, tasks: p.tasks, reason: p.reason, approvedBy: p.approvedBy };
        const ids = new Set(p.tasks.map((spec) => spec.id));
        for (const [id, task] of state.tasks) if (!ids.has(id)) task.status = "cancelled";
        for (const spec of p.tasks) {
          const task = state.tasks.get(spec.id);
          if (!task) state.tasks.set(spec.id, { spec, specVersion: p.version, status: "waiting", results: [] });
          else if (JSON.stringify(task.spec) !== JSON.stringify(spec)) {
            task.spec = spec;
            task.specVersion = p.version;
            delete task.checkedResultId;
            if (task.status === "checked") task.status = "waiting";
            if (task.blocked?.prevStatus === "checked") task.blocked.prevStatus = "waiting";
          }
        }
        break;
      }
      case "availability_updated": state.availability.set(event.payload.memberId, event.payload.weeklyHours); break;
      case "estimate_updated": state.estimates.set(event.payload.taskId, { ...event.payload.hours, source: event.payload.source }); break;
      case "turn_finished":
        if (state.activeTurn.get(event.payload.agentId) === event.payload.taskId) state.activeTurn.delete(event.payload.agentId);
        break;
      case "action_limit_reached": state.automation.limitReached = true; break;
      case "automation_resumed": state.automation = { actionsSinceResume: 0, limitReached: false }; break;
      case "task_start_reserved": case "task_started": case "result_submitted": case "task_checked":
      case "revision_requested": case "task_blocked": case "task_resumed": {
        const task = state.tasks.get(event.payload.taskId);
        if (!task || task.status === "cancelled") break;
        switch (event.type) {
          case "task_start_reserved": {
            const key = `start:${task.spec.id}:v${event.payload.specVersion}`;
            const agent = state.members.get(task.spec.assignee)?.kind === "agent";
            if (task.status !== "ready" || event.payload.specVersion !== task.specVersion || state.reservedStartKeys.has(key) || (agent && state.activeTurn.has(task.spec.assignee))) break;
            task.status = "reserved";
            state.reservedStartKeys.add(key);
            if (agent) state.activeTurn.set(task.spec.assignee, task.spec.id);
            break;
          }
          case "task_started": task.status = "running"; break;
          case "result_submitted":
            task.results.push({ resultId: event.payload.resultId, planVersion: event.payload.planVersion });
            task.status = "submitted"; break;
          case "task_checked":
            if (task.status === "submitted" && task.results.some((r) => r.resultId === event.payload.resultId) && !isStaleResult(task, event.payload.resultId)) {
              task.status = "checked"; task.checkedResultId = event.payload.resultId;
            }
            break;
          case "revision_requested": task.status = "revising"; break;
          case "task_blocked":
            task.blocked = { reason: event.payload.reason, unblockBy: event.payload.unblockBy, prevStatus: task.blocked?.prevStatus ?? task.status };
            task.status = "blocked"; break;
          case "task_resumed":
            if (task.status === "blocked" && task.blocked) { task.status = task.blocked.prevStatus; delete task.blocked; }
            break;
        }
        break;
      }
    }
    for (const task of state.tasks.values()) {
      if (task.status === "waiting" || task.status === "ready") task.status = task.spec.dependsOn.every((id) => state.tasks.get(id)?.status === "checked") ? "ready" : "waiting";
    }
  }
  return state;
}
