import type { Id, LedgerEvent } from "./ledger.ts";
import type { AnyEvent, EventPayloads, TaskSpec } from "./events.ts";
import { isAutomationAction } from './action-limit.ts';
import { applyWorkEvent, emptyTaskMeta, isParentTask, rollupParents, type TaskMeta } from './work.ts';
import { applyDecisionEvent, decisionApproved, type DecisionRequestState } from './decision-requests.ts';

export type UpdateStatus = "sent" | "acknowledged" | "rejected";
export interface TaskUpdate { updateId: Id; toVersion: number; status: UpdateStatus; droppedItems: string[] }
export type TaskStatus = "waiting" | "ready" | "reserved" | "running" | "submitted" | "revising" | "checked" | "blocked" | "cancelled";
export interface TaskState {
  spec: TaskSpec;
  specVersion: number;
  status: TaskStatus;
  results: { resultId: Id; planVersion: number }[];
  checkedResultId?: Id;
  reviewFailedResultId?: Id;
  blocked?: { reason: string; unblockBy?: Id; prevStatus: TaskStatus };
  updates: TaskUpdate[];
  // Work-item fields. `project()` always sets them; they are optional only so hand-built states stay valid.
  /** Creation order, 1-based. Internal sort/log value, never shown as a key. */
  ordinal?: number;
  meta?: TaskMeta;
  /** Tasks whose spec.parentId is this task, in plan order. */
  children?: Id[];
  /** Times plan_committed changed the assignee. */
  reassignCount?: number;
}
export interface ProjectMessage { messageId: Id; authorId: Id; text: string; threadId?: Id; seq: number }
export interface ProjectState {
  lastSeq: number;
  members: Map<Id, EventPayloads["member_joined"]>;
  goal?: EventPayloads["goal_set"];
  plan?: Pick<EventPayloads["plan_committed"], "version" | "tasks" | "reason" | "approvedBy">;
  tasks: Map<Id, TaskState>;
  availability: Map<Id, number>;
  availabilityOverrides: Map<Id, Map<string, number>>;
  estimates: Map<Id, { min: number; max: number; source: EventPayloads["estimate_updated"]["source"] }>;
  activeTurn: Map<Id, Id>;
  sessions: Map<Id, { threadId: Id; workspace: string }>;
  reservedStartKeys: Set<string>;
  automation: { actionsSinceResume: number; limitReached: boolean };
  /** Channel messages in ledger order, including PM speech. */
  messages: ProjectMessage[];
  /** Topics the PM left open at its most recent consideration. */
  openTopics: string[];
  decisions: Map<Id, EventPayloads["decision_recorded"]>;
  /** Authority requests still waiting for the person's answer. */
  pendingAuthority: Map<Id, EventPayloads["authority_requested"]>;
  pendingPlans: Map<Id, EventPayloads["plan_proposed"]>;
  /** `${changeId}:${recipientId}` pairs already notified. */
  notified: Set<string>;
  decisionRequests: Map<Id, DecisionRequestState>;
}
export function isStaleResult(task: TaskState, resultId: Id): boolean {
  const result = task.results.find((item) => item.resultId === resultId);
  if (!result) throw new Error(`Unknown result ${resultId} for task ${task.spec.id}`);
  return result.planVersion < task.specVersion;
}
/** Updates the agent has not confirmed: still sent, or acknowledged with an invalid reply. */
export function pendingUpdates(task: TaskState): TaskUpdate[] {
  return task.updates.filter((update) => update.status !== "acknowledged");
}
export function notifiedKey(changeId: Id, recipientId: Id): string {
  return `${changeId}:${recipientId}`;
}
export function wasNotified(state: ProjectState, changeId: Id, recipientId: Id): boolean {
  return state.notified.has(notifiedKey(changeId, recipientId));
}
/** Replay ledger order without retaining mutable references to input payloads. */
export function project(events: readonly LedgerEvent[]): ProjectState {
  const state: ProjectState = {
    lastSeq: 0, members: new Map(), tasks: new Map(), availability: new Map(), availabilityOverrides: new Map(),
    estimates: new Map(), activeTurn: new Map(), sessions: new Map(), reservedStartKeys: new Set(),
    automation: { actionsSinceResume: 0, limitReached: false },
    messages: [], openTopics: [], decisions: new Map(), pendingAuthority: new Map(), pendingPlans: new Map(), notified: new Set(),
    decisionRequests: new Map(),
  };
  const concludedMessages = new Set<string>();
  for (const original of events) {
    const event = structuredClone(original) as AnyEvent;
    state.lastSeq = event.seq;
    const conclusion = event.type === 'decision_recorded' && event.payload.sourceMessageIds.filter(id =>
      !concludedMessages.has(id) && state.messages.some(m => m.messageId === id && m.authorId === state.goal?.decider && state.members.get(m.authorId)?.kind === 'human'));
    const cardApproved = event.type === 'plan_decided' && event.payload.approved
      && state.pendingPlans.get(event.payload.proposalId)?.forMemberId === event.payload.memberId
      && state.members.get(event.payload.memberId)?.kind === 'human';
    const authorityApproved = event.type === 'authority_granted' && event.payload.granted
      && state.pendingAuthority.get(event.payload.requestId)?.personId === event.payload.personId
      && state.members.get(event.payload.personId)?.kind === 'human';
    const requestAnswered = decisionApproved(state, event);
    if ((conclusion && conclusion.length > 0) || cardApproved || authorityApproved || requestAnswered) {
      state.automation = { actionsSinceResume: 0, limitReached: false };
      if (conclusion) conclusion.forEach(id => concludedMessages.add(id));
    }
    if (isAutomationAction(event)) state.automation.actionsSinceResume++;
    switch (event.type) {
      case "member_joined": state.members.set(event.payload.memberId, event.payload); break;
      case "goal_set": state.goal = event.payload; break;
      case "plan_proposed": state.pendingPlans.set(event.payload.proposalId, event.payload); break;
      case "plan_decided": state.pendingPlans.delete(event.payload.proposalId); break;
      case "plan_committed": {
        const p = event.payload;
        state.plan = { version: p.version, tasks: p.tasks, reason: p.reason, approvedBy: p.approvedBy };
        const ids = new Set(p.tasks.map((spec) => spec.id));
        for (const [id, task] of state.tasks) if (!ids.has(id)) task.status = "cancelled";
        for (const spec of p.tasks) {
          const task = state.tasks.get(spec.id);
          if (!task) state.tasks.set(spec.id, { spec, specVersion: p.version, status: "waiting", results: [], updates: [], ordinal: state.tasks.size + 1, meta: emptyTaskMeta(), children: [], reassignCount: 0 });
          else if (JSON.stringify(task.spec) !== JSON.stringify(spec)) {
            const substantive = (s: TaskSpec) => { const { title, baseTitle, exclusions, limits, ...rest } = s; return rest; };
            const scopeOnly = (spec.baseTitle ?? spec.title) === (task.spec.baseTitle ?? task.spec.title) && JSON.stringify(substantive(task.spec)) === JSON.stringify(substantive(spec));
            if (spec.assignee !== task.spec.assignee) task.reassignCount = (task.reassignCount ?? 0) + 1;
            task.spec = spec;
            task.specVersion = p.version;
            if (!scopeOnly) {
              delete task.checkedResultId;
              if (task.status === "checked") task.status = "waiting";
              if (task.blocked?.prevStatus === "checked") task.blocked.prevStatus = "waiting";
            }
          }
        }
        for (const task of state.tasks.values()) task.children = [];
        for (const spec of p.tasks) if (spec.parentId !== undefined) state.tasks.get(spec.parentId)?.children?.push(spec.id);
        applyWorkEvent(state, event);
        break;
      }
      case "task_meta_set": applyWorkEvent(state, event); break;
      case "decision_requested": case "decision_resolved": applyDecisionEvent(state, event); break;
      case "availability_updated": {
        const { memberId, weeklyHours, weekStart } = event.payload;
        if (weekStart) {
          const weeks = state.availabilityOverrides.get(memberId) ?? new Map<string, number>();
          weeks.set(weekStart, weeklyHours); state.availabilityOverrides.set(memberId, weeks);
        } else state.availability.set(memberId, weeklyHours);
        break;
      }
      case "estimate_updated": state.estimates.set(event.payload.taskId, { ...event.payload.hours, source: event.payload.source }); break;
      case "session_linked": state.sessions.set(event.payload.agentId, { threadId: event.payload.threadId, workspace: event.payload.workspace }); break;
      case "turn_observed":
        if (event.payload.status === "started") {
          const { agentId, taskId } = event.payload;
          const task = state.tasks.get(taskId);
          if (task?.status === "running" && task.spec.assignee === agentId && state.members.get(agentId)?.kind === "agent" && !state.activeTurn.has(agentId)) state.activeTurn.set(agentId, taskId);
          break;
        }
        if (state.activeTurn.get(event.payload.agentId) === event.payload.taskId) state.activeTurn.delete(event.payload.agentId);
        break;
      case "turn_finished":
        if (state.activeTurn.get(event.payload.agentId) === event.payload.taskId) state.activeTurn.delete(event.payload.agentId);
        break;
      case "action_limit_reached": state.automation.limitReached = true; break;
      case "automation_resumed": state.automation = { actionsSinceResume: 0, limitReached: false }; break;
      case "message_recorded": case "pm_spoke": {
        const p = event.payload;
        // Malformed payloads (no id or text) are ignored rather than projected.
        if (typeof p.messageId !== "string" || typeof p.text !== "string" || state.messages.some((m) => m.messageId === p.messageId)) break;
        const authorId = event.type === "message_recorded" ? event.payload.authorId : event.actor.id;
        if (typeof authorId !== "string") break;
        const threadId = event.payload.threadId;
        state.messages.push({ messageId: p.messageId, authorId, text: p.text, ...(threadId !== undefined ? { threadId } : {}), seq: event.seq });
        break;
      }
      case "pm_considered":
        state.openTopics = event.payload.openTopics;
        if (event.payload.reason === '결과 내용이 아니라 판단 과정의 문제라 사람이 결과를 확인해야 한다') {
          for (const task of state.tasks.values()) if (task.status === 'submitted' && task.results.at(-1)?.resultId === event.payload.triggerId) task.reviewFailedResultId = event.payload.triggerId;
        }
        break;
      case "decision_recorded": state.decisions.set(event.payload.decisionId, event.payload); break;
      case "authority_requested": state.pendingAuthority.set(event.payload.requestId, event.payload); break;
      case "authority_granted": state.pendingAuthority.delete(event.payload.requestId); break;
      case "change_notified": state.notified.add(notifiedKey(event.payload.changeId, event.payload.recipientId)); break;
      case "task_start_reserved": case "task_started": case "result_submitted": case "task_checked":
      case "revision_requested": case "task_blocked": case "task_resumed":
      case "update_sent": case "update_acknowledged": case "update_rejected": {
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
            delete task.reviewFailedResultId;
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
          case "update_sent":
            if (!task.updates.some((u) => u.updateId === event.payload.updateId)) task.updates.push({ updateId: event.payload.updateId, toVersion: event.payload.toVersion, status: "sent", droppedItems: [] });
            break;
          case "update_acknowledged": {
            const update = task.updates.find((u) => u.updateId === event.payload.updateId);
            if (update) { update.status = "acknowledged"; update.droppedItems = event.payload.dropped; }
            break;
          }
          case "update_rejected": {
            const update = task.updates.find((u) => u.updateId === event.payload.updateId);
            if (update) update.status = "rejected";
            break;
          }
        }
        break;
      }
    }
    rollupParents(state);
    for (const task of state.tasks.values()) {
      if ((task.status === "waiting" || task.status === "ready") && !isParentTask(state, task)) task.status = task.spec.dependsOn.every((id) => state.tasks.get(id)?.status === "checked") ? "ready" : "waiting";
    }
  }
  return state;
}
