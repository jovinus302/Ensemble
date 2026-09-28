import type { Id, LedgerEvent } from "./ledger.ts";
export type ChangeKind = "reorder" | "split_task" | "reassign_agent" | "scope_reduce" | "scope_add" | "deadline_change" | "goal_change" | "human_commitment";
export interface TaskSpec { id: Id; title: string; assignee: Id; dependsOn: Id[]; handoffConditions: string[] }
export interface EventPayloads {
  member_joined: { memberId: Id; kind: "human" | "agent"; displayName: string; role?: string };
  goal_set: { text: string; deadline?: string; decider: Id; delegation: { pmMayApply: ChangeKind[] } };
  plan_committed: { version: number; basedOn: number | null; tasks: TaskSpec[]; reason: string; approvedBy: Id; sourceMessageIds: Id[] };
  availability_updated: { memberId: Id; weeklyHours: number };
  estimate_updated: { taskId: Id; hours: { min: number; max: number }; source: "human" | "pm" | "measured" };
  task_start_reserved: { taskId: Id; specVersion: number; trigger: Id };
  task_started: { taskId: Id; turnId?: Id };
  result_submitted: { taskId: Id; resultId: Id; planVersion: number; summary: string; artifactIds: Id[] };
  task_checked: { taskId: Id; resultId: Id; reason: string };
  revision_requested: { taskId: Id; resultId: Id; missing: string[] };
  task_blocked: { taskId: Id; reason: string; unblockBy?: Id };
  task_resumed: { taskId: Id };
  turn_finished: { agentId: Id; taskId: Id };
  action_limit_reached: { count: number; limit: number };
  automation_resumed: { by: Id };
}
export type EventType = keyof EventPayloads;
export type AnyEvent = { [K in EventType]: LedgerEvent<K, EventPayloads[K]> }[EventType];
export interface EventContext { projectId: Id; targetProductId: Id }
