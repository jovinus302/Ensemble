import type { Id, LedgerEvent } from "./ledger.ts";
export type ChangeKind = "reorder" | "split_task" | "reassign_agent" | "scope_reduce" | "scope_add" | "deadline_change" | "goal_change" | "human_commitment";
export interface TaskSpec { id: Id; title: string; assignee: Id; dependsOn: Id[]; handoffConditions: string[] }
export interface EventPayloads {
  member_joined: { memberId: Id; kind: "human" | "agent"; displayName: string; role?: string };
  goal_set: { text: string; deadline?: string; decider: Id; delegation: { pmMayApply: ChangeKind[] } };
  plan_proposed: { proposalId: Id; version: number; tasks: TaskSpec[]; estimates: { taskId: Id; hours: { min: number; max: number } }[]; reason: string; forMemberId: Id };
  plan_decided: { proposalId: Id; memberId: Id; approved: boolean };
  plan_committed: { version: number; basedOn: number | null; tasks: TaskSpec[]; reason: string; approvedBy: Id; sourceMessageIds: Id[] };
  availability_updated: { memberId: Id; weeklyHours: number; weekStart?: string };
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
  session_linked: { agentId: Id; threadId: Id; workspace: string };
  turn_observed: { agentId: Id; taskId: Id; turnId: Id; status: "started" | "completed" | "interrupted" | "failed" };
  update_sent: { updateId: Id; taskId: Id; fromVersion: number; toVersion: number; turnId?: Id };
  update_acknowledged: { updateId: Id; taskId: Id; planVersion: number; applied: string[]; dropped: string[] };
  /** The acknowledgement failed validation; the update stays unconfirmed. */
  update_rejected: { updateId: Id; taskId: Id; reasons: string[] };
  /** An agent reply posted to the channel. */
  reply_recorded: { memberId: Id; taskId?: Id; text: string; turnId?: Id; attachmentIds?: Id[] };
  agent_report_recorded: { memberId: Id; taskId: Id; text: string; turnId: Id };
  message_recorded: { messageId: Id; authorId: Id; text: string; threadId?: Id; attachmentIds: Id[] };
  attachment_recorded: { attachmentId: Id; name: string; mimeType: string; uri: string; taskId?: Id };
  /** The PM's handoff judgement and the evidence behind it. */
  handoff_reviewed: { taskId: Id; resultId: Id; verdict: "sufficient" | "insufficient"; met: string[]; missing: string[]; evidence: string[]; citationFailures?: { condition: string; file: string; quote: string; reason: string }[] };
  /** The PM's answers to the three principle questions (docs/pm-principles.md) before speaking or staying silent. */
  pm_considered: { considerationId: Id; triggerId: Id; whoseAction: string | null; alreadyKnows: "yes" | "no" | "unknown"; evidence: string[]; decision: "speak" | "silent"; reason: string; openTopics: string[] };
  pm_spoke: { considerationId: Id; messageId: Id; text: string; kind: "fact" | "summary" | "ask" | "answer" | "nudge" };
  decision_recorded: { decisionId: Id; summary: string; sourceMessageIds: Id[]; approvedBy: Id; changeKinds: ChangeKind[] };
  authority_requested: { requestId: Id; decisionId?: Id; operationKey?: string; personId: Id; changeKinds: ChangeKind[]; text: string };
  authority_granted: { requestId: Id; personId: Id; granted: boolean };
  /** One change delivered to one recipient. */
  change_notified: { changeId: Id; planVersion: number; recipientId: Id; text: string; via: "channel" | "steer" | "next_turn" };
}
export type EventType = keyof EventPayloads;
export type AnyEvent = { [K in EventType]: LedgerEvent<K, EventPayloads[K]> }[EventType];
export interface EventContext { projectId: Id; targetProductId: Id }
