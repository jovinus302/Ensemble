import { describe, expect, it } from "vitest";
import { createDecisionRequest, digestDue, digestFacts, digestKey, kstDay, project, stuckFindings } from "../src/index.ts";
import type { EventPayloads, EventType, LedgerEvent, NewLedgerEvent, TaskSpec } from "../src/index.ts";

const ctx = { projectId: "p", targetProductId: "p" };
const pm = { kind: "pm", id: "pm" } as const;
const spec = (id: string, assignee: string): TaskSpec => ({ id, title: id, baseTitle: id, assignee, dependsOn: [], handoffConditions: [], exclusions: [], limits: [] });
const T0 = Date.parse("2026-10-01T00:00:00Z");
const at = (hours: number) => new Date(T0 + hours * 3_600_000);

function ledger() {
  const events: LedgerEvent[] = [];
  const emit = <K extends EventType>(type: K, payload: EventPayloads[K], hours = 0, extra: Partial<LedgerEvent> = {}) =>
    events.push({ id: `e${events.length}`, seq: events.length + 1, at: at(hours).toISOString(), projectId: "p", targetProductId: "p", actor: pm, type, payload, ...extra });
  const append = (event: NewLedgerEvent, hours = 0) => events.push({ ...event, id: `e${events.length}`, seq: events.length + 1, at: at(hours).toISOString() });
  emit("member_joined", { memberId: "owner", kind: "human", displayName: "사용자" });
  emit("member_joined", { memberId: "designer", kind: "human", displayName: "디자이너" });
  emit("member_joined", { memberId: "agent", kind: "agent", displayName: "Agent", role: "prototype" });
  emit("goal_set", { text: "출시", decider: "owner", delegation: { pmMayApply: ["reorder"] } }, 0, { actor: { kind: "human", id: "owner" } });
  emit("plan_committed", { version: 1, basedOn: null, tasks: [spec("a", "agent"), spec("b", "agent"), spec("design", "designer")], reason: "초기", approvedBy: "owner", sourceMessageIds: [] });
  return { events, emit, append };
}
const stuckRequest = (taskId: string): EventPayloads["decision_requested"] => ({
  requestId: `stuck-${taskId}`, kind: "stuck_work", targetMemberId: "owner", question: `${taskId}가 막혔어요. 다시 맡길까요?`,
  options: [
    { optionId: "retry", label: "다시 맡기기", effects: [{ type: "resolve_task", taskId, action: "retry" }], tradeoff: "" },
    { optionId: "hold", label: "보류", effects: [{ type: "none" }], tradeoff: "" },
  ],
  recommendation: { optionId: "retry", rationale: "일시적 오류", evidence: [] }, impact: { taskIds: [taskId], blockedTaskIds: [taskId] }, sourceMessageIds: [],
});

describe("stuckFindings", () => {
  it("reports blocked work after four hours, once a day, and skips work that has a decision request", () => {
    const { events, emit, append } = ledger();
    emit("task_start_reserved", { taskId: "a", specVersion: 1, trigger: "t" }, 1);
    emit("task_started", { taskId: "a" }, 1);
    emit("task_blocked", { taskId: "a", reason: "API 키 없음" }, 2);
    emit("task_blocked", { taskId: "b", reason: "모호함" }, 2);
    expect(stuckFindings(project(events), events, at(5.9))).toEqual([]);
    const findings = stuckFindings(project(events), events, at(6));
    expect(findings).toEqual([
      { rule: "blocked", idempotencyKey: "sweep:blocked:a:2026-10-01", taskId: "a", memberId: "owner", reason: "API 키 없음", since: at(2).toISOString() },
      { rule: "blocked", idempotencyKey: "sweep:blocked:b:2026-10-01", taskId: "b", memberId: "owner", reason: "모호함", since: at(2).toISOString() },
    ]);

    // Acting on "a" records its key; "b" gets a decision request.
    emit("pm_spoke", { considerationId: "c", messageId: "pm1", text: "a가 막혔어요", kind: "nudge", taskIds: ["a"] }, 6, { idempotencyKey: findings[0]!.idempotencyKey });
    append(createDecisionRequest(project(events), stuckRequest("b"), ctx, at(6)), 6);
    expect(stuckFindings(project(events), events, at(8))).toEqual([]);
    // Next KST day (2026-10-02 starts at 15:00 UTC) the unresolved block is reported again.
    expect(stuckFindings(project(events), events, at(15)).map((f) => f.idempotencyKey)).toEqual(["sweep:blocked:a:2026-10-02"]);
  });

  it("measures from the current block, not an earlier resumed one", () => {
    const { events, emit } = ledger();
    emit("task_blocked", { taskId: "a", reason: "첫 막힘" }, 0);
    emit("task_resumed", { taskId: "a" }, 1);
    emit("task_blocked", { taskId: "a", reason: "둘째 막힘" }, 3);
    expect(stuckFindings(project(events), events, at(6))).toEqual([]);
    expect(stuckFindings(project(events), events, at(7))).toHaveLength(1);
  });

  it("asks for an assignment when todo work has no member assignee, and reminds open requests once", () => {
    const { events, emit, append } = ledger();
    emit("plan_committed", { version: 2, basedOn: 1, tasks: [spec("a", "agent"), spec("b", "gone"), spec("design", "designer")], reason: "변경", approvedBy: "owner", sourceMessageIds: [] });
    append(createDecisionRequest(project(events), stuckRequest("a"), ctx, at(0)), 0);
    const findings = stuckFindings(project(events), events, at(24));
    expect(findings.map((f) => [f.rule, f.taskId ?? f.requestId, f.memberId])).toEqual([["unassigned", "b", "owner"], ["decision_remind", "stuck-a", "owner"]]);
    expect(findings[1]!.idempotencyKey).toBe("decision:stuck-a:remind");
  });
});

describe("digestFacts", () => {
  it("leaves out people with no changes", () => {
    const { events, emit } = ledger();
    emit("task_start_reserved", { taskId: "a", specVersion: 1, trigger: "t" }, 1);
    emit("task_started", { taskId: "a" }, 1);
    emit("result_submitted", { taskId: "a", resultId: "r1", planVersion: 1, summary: "완료", artifactIds: [] }, 2);
    emit("task_checked", { taskId: "a", resultId: "r1", reason: "충족" }, 3);
    const facts = digestFacts(project(events), events, at(0.5), at(9));
    expect(facts.day).toBe("2026-10-01");
    expect(facts.people).toEqual([{ memberId: "owner", completedTaskIds: ["a"], startedAgentTaskIds: [], newDecisionIds: [], openDecisions: 0 }]);
    expect(digestFacts(project(events), events, at(4), at(9)).people).toEqual([]);
  });

  it("lists work under 새로 시작 only while it is still underway, not once it finished or was cancelled", () => {
    const { events, emit } = ledger();
    emit("plan_committed", { version: 2, basedOn: 1, tasks: [spec("a", "agent"), spec("b", "agent"), spec("c", "agent"), spec("design", "designer")], reason: "추가", approvedBy: "owner", sourceMessageIds: [] });
    emit("task_started", { taskId: "a" }, 1);
    emit("result_submitted", { taskId: "a", resultId: "r1", planVersion: 2, summary: "완료", artifactIds: [] }, 2);
    emit("task_checked", { taskId: "a", resultId: "r1", reason: "충족" }, 3);
    emit("task_started", { taskId: "b" }, 1);
    emit("task_started", { taskId: "c" }, 1);
    emit("plan_committed", { version: 3, basedOn: 2, tasks: [spec("a", "agent"), spec("b", "agent"), spec("design", "designer")], reason: "c 취소", approvedBy: "owner", sourceMessageIds: [] }, 4);
    const state = project(events);
    const owner = digestFacts(state, events, at(0), at(9)).people.find((p) => p.memberId === "owner")!;
    expect(owner.completedTaskIds).toEqual(["a"]);
    expect(state.tasks.get("c")?.status).toBe("cancelled");
    expect(owner.startedAgentTaskIds).toEqual(["b"]);
    expect(owner.startedAgentTaskIds).not.toContain("a");
  });

  it("mentions a person for their own completed work and new requests", () => {
    const { events, emit, append } = ledger();
    emit("task_started", { taskId: "design" }, 1);
    emit("result_submitted", { taskId: "design", resultId: "r1", planVersion: 1, summary: "시안", artifactIds: [] }, 2);
    emit("task_checked", { taskId: "design", resultId: "r1", reason: "충족" }, 3);
    append(createDecisionRequest(project(events), { ...stuckRequest("a"), targetMemberId: "designer" }, ctx, at(4)), 4);
    const people = digestFacts(project(events), events, at(0), at(9)).people;
    expect(people.map((p) => [p.memberId, p.completedTaskIds, p.newDecisionIds, p.openDecisions])).toEqual([
      ["owner", ["design"], [], 0], ["designer", ["design"], ["stuck-a"], 1],
    ]);
  });
});

describe("digest schedule (Q4)", () => {
  it("is due once a day from 09:00 Asia/Seoul and can be switched off", () => {
    const morning = new Date("2026-10-02T00:00:00Z"); // 09:00 KST
    expect(kstDay(morning)).toBe("2026-10-02");
    expect(digestDue([], new Date("2026-10-01T23:59:00Z"))).toBe(false);
    expect(digestDue([], morning)).toBe(true);
    expect(digestDue([], morning, { enabled: false, hourKst: 9 })).toBe(false);
    const posted = [{ id: "d", seq: 1, at: morning.toISOString(), projectId: "p", targetProductId: "p", actor: pm, type: "pm_spoke", idempotencyKey: digestKey(morning), payload: {} }];
    expect(digestDue(posted, new Date("2026-10-02T05:00:00Z"))).toBe(false);
  });
});
