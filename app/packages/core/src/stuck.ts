import type { Id, LedgerEvent } from "./ledger.ts";
import type { AnyEvent } from "./events.ts";
import { project, type ProjectState } from "./projection.ts";
import { forecastFromState } from "./forecast-state.ts";
import { isParentTask } from "./work.ts";
import { decisionReminderKey, decisionsDue, openDecisions, openRequestForTask } from "./decision-requests.ts";

/** A blocked task without a decision request is reported after this long. */
export const STUCK_BLOCKED_HOURS = 4;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KST_OFFSET = 9 * HOUR;

/** Asia/Seoul calendar day (no DST), `YYYY-MM-DD`. Day boundary for sweep and digest keys. */
export function kstDay(value: Date | string): string {
  return new Date(new Date(value).getTime() + KST_OFFSET).toISOString().slice(0, 10);
}

export type StuckRule = "blocked" | "human_overdue" | "decision_remind" | "decision_expire" | "unassigned";
/**
 * One sweep finding. The sweep reports; it never restarts or reassigns anything itself.
 * `idempotencyKey` is the key the event acting on it must carry, so a finding never repeats on the same day.
 */
export interface StuckFinding {
  rule: StuckRule;
  idempotencyKey: string;
  taskId?: Id;
  requestId?: Id;
  /** Who to tell: the decider, the assignee, or the request target. */
  memberId?: Id;
  /** Blocked reason, or why the finding fired. */
  reason?: string;
  /** When the condition started (blocked at, forecast finish). */
  since?: string;
}

const sweepKey = (rule: StuckRule, id: Id, now: Date) => `sweep:${rule}:${id}:${kstDay(now)}`;
const typed = (events: readonly LedgerEvent[]) => events as readonly AnyEvent[];

/** When the task's current block started: the first `task_blocked` after its last resume. */
function blockedSince(events: readonly AnyEvent[], taskId: Id): string | undefined {
  let since: string | undefined;
  for (const event of events) {
    if (event.type === "task_blocked" && event.payload.taskId === taskId) since ??= event.at;
    if (event.type === "task_resumed" && event.payload.taskId === taskId) since = undefined;
  }
  return since;
}

/** The forecast max finish for a human task, as forecast when the task started. */
function plannedFinish(events: readonly AnyEvent[], taskId: Id): Date | undefined {
  const index = events.findLastIndex((event) => event.type === "task_started" && event.payload.taskId === taskId);
  if (index < 0) return undefined;
  const startedAt = new Date(events[index]!.at);
  try {
    const result = forecastFromState(project(events.slice(0, index + 1)), startedAt);
    const span = result.ok ? result.tasks.find((task) => task.taskId === taskId)?.max : undefined;
    return span === undefined ? undefined : new Date(startedAt.getTime() + span.endDay * DAY);
  } catch { return undefined; }
}

function lateNow(state: ProjectState, now: Date): boolean {
  try { const result = forecastFromState(state, now); return result.ok && (result.lateness?.maxDays ?? 0) > 0; } catch { return false; }
}

/**
 * §3 B8 rules as a pure function. Execution (decision requests, reminders, expiry) is the orchestrator's sweep.
 * - blocked ≥ 4h with no open decision request → `stuck_work` request to the decider.
 * - a human's task past its forecast finish, only when the goal deadline is affected → ask that person.
 * - an open request past `remindAt` → one reminder; past the expiry after that reminder → expire (Q3 setting).
 * - todo work whose assignee is no longer a member → `assignment` request.
 * Findings whose key is already in the ledger are dropped, so the same finding fires at most once a day.
 */
export function stuckFindings(state: ProjectState, events: readonly LedgerEvent[], now: Date): StuckFinding[] {
  const ledger = typed(events);
  const recorded = new Set(events.flatMap((event) => event.idempotencyKey === undefined ? [] : [event.idempotencyKey]));
  const decider = state.goal?.decider;
  const findings: StuckFinding[] = [];
  const late = lateNow(state, now);
  for (const task of state.tasks.values()) {
    const taskId = task.spec.id;
    if (isParentTask(state, task) || openRequestForTask(state, taskId)) continue;
    if (task.status === "blocked") {
      const since = blockedSince(ledger, taskId);
      if (since !== undefined && now.getTime() - Date.parse(since) >= STUCK_BLOCKED_HOURS * HOUR) {
        findings.push({ rule: "blocked", idempotencyKey: sweepKey("blocked", taskId, now), taskId, ...(decider ? { memberId: decider } : {}), reason: task.blocked?.reason ?? "", since });
      }
    }
    const assignee = state.members.get(task.spec.assignee);
    if ((task.status === "waiting" || task.status === "ready") && !assignee) {
      findings.push({ rule: "unassigned", idempotencyKey: sweepKey("unassigned", taskId, now), taskId, ...(decider ? { memberId: decider } : {}), reason: `담당 ${task.spec.assignee}이 없습니다.` });
    }
    if (late && assignee?.kind === "human" && (task.status === "running" || task.status === "revising")) {
      const finish = plannedFinish(ledger, taskId);
      if (finish && now.getTime() > finish.getTime()) {
        findings.push({ rule: "human_overdue", idempotencyKey: sweepKey("human_overdue", taskId, now), taskId, memberId: task.spec.assignee, since: finish.toISOString() });
      }
    }
  }
  for (const due of decisionsDue(state, events, now)) {
    const idempotencyKey = due.action === "remind" ? decisionReminderKey(due.requestId) : sweepKey("decision_expire", due.requestId, now);
    findings.push({ rule: due.action === "remind" ? "decision_remind" : "decision_expire", idempotencyKey, requestId: due.requestId, memberId: due.targetMemberId });
  }
  return findings.filter((finding) => !recorded.has(finding.idempotencyKey));
}

/** Q4: daily digest at 09:00 Asia/Seoul, on by default. */
export interface DigestSettings { enabled: boolean; hourKst: number }
export const DEFAULT_DIGEST_SETTINGS: DigestSettings = { enabled: true, hourKst: 9 };
export function digestKey(now: Date): string { return `digest:${kstDay(now)}`; }
/** When the previous digest was posted, from its `digest:<day>` key. */
export function lastDigestAt(events: readonly LedgerEvent[]): string | undefined {
  return events.findLast((event) => event.idempotencyKey?.startsWith("digest:"))?.at;
}
/** True once a day, at or after the digest hour, until a digest for that day is recorded. */
export function digestDue(events: readonly LedgerEvent[], now: Date, settings: DigestSettings = DEFAULT_DIGEST_SETTINGS): boolean {
  const hour = new Date(now.getTime() + KST_OFFSET).getUTCHours();
  return settings.enabled && hour >= settings.hourKst && !events.some((event) => event.idempotencyKey === digestKey(now));
}

export interface PersonDigest {
  memberId: Id;
  /** Work checked since the last digest: the person's own, or everything for the decider. */
  completedTaskIds: Id[];
  /** Agent work started since the last digest (decider only). */
  startedAgentTaskIds: Id[];
  /** Decision requests opened for this person since the last digest. */
  newDecisionIds: Id[];
  /** All decisions currently waiting on this person, legacy cards included. */
  openDecisions: number;
  /** Forecast finish (max) moved since the last digest (decider only). */
  forecastChange?: { from: string; to: string };
}

function forecastEnd(state: ProjectState, now: Date): string | undefined {
  try { const result = forecastFromState(state, now); return result.ok ? kstDay(result.end.max) : undefined; } catch { return undefined; }
}

/**
 * §3 B9 digest material between `since` (exclusive) and `now`. People with nothing new are left out entirely,
 * so an empty `people` means the digest is not posted. Text is the orchestrator's code template.
 */
export function digestFacts(state: ProjectState, events: readonly LedgerEvent[], since: Date, now: Date): { day: string; people: PersonDigest[] } {
  const ledger = typed(events);
  const inWindow = (event: AnyEvent) => Date.parse(event.at) > since.getTime() && Date.parse(event.at) <= now.getTime();
  const window = ledger.filter(inWindow);
  const checked = [...new Set(window.flatMap((event) => event.type === "task_checked" && state.tasks.get(event.payload.taskId)?.status === "checked" ? [event.payload.taskId] : []))];
  // 새로 시작: agent work started in the window that is still underway. Work that already finished is listed
  // under 완료 (or not at all when cancelled), never under both.
  const underway = (taskId: Id) => { const task = state.tasks.get(taskId); return !!task && task.status !== "checked" && task.status !== "cancelled" && state.members.get(task.spec.assignee)?.kind === "agent"; };
  const started = [...new Set(window.flatMap((event) => event.type === "task_started" && underway(event.payload.taskId) ? [event.payload.taskId] : []))];
  const requested = window.flatMap((event) => event.type === "decision_requested" && state.decisionRequests.get(event.payload.requestId)?.status === "open" ? [event.payload] : []);
  const open = openDecisions(state);
  const decider = state.goal?.decider;
  let forecastChange: PersonDigest["forecastChange"];
  if (decider !== undefined) {
    const before = ledger.filter((event) => Date.parse(event.at) <= since.getTime());
    const from = before.length ? forecastEnd(project(before), since) : undefined;
    const to = forecastEnd(state, now);
    if (from !== undefined && to !== undefined && from !== to) forecastChange = { from, to };
  }
  const people: PersonDigest[] = [];
  for (const member of state.members.values()) {
    if (member.kind !== "human") continue;
    const memberId = member.memberId; const isDecider = memberId === decider;
    const digest: PersonDigest = {
      memberId,
      completedTaskIds: checked.filter((taskId) => isDecider || state.tasks.get(taskId)?.spec.assignee === memberId),
      startedAgentTaskIds: isDecider ? started : [],
      newDecisionIds: requested.filter((request) => request.targetMemberId === memberId).map((request) => request.requestId),
      openDecisions: open.filter((decision) => decision.targetMemberId === memberId).length,
      ...(isDecider && forecastChange ? { forecastChange } : {}),
    };
    if (digest.completedTaskIds.length || digest.startedAgentTaskIds.length || digest.newDecisionIds.length || digest.forecastChange) people.push(digest);
  }
  return { day: kstDay(now), people };
}
