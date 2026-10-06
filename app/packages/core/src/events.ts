import type { Id, LedgerEvent } from "./ledger.ts";
import type { PlanOp } from "./plan-ops.ts";
import type { WorkContextEventPayloads } from "./work-context.ts";
export type ChangeKind = "reorder" | "split_task" | "reassign_agent" | "scope_reduce" | "scope_add" | "deadline_change" | "goal_change" | "human_commitment";
export interface TaskSpec {
  id: Id; title: string; assignee: Id; dependsOn: Id[]; handoffConditions: string[];
  /** Optional only for pre-M11 ledgers; new plans initialize all three fields. */
  baseTitle?: string; exclusions?: string[]; limits?: string[];
  /** Set on a subtask (depth at most 2). Structure, so it lives in the plan. */
  parentId?: Id;
}
export type Priority = "high" | "normal" | "low";
export type RoutingReason = "agent_capable" | "needs_decision" | "needs_human_access" | "needs_human_judgement" | "no_capable_agent";
export interface TaskRouting { executor: "agent" | "human"; reason: RoutingReason; note: string }
/** Context the PM gathered from the conversation. People never write it. */
export interface TaskBrief {
  /** Why this work exists: goal → parent work → this work, in one or two sentences. */
  why: string;
  sourceMessageIds: Id[];
  /** Confirmed decisions only (`decision_recorded`). */
  decisionIds: Id[];
  attachmentIds: Id[];
  constraints: string[];
}
/** Immutable: only the first `task_meta_set` carrying an origin counts. */
export interface TaskOrigin {
  /** A person's id means that person's own message is the direct basis. */
  createdBy: "pm" | Id;
  planVersion: number;
  sourceMessageIds: Id[];
  decisionRequestId?: Id;
  splitFrom?: Id;
}
export type DecisionRequestKind = "plan_change" | "assignment" | "choice" | "missing_info" | "stuck_work";
export type DecisionOutcome = "approved" | "chose_other" | "edited" | "rejected" | "answered" | "withdrawn" | "expired";
export type DecisionEditableField = "assignee" | "title" | "priority" | "include";
export type DecisionEffect =
  /** Applied through the existing plan-change path. */
  | { type: "plan_ops"; ops: PlanOp[] }
  | { type: "resolve_task"; taskId: Id; action: "accept" | "retry" | "recheck"; note?: string }
  /** missing_info: the answer text goes to the agent through the existing answer path. */
  | { type: "answer"; taskId: Id; questionId?: Id }
  | { type: "none" };
export interface DecisionOption {
  optionId: Id; label: string; effects: DecisionEffect[]; tradeoff: string;
  /**
   * missing_info: the answer this option gives, verbatim (an agent's own choice such as "이메일만").
   * Choosing the option counts as answering with this text; only an option carrying an `answer` effect may hold it.
   */
  answerText?: string;
}
export interface ValidationBinding {
  projectId: Id; taskId: Id; resultId: Id; planVersion: number; specVersion: number;
  contextDigest: string; artifactDigest: string; policyFingerprint: string;
}
export interface ValidationCheck { id: string; status: 'passed' | 'failed' | 'not_run'; detail?: string }
export type ValidationStatus = 'awaiting' | 'not_run' | 'environment_blocked' | 'passed' | 'failed' | 'cancelled' | 'expired';
export interface ValidationEvidence extends ValidationBinding {
  attemptId: Id; status: ValidationStatus; checks: ValidationCheck[]; summary: string;
}
/** Work Context payloads (work-context.ts) are part of the same ledger. */
export interface EventPayloads extends WorkContextEventPayloads {
  judgement_failed: { triggerId: Id; stage: "interpretation" | "judgement"; reason: string };
  /** source "pool": invited from the member pool (work-context.ts), candidateId names the pool entry. */
  member_joined: { memberId: Id; kind: "human" | "agent"; displayName: string; role?: string; source?: "pool"; candidateId?: Id };
  goal_set: { text: string; deadline?: string; decider: Id; delegation: { pmMayApply: ChangeKind[] } };
  /** sourceMessageIds: the conversation the draft came from (the decider's goal message). Optional for older ledgers. */
  plan_proposed: { proposalId: Id; version: number; tasks: TaskSpec[]; estimates: { taskId: Id; hours: { min: number; max: number } }[]; reason: string; forMemberId: Id; sourceMessageIds?: Id[] };
  plan_decided: { proposalId: Id; memberId: Id; approved: boolean };
  plan_committed: { version: number; basedOn: number | null; tasks: TaskSpec[]; reason: string; approvedBy: Id; sourceMessageIds: Id[] };
  availability_updated: { memberId: Id; weeklyHours: number; weekStart?: string };
  estimate_updated: { taskId: Id; hours: { min: number; max: number }; source: "human" | "pm" | "measured" };
  task_start_reserved: { taskId: Id; specVersion: number; trigger: Id };
  task_started: { taskId: Id; turnId?: Id };
  result_submitted: { taskId: Id; resultId: Id; planVersion: number; summary: string; artifactIds: Id[]; artifactPaths?: Record<Id, string>; limitations?: string[] };
  validation_started: ValidationBinding & { attemptId: Id };
  validation_finished: ValidationEvidence;
  validation_cancelled: { taskId: Id; attemptId: Id };
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
  /** threadId: a PM note in a work thread (`task:<taskId>`); taskIds: work the speech mentions; requestId: the decision request it presents. */
  pm_spoke: { considerationId: Id; messageId: Id; text: string; kind: "fact" | "summary" | "ask" | "answer" | "nudge"; threadId?: Id; taskIds?: Id[]; requestId?: Id };
  decision_recorded: { decisionId: Id; summary: string; sourceMessageIds: Id[]; approvedBy: Id; changeKinds: ChangeKind[] };
  authority_requested: { requestId: Id; decisionId?: Id; operationKey?: string; personId: Id; changeKinds: ChangeKind[]; text: string };
  authority_granted: { requestId: Id; personId: Id; granted: boolean };
  /** One change delivered to one recipient. */
  change_notified: { changeId: Id; planVersion: number; recipientId: Id; text: string; via: "channel" | "steer" | "next_turn" };
  /** Work metadata outside the execution spec, so it never bumps `specVersion`. */
  task_meta_set: { taskId: Id; priority?: Priority; routing?: TaskRouting; brief?: TaskBrief; origin?: TaskOrigin };
  /** The single shape for asking a person. Not `decision_recorded` (a decision already made in conversation). */
  decision_requested: {
    requestId: Id;
    kind: DecisionRequestKind;
    /** A human member only. */
    targetMemberId: Id;
    /** Korean, one or two sentences. */
    question: string;
    options: DecisionOption[];
    /** Required. Evidence holds ledger ids only. */
    recommendation: { optionId: Id; rationale: string; evidence: Id[] };
    /** blockedTaskIds: work waiting on this answer; its TaskStatus stays unchanged. */
    impact: { taskIds: Id[]; blockedTaskIds: Id[]; deadlineDeltaDays?: number };
    editable?: DecisionEditableField[];
    sourceMessageIds: Id[];
    remindAt?: string;
  };
  decision_resolved: {
    requestId: Id; by: Id; outcome: DecisionOutcome;
    optionId?: Id; edits?: Record<string, unknown>; answerText?: string; note?: string;
  };
}
export type EventType = keyof EventPayloads;
export type AnyEvent = { [K in EventType]: LedgerEvent<K, EventPayloads[K]> }[EventType];
export interface EventContext { projectId: Id; targetProductId: Id }
