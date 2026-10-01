import { describe, expect, it } from "vitest";
import { planStarts, project, workStatus } from "../src/index.ts";
import type { EventPayloads, EventType, LedgerEvent, ProjectState, TaskSpec } from "../src/index.ts";

type Emit = <K extends EventType>(type: K, payload: EventPayloads[K], actor?: LedgerEvent["actor"]) => void;
function ledger() {
  const events: LedgerEvent[] = [];
  const emit: Emit = (type, payload, actor = { kind: "pm", id: "pm" }) =>
    events.push({ id: `e${events.length}`, seq: events.length + 1, at: "2026-10-01T00:00:00Z", projectId: "p", targetProductId: "p", actor, type, payload });
  return { events, emit };
}
const ctx = { projectId: "p", targetProductId: "p" };
const owner = { kind: "human", id: "owner" } as const;
const spec = (id: string, assignee: string, dependsOn: string[] = [], extra: Partial<TaskSpec> = {}): TaskSpec =>
  ({ id, title: id, baseTitle: id, assignee, dependsOn, handoffConditions: [`${id} done`], exclusions: [], limits: [], ...extra });

/** A ledger touching most existing event kinds: cards, starts, review, revision, block, authority, replan, cancel, updates. */
function fixture(emit: Emit, extra: (step: string) => void = () => {}) {
  emit("member_joined", { memberId: "owner", kind: "human", displayName: "사용자" });
  emit("member_joined", { memberId: "designer", kind: "human", displayName: "디자이너" });
  emit("member_joined", { memberId: "agent", kind: "agent", displayName: "프로토타입 Agent", role: "prototype" });
  emit("goal_set", { text: "2주 안에 고객 반응 확인", deadline: "2026-10-12", decider: "owner", delegation: { pmMayApply: ["reorder"] } }, owner);
  const v1 = [spec("design", "designer"), spec("prototype", "agent", ["design"]), spec("review", "owner", ["prototype"]), spec("extra", "agent")];
  emit("plan_proposed", { proposalId: "prop1", version: 1, tasks: v1, estimates: [], reason: "초기 계획", forMemberId: "owner" });
  emit("plan_decided", { proposalId: "prop1", memberId: "owner", approved: true }, owner);
  emit("plan_committed", { version: 1, basedOn: null, tasks: v1, reason: "초기 계획", approvedBy: "owner", sourceMessageIds: [] });
  extra("planned");
  emit("message_recorded", { messageId: "m1", authorId: "designer", text: "흐름 초안 올렸어요", attachmentIds: [] }, { kind: "human", id: "designer" });
  emit("task_started", { taskId: "design" });
  emit("result_submitted", { taskId: "design", resultId: "r1", planVersion: 1, summary: "흐름", artifactIds: [] });
  emit("task_checked", { taskId: "design", resultId: "r1", reason: "충족" });
  extra("designed");
  emit("task_start_reserved", { taskId: "prototype", specVersion: 1, trigger: "design" });
  emit("task_started", { taskId: "prototype", turnId: "t1" });
  emit("turn_observed", { agentId: "agent", taskId: "prototype", turnId: "t1", status: "started" });
  emit("result_submitted", { taskId: "prototype", resultId: "r2", planVersion: 1, summary: "시안", artifactIds: [] });
  emit("revision_requested", { taskId: "prototype", resultId: "r2", missing: ["오류 흐름"] });
  extra("revising");
  emit("task_blocked", { taskId: "review", reason: "검토자 휴가", unblockBy: "owner" });
  emit("authority_requested", { requestId: "auth1", personId: "owner", changeKinds: ["scope_reduce"], text: "범위를 줄여도 될까요?" });
  emit("authority_granted", { requestId: "auth1", personId: "owner", granted: true }, owner);
  const v2 = [v1[0]!, { ...v1[1]!, exclusions: ["결제"] }, { ...v1[2]!, assignee: "designer" }];
  emit("plan_committed", { version: 2, basedOn: 1, tasks: v2, reason: "결제 제외, 검토 담당 변경", approvedBy: "owner", sourceMessageIds: ["m1"] });
  extra("replanned");
  emit("update_sent", { updateId: "u1", taskId: "prototype", fromVersion: 1, toVersion: 2, turnId: "t1" });
  emit("update_acknowledged", { updateId: "u1", taskId: "prototype", planVersion: 2, applied: ["결제 제외"], dropped: [] });
  emit("task_resumed", { taskId: "review" });
  emit("pm_spoke", { considerationId: "c1", messageId: "pm1", text: "결제는 빼고 진행해요", kind: "summary" });
}

/**
 * Additive work/decision events a later milestone would write. None may move existing task state,
 * even after MA/MB fill the reducers: requests are withdrawn by the PM, so no automation reset applies.
 */
function newEvents(emit: Emit) {
  return (step: string) => {
    if (step === "planned") {
      for (const taskId of ["design", "prototype", "review", "extra"]) emit("task_meta_set", {
        taskId, priority: taskId === "prototype" ? "high" : "normal",
        routing: taskId === "prototype" ? { executor: "agent", reason: "agent_capable", note: "역할에 맞음" } : { executor: "human", reason: "needs_human_judgement", note: "사람 판단" },
        brief: { why: "고객 반응을 보려면 필요", sourceMessageIds: [], decisionIds: [], attachmentIds: [], constraints: [] },
        origin: { createdBy: "pm", planVersion: 1, sourceMessageIds: [] },
      });
    }
    if (step === "designed") emit("task_meta_set", { taskId: "design", priority: "low", origin: { createdBy: "owner", planVersion: 9, sourceMessageIds: ["x"] } });
    if (step === "revising") {
      emit("decision_requested", {
        requestId: "dr1", kind: "missing_info", targetMemberId: "owner", question: "오류 흐름 기준이 뭔가요?",
        options: [
          { optionId: "answer", label: "답하기", effects: [{ type: "answer", taskId: "prototype" }], tradeoff: "" },
          { optionId: "hold", label: "보류", effects: [{ type: "none" }], tradeoff: "늦어짐" },
        ],
        recommendation: { optionId: "answer", rationale: "작업이 멈춤", evidence: ["r2"] },
        impact: { taskIds: ["prototype"], blockedTaskIds: ["prototype"] }, sourceMessageIds: [],
      });
      emit("pm_spoke", { considerationId: "c0", messageId: "pm0", text: "결정이 필요해요", kind: "ask", taskIds: ["prototype"], requestId: "dr1" });
    }
    if (step === "replanned") {
      emit("decision_requested", {
        requestId: "dr2", kind: "plan_change", targetMemberId: "owner", question: "검토를 디자이너에게 맡길까요?",
        options: [
          { optionId: "move", label: "디자이너가 맡기", effects: [{ type: "plan_ops", ops: [{ type: "reassign", taskId: "review", assignee: "designer", sourceMessageIds: ["m1"] }] }], tradeoff: "" },
          { optionId: "keep", label: "그대로", effects: [{ type: "none" }], tradeoff: "" },
        ],
        recommendation: { optionId: "move", rationale: "검토자 휴가", evidence: ["m1"] },
        impact: { taskIds: ["review"], blockedTaskIds: ["review"], deadlineDeltaDays: -1 }, editable: ["assignee", "priority"], sourceMessageIds: ["m1"], remindAt: "2026-10-02T00:00:00Z",
      });
      emit("decision_resolved", { requestId: "dr2", by: "pm", outcome: "withdrawn", note: "상태가 바뀜" });
      emit("decision_resolved", { requestId: "dr1", by: "pm", outcome: "withdrawn" });
    }
  };
}

/** Everything existing code reads, minus ledger positions (seq) that inserted events necessarily shift. */
function existingView(state: ProjectState) {
  const { lastSeq: _seq, decisionRequests: _requests, messages, tasks, ...rest } = state;
  return {
    ...rest,
    messages: messages.filter((m) => m.messageId !== "pm0").map(({ seq: _s, ...m }) => m),
    tasks: [...tasks].map(([id, { meta: _meta, ...task }]) => [id, task]),
  };
}

describe("M0 contract", () => {
  it("new events do not change projection of an existing ledger", () => {
    const base = ledger(); fixture(base.emit);
    const mixed = ledger(); fixture(mixed.emit, newEvents(mixed.emit));
    const before = project(base.events), after = project(mixed.events);
    expect(mixed.events.length).toBe(base.events.length + 10);
    expect(existingView(after)).toEqual(existingView(before));
    expect([...after.tasks].map(([id, t]) => [id, t.status, t.specVersion])).toEqual([
      ["design", "checked", 1], ["prototype", "revising", 2], ["review", "waiting", 2], ["extra", "cancelled", 1],
    ]);
    expect(after.plan).toEqual(before.plan);
    expect(after.automation).toEqual(before.automation);
    expect(planStarts(after, "t", ctx)).toEqual(planStarts(before, "t", ctx));
  });

  it("existing ledgers get default work fields", () => {
    const { events, emit } = ledger(); fixture(emit);
    const state = project(events);
    expect(state.decisionRequests.size).toBe(0);
    expect([...state.tasks.values()].map((t) => [t.spec.id, t.ordinal, t.children, t.reassignCount, t.meta])).toEqual([
      ["design", 1, [], 0, { priority: "normal" }], ["prototype", 2, [], 0, { priority: "normal" }],
      ["review", 3, [], 1, { priority: "normal" }], ["extra", 4, [], 0, { priority: "normal" }],
    ]);
  });

  it("tracks children and leaves a live parent's status to the rollup", () => {
    const { events, emit } = ledger();
    emit("member_joined", { memberId: "agent", kind: "agent", displayName: "Agent" });
    const tasks = [spec("parent", "agent"), spec("a", "agent", [], { parentId: "parent" }), spec("b", "agent", ["a"], { parentId: "parent" }), spec("after", "agent", ["parent"])];
    emit("plan_committed", { version: 1, basedOn: null, tasks, reason: "", approvedBy: "owner", sourceMessageIds: [] });
    const state = project(events);
    expect(state.tasks.get("parent")).toMatchObject({ children: ["a", "b"], status: "waiting" });
    expect(state.tasks.get("a")?.status).toBe("ready");
    expect(state.tasks.get("after")?.status).toBe("waiting");
    // Once no live child remains, the task is ordinary work again.
    emit("plan_committed", { version: 2, basedOn: 1, tasks: tasks.filter((t) => t.id === "parent"), reason: "", approvedBy: "owner", sourceMessageIds: [] });
    expect(project(events).tasks.get("parent")).toMatchObject({ children: [], status: "ready", specVersion: 1 });
  });

  it("projects a PM thread note with its thread", () => {
    const { events, emit } = ledger();
    emit("pm_spoke", { considerationId: "c", messageId: "pm-note", text: "메모", kind: "fact", threadId: "task:a", taskIds: ["a"] });
    expect(project(events).messages).toEqual([{ messageId: "pm-note", authorId: "pm", text: "메모", threadId: "task:a", seq: 1 }]);
  });

  it("maps task status to the people-facing work status", () => {
    const { events, emit } = ledger(); fixture(emit);
    const state = project(events);
    const status = () => Object.fromEntries([...state.tasks].map(([id, t]) => [id, workStatus(t, state)]));
    expect(status()).toEqual({ design: "done", prototype: "in_progress", review: "todo", extra: "cancelled" });
    const request: EventPayloads["decision_requested"] = {
      requestId: "dr", kind: "choice", targetMemberId: "owner", question: "?", options: [], recommendation: { optionId: "x", rationale: "", evidence: [] },
      impact: { taskIds: [], blockedTaskIds: ["prototype", "design"] }, sourceMessageIds: [],
    };
    state.decisionRequests.set("dr", { request, status: "open", requestedSeq: 1 });
    expect(status()).toMatchObject({ design: "done", prototype: "waiting_human" });
    state.decisionRequests.set("dr", { request, status: "answered", requestedSeq: 1 });
    expect(status().prototype).toBe("in_progress");
  });
});
