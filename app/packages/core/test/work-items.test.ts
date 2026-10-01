import { describe, expect, it } from "vitest";
import { affectedMembers, applyOps, diffPlans, forecastFromState, handoffBlockers, isStaleResult, planStarts, project, taskActivity, workStatus } from "../src/index.ts";
import type { EventPayloads, EventType, LedgerEvent, PlanOp, TaskDraft, TaskSpec } from "../src/index.ts";

type Emit = <K extends EventType>(type: K, payload: EventPayloads[K], actor?: LedgerEvent["actor"]) => void;
function ledger() {
  const events: LedgerEvent[] = [];
  const emit: Emit = (type, payload, actor = { kind: "pm", id: "pm" }) =>
    events.push({ id: `e${events.length}`, seq: events.length + 1, at: `2026-10-01T00:00:${String(events.length).padStart(2, "0")}Z`, projectId: "p", targetProductId: "p", actor, type, payload });
  return { events, emit };
}
const ctx = { projectId: "p", targetProductId: "p" };
const owner = { kind: "human", id: "owner" } as const;
const spec = (id: string, assignee: string, dependsOn: string[] = [], extra: Partial<TaskSpec> = {}): TaskSpec =>
  ({ id, title: id, baseTitle: id, assignee, dependsOn, handoffConditions: [`${id} done`], exclusions: [], limits: [], ...extra });
const draft = (tempId: string, assignee = "agent", extra: Partial<TaskDraft> = {}): TaskDraft => ({
  tempId, title: tempId, assignee, handoffConditions: [`${tempId} done`], dependsOn: [], priority: "normal",
  routing: { executor: "agent", reason: "agent_capable", note: "역할에 맞음" },
  brief: { why: "목표에 필요", sourceMessageIds: [], decisionIds: [], attachmentIds: [], constraints: [] }, ...extra,
});
function team(emit: Emit) {
  emit("member_joined", { memberId: "owner", kind: "human", displayName: "사용자" });
  emit("member_joined", { memberId: "agent", kind: "agent", displayName: "Agent", role: "prototype-agent" });
  emit("member_joined", { memberId: "agent2", kind: "agent", displayName: "Agent 2", role: "research-agent" });
  emit("goal_set", { text: "목표", deadline: "2026-10-12T00:00:00Z", decider: "owner", delegation: { pmMayApply: ["reorder", "split_task"] } }, owner);
}
const commit = (emit: Emit, version: number, tasks: TaskSpec[]) =>
  emit("plan_committed", { version, basedOn: version === 1 ? null : version - 1, tasks, reason: "", approvedBy: "owner", sourceMessageIds: [] });
const finish = (emit: Emit, taskId: string, resultId = `${taskId}-r`) => {
  emit("task_started", { taskId });
  emit("result_submitted", { taskId, resultId, planVersion: 1, summary: "", artifactIds: [] });
  emit("task_checked", { taskId, resultId, reason: "충족" });
};

describe("work metadata", () => {
  it("(1) task_meta_set leaves specVersion, result freshness and checked status alone", () => {
    const { events, emit } = ledger(); team(emit);
    commit(emit, 1, [spec("done", "agent"), spec("review", "agent2")]);
    finish(emit, "done");
    emit("task_started", { taskId: "review" });
    emit("result_submitted", { taskId: "review", resultId: "rr", planVersion: 1, summary: "", artifactIds: [] });
    const before = project(events);
    for (const taskId of ["done", "review"]) emit("task_meta_set", {
      taskId, priority: "high", routing: { executor: "agent", reason: "agent_capable", note: "바로 맡김" },
      brief: { why: "이유", sourceMessageIds: ["m"], decisionIds: [], attachmentIds: [], constraints: ["결제 제외"] },
      origin: { createdBy: "pm", planVersion: 1, sourceMessageIds: [] },
    });
    const after = project(events);
    const strip = (state: typeof after) => [...state.tasks].map(([id, { meta: _meta, ...task }]) => [id, task]);
    expect(strip(after)).toEqual(strip(before));
    expect(after.tasks.get("done")).toMatchObject({ status: "checked", specVersion: 1, checkedResultId: "done-r", meta: { priority: "high" } });
    const review = after.tasks.get("review")!;
    expect(review.specVersion).toBe(1);
    expect(isStaleResult(review, "rr")).toBe(false);
    expect(handoffBlockers(after, "review", "rr")).toEqual([]);
    expect(after.automation).toEqual(before.automation);
  });

  it("(9) keeps only the first origin; later metadata still merges field by field", () => {
    const { events, emit } = ledger(); team(emit);
    commit(emit, 1, [spec("a", "agent")]);
    emit("task_meta_set", { taskId: "a", origin: { createdBy: "owner", planVersion: 1, sourceMessageIds: ["m1"] } });
    emit("task_meta_set", { taskId: "a", priority: "low", origin: { createdBy: "pm", planVersion: 5, sourceMessageIds: ["m9"], splitFrom: "x" } });
    emit("task_meta_set", { taskId: "a", routing: { executor: "agent", reason: "agent_capable", note: "" } });
    emit("task_meta_set", { taskId: "missing", priority: "high" });
    const state = project(events);
    expect(state.tasks.get("a")?.meta).toEqual({
      priority: "low", routing: { executor: "agent", reason: "agent_capable", note: "" },
      origin: { createdBy: "owner", planVersion: 1, sourceMessageIds: ["m1"] },
    });
    expect(state.tasks.has("missing")).toBe(false);
  });

  it("(11) creating or splitting work does not move existing tasks' specVersion", () => {
    const { events, emit } = ledger(); team(emit);
    const v1 = [spec("a", "agent"), spec("b", "agent2", ["a"])];
    commit(emit, 1, v1);
    emit("task_started", { taskId: "a" });
    emit("result_submitted", { taskId: "a", resultId: "ra", planVersion: 1, summary: "", artifactIds: [] });
    const ops: PlanOp[] = [{ type: "create_task", ...draft("c", "agent2"), sourceMessageIds: [] }, { type: "split_task", taskId: "b", children: [draft("b1", "agent2")], sourceMessageIds: [] }];
    const v2 = applyOps(v1, ops);
    const diff = diffPlans(v1, v2);
    expect(diff.changed).toEqual([]);
    expect(diff.added.map((t) => t.id)).toEqual(["c", "b1"]);
    commit(emit, 2, v2);
    const state = project(events);
    expect([...state.tasks].map(([id, t]) => [id, t.specVersion, t.ordinal])).toEqual([["a", 1, 1], ["b", 1, 2], ["c", 2, 3], ["b1", 2, 4]]);
    expect(isStaleResult(state.tasks.get("a")!, "ra")).toBe(false);
    // Only the new work's assignee hears about it; existing assignees are not notified.
    expect(affectedMembers(state, diff)).toEqual(["agent2"]);
  });
});

describe("parent work", () => {
  it("(2) all children checked → parent checked → work depending on the parent becomes ready", () => {
    const { events, emit } = ledger(); team(emit);
    commit(emit, 1, [spec("parent", "agent"), spec("c1", "agent", [], { parentId: "parent" }), spec("c2", "agent2", [], { parentId: "parent" }), spec("after", "agent", ["parent"])]);
    let state = project(events);
    expect([...state.tasks].map(([id, t]) => [id, t.status])).toEqual([["parent", "waiting"], ["c1", "ready"], ["c2", "ready"], ["after", "waiting"]]);
    finish(emit, "c1");
    state = project(events);
    expect(state.tasks.get("parent")?.status).toBe("waiting");
    expect(state.tasks.get("after")?.status).toBe("waiting");
    finish(emit, "c2");
    state = project(events);
    expect(state.tasks.get("parent")?.status).toBe("checked");
    expect(workStatus(state.tasks.get("parent")!, state)).toBe("done");
    expect(state.tasks.get("after")?.status).toBe("ready");
    expect(planStarts(state, "c2-r", ctx).map((e) => (e.payload as { taskId: string }).taskId)).toEqual(["after"]);
  });

  it("a parent never takes an execution status, and cancelling all children makes it ordinary work again", () => {
    const { events, emit } = ledger(); team(emit);
    const tasks = [spec("parent", "agent"), spec("c1", "agent", [], { parentId: "parent" })];
    commit(emit, 1, tasks);
    emit("task_start_reserved", { taskId: "parent", specVersion: 1, trigger: "x" });
    emit("task_blocked", { taskId: "parent", reason: "?" });
    expect(project(events).tasks.get("parent")).toMatchObject({ status: "waiting" });
    expect(project(events).tasks.get("parent")?.blocked).toBeUndefined();
    finish(emit, "c1");
    expect(project(events).tasks.get("parent")?.status).toBe("checked");
    commit(emit, 2, applyOps(tasks, [{ type: "cancel_task", taskId: "c1", reason: "범위 축소", sourceMessageIds: [] }]));
    expect(project(events).tasks.get("parent")).toMatchObject({ status: "ready", children: [] });
  });

  it("(3) parents are left out of planStarts and the forecast", () => {
    const { events, emit } = ledger(); team(emit);
    commit(emit, 1, [spec("parent", "agent"), spec("c1", "agent", [], { parentId: "parent" }), spec("c2", "agent2", ["c1"], { parentId: "parent" }), spec("after", "agent2", ["parent"])]);
    for (const taskId of ["parent", "c1", "c2", "after"]) emit("estimate_updated", { taskId, hours: { min: 8, max: 8 }, source: "pm" });
    const state = project(events);
    // Even if something marked the parent ready, it is never started.
    state.tasks.get("parent")!.status = "ready";
    expect(planStarts(state, "t", ctx).map((e) => (e.payload as { taskId: string }).taskId)).toEqual(["c1"]);
    const result = forecastFromState(project(events), new Date("2026-10-01T00:00:00Z"));
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.tasks.map((t) => t.taskId)).toEqual(["c1", "c2", "after"]);
    const span = (id: string) => result.tasks.find((t) => t.taskId === id)!.max;
    // "after" waits for every subtask of the parent.
    expect(span("after").startDay).toBeGreaterThanOrEqual(span("c2").endDay);
  });
});

describe("start order", () => {
  it("(7) high-priority work is reserved first", () => {
    const { events, emit } = ledger(); team(emit);
    commit(emit, 1, [spec("normal", "agent"), spec("low", "agent2"), spec("urgent", "agent"), spec("other", "agent2")]);
    emit("task_meta_set", { taskId: "urgent", priority: "high" });
    emit("task_meta_set", { taskId: "low", priority: "low" });
    const starts = planStarts(project(events), "t", ctx).map((e) => (e.payload as { taskId: string }).taskId);
    // One turn per agent: "urgent" takes agent ahead of the earlier "normal"; "other" beats "low".
    expect(starts).toEqual(["urgent", "other"]);
  });
});

describe("taskActivity", () => {
  it("(8) lists the task's history in ledger order, with where it came from", () => {
    const { events, emit } = ledger(); team(emit);
    emit("message_recorded", { messageId: "m1", authorId: "owner", text: "로그인 화면도 만들어 줘", attachmentIds: [] }, owner);
    emit("plan_committed", { version: 1, basedOn: null, tasks: [spec("a", "agent"), spec("b", "agent2")], reason: "추가", approvedBy: "owner", sourceMessageIds: ["m1"] });
    emit("task_meta_set", { taskId: "a", origin: { createdBy: "owner", planVersion: 1, sourceMessageIds: ["m1"], decisionRequestId: "dr0" } });
    emit("task_started", { taskId: "a" });
    emit("task_started", { taskId: "b" });
    emit("message_recorded", { messageId: "c1", authorId: "owner", text: "버튼 크게", threadId: "task:a", attachmentIds: [] }, owner);
    emit("message_recorded", { messageId: "c2", authorId: "owner", text: "다른 작업", threadId: "task:b", attachmentIds: [] }, owner);
    emit("decision_requested", {
      requestId: "dr1", kind: "missing_info", targetMemberId: "owner", question: "색은요?",
      options: [{ optionId: "x", label: "답하기", effects: [{ type: "answer", taskId: "a" }], tradeoff: "" }, { optionId: "h", label: "보류", effects: [{ type: "none" }], tradeoff: "" }],
      recommendation: { optionId: "x", rationale: "", evidence: [] }, impact: { taskIds: ["a"], blockedTaskIds: ["a"] }, sourceMessageIds: [],
    });
    emit("decision_resolved", { requestId: "dr1", by: "owner", outcome: "answered", answerText: "파랑" }, owner);
    emit("agent_report_recorded", { memberId: "agent", taskId: "a", text: "진행 중", turnId: "t1" }, { kind: "agent", id: "agent" });
    emit("result_submitted", { taskId: "a", resultId: "r1", planVersion: 1, summary: "시안", artifactIds: [] });
    emit("handoff_reviewed", { taskId: "a", resultId: "r1", verdict: "insufficient", met: [], missing: ["오류 흐름"], evidence: [] });
    emit("revision_requested", { taskId: "a", resultId: "r1", missing: ["오류 흐름"] });
    emit("task_blocked", { taskId: "a", reason: "자료 없음" });
    emit("task_resumed", { taskId: "a" });
    emit("plan_committed", { version: 2, basedOn: 1, tasks: [spec("a", "agent2"), spec("b", "agent2")], reason: "재배정", approvedBy: "owner", sourceMessageIds: [] });
    emit("update_sent", { updateId: "u1", taskId: "a", fromVersion: 1, toVersion: 2 });
    emit("pm_spoke", { considerationId: "c", messageId: "pm1", text: "메모", kind: "fact", threadId: "task:a" });
    emit("plan_committed", { version: 3, basedOn: 2, tasks: [spec("b", "agent2")], reason: "취소", approvedBy: "owner", sourceMessageIds: [] });
    // Input order does not matter; ledger order does.
    const activity = taskActivity([...events].reverse(), "a");
    expect(activity.map((item) => item.kind)).toEqual([
      "created", "started", "comment", "decision_requested", "decision_resolved", "comment", "submitted", "reviewed", "revision", "blocked", "resumed", "assigned", "changed", "comment", "changed",
    ]);
    expect(activity.map((item) => item.seq)).toEqual([...activity.map((item) => item.seq)].sort((x, y) => x - y));
    expect(activity[0]).toMatchObject({ kind: "created", planVersion: 1, assignee: "agent", source: { createdBy: "owner", sourceMessageIds: ["m1"], decisionRequestId: "dr0" } });
    expect(activity[2]).toMatchObject({ actorId: "owner", messageId: "c1", text: "버튼 크게" });
    expect(activity[4]).toMatchObject({ actorId: "owner", requestId: "dr1", text: "answered" });
    expect(activity[11]).toMatchObject({ kind: "assigned", assignee: "agent2", planVersion: 2 });
    expect(activity.at(-1)).toMatchObject({ kind: "changed", cancelled: true, planVersion: 3 });
    // Without an origin, the plan commit's messages are the source.
    expect(taskActivity(events, "b")[0]).toMatchObject({ kind: "created", source: { sourceMessageIds: ["m1"] } });
    // An answer names the words that went to the agent.
    expect(activity[4]).toMatchObject({ answerText: "파랑" });
  });

  it("links a later plan change to the conversation that made it", () => {
    const { events, emit } = ledger(); team(emit);
    commit(emit, 1, [spec("a", "agent")]);
    emit("message_recorded", { messageId: "m2", authorId: "owner", text: "결제는 이번엔 빼자", attachmentIds: [] }, owner);
    emit("plan_committed", { version: 2, basedOn: 1, tasks: [spec("a", "agent", [], { exclusions: ["결제"] })], reason: "a에서 결제 제외", approvedBy: "pm", sourceMessageIds: ["m2"] });
    expect(taskActivity(events, "a").at(-1)).toMatchObject({ kind: "changed", planVersion: 2, text: "a에서 결제 제외", source: { sourceMessageIds: ["m2"] } });
  });
});
