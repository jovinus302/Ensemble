import { describe, expect, it } from "vitest";
import { applyOps, DEFAULT_PM_MAY_APPLY, MAX_REASSIGNS, opAuthority, planOpProblems, planOpsProblems, planStructureProblems, project, taskMetaFromOps } from "../src/index.ts";
import type { ChangeKind, EventPayloads, EventType, LedgerEvent, PlanOp, TaskDraft, TaskSpec } from "../src/index.ts";

type Emit = <K extends EventType>(type: K, payload: EventPayloads[K], actor?: LedgerEvent["actor"]) => void;
function ledger(pmMayApply: ChangeKind[] = DEFAULT_PM_MAY_APPLY) {
  const events: LedgerEvent[] = [];
  const emit: Emit = (type, payload, actor = { kind: "pm", id: "pm" }) =>
    events.push({ id: `e${events.length}`, seq: events.length + 1, at: "2026-10-01T00:00:00Z", projectId: "p", targetProductId: "p", actor, type, payload });
  emit("member_joined", { memberId: "owner", kind: "human", displayName: "사용자" });
  emit("member_joined", { memberId: "designer", kind: "human", displayName: "디자이너" });
  emit("member_joined", { memberId: "agent", kind: "agent", displayName: "Agent", role: "prototype-agent" });
  emit("member_joined", { memberId: "agent2", kind: "agent", displayName: "Agent 2", role: "research-agent" });
  emit("goal_set", { text: "목표", decider: "owner", delegation: { pmMayApply } }, { kind: "human", id: "owner" });
  emit("message_recorded", { messageId: "owner-msg", authorId: "owner", text: "로그인 화면도 만들어 줘", attachmentIds: [] }, { kind: "human", id: "owner" });
  emit("message_recorded", { messageId: "designer-msg", authorId: "designer", text: "로그인 화면도 만들어 줘", attachmentIds: [] }, { kind: "human", id: "designer" });
  emit("decision_recorded", { decisionId: "d1", summary: "결제 제외", sourceMessageIds: ["owner-msg"], approvedBy: "owner", changeKinds: [] });
  return { events, emit };
}
const spec = (id: string, assignee: string, dependsOn: string[] = [], extra: Partial<TaskSpec> = {}): TaskSpec =>
  ({ id, title: id, baseTitle: id, assignee, dependsOn, handoffConditions: [`${id} done`], exclusions: [], limits: [], ...extra });
const draft = (tempId: string, extra: Partial<TaskDraft> = {}): TaskDraft => ({
  tempId, title: `${tempId} 작업`, assignee: "agent", handoffConditions: ["화면이 열림"], dependsOn: [], priority: "normal",
  routing: { executor: "agent", reason: "agent_capable", note: "Agent가 할 수 있는 일" },
  brief: { why: "목표에 필요", sourceMessageIds: ["owner-msg"], decisionIds: ["d1"], attachmentIds: [], constraints: [] }, ...extra,
});
const create = (tempId: string, sources: string[], extra: Partial<TaskDraft> & { parentId?: string } = {}): PlanOp => ({ type: "create_task", ...draft(tempId, extra), ...(extra.parentId ? { parentId: extra.parentId } : {}), sourceMessageIds: sources });
const commit = (emit: Emit, version: number, tasks: TaskSpec[]) =>
  emit("plan_committed", { version, basedOn: version === 1 ? null : version - 1, tasks, reason: "", approvedBy: "owner", sourceMessageIds: [] });
const basePlan = [spec("design", "designer"), spec("build", "agent", ["design"]), spec("research", "agent2")];

describe("applyOps for work items", () => {
  it("creates, splits, cancels and reprioritises without touching other tasks", () => {
    const created = applyOps(basePlan, [create("login", ["owner-msg"], { dependsOn: ["research"] })]);
    expect(created.slice(0, 3)).toEqual(basePlan);
    expect(created[3]).toEqual({ id: "login", title: "login 작업", baseTitle: "login 작업", assignee: "agent", dependsOn: ["research"], handoffConditions: ["화면이 열림"], exclusions: [], limits: [] });
    // Subtasks inherit the parent's dependencies; the parent's own spec stays as it was.
    const split = applyOps(basePlan, [{ type: "split_task", taskId: "build", children: [draft("ui"), draft("api", { dependsOn: ["ui"] })], sourceMessageIds: [] }]);
    expect(split.find((t) => t.id === "build")).toEqual(basePlan[1]);
    expect(split.slice(3).map((t) => [t.id, t.parentId, t.dependsOn])).toEqual([["ui", "build", ["design"]], ["api", "build", ["design", "ui"]]]);
    expect(applyOps(split, [{ type: "cancel_task", taskId: "build", reason: "범위 축소", sourceMessageIds: [] }]).map((t) => t.id)).toEqual(["design", "research"]);
    expect(applyOps(basePlan, [{ type: "set_priority", taskId: "build", priority: "high", sourceMessageIds: [] }])).toEqual(basePlan);
    expect(() => applyOps(basePlan, [create("design", [])])).toThrow(/Duplicate/);
    expect(() => applyOps(basePlan, [create("x", [], { parentId: "nope" })])).toThrow(/Unknown task/);
  });

  it("produces the task_meta_set payloads to write with the commit", () => {
    const ops: PlanOp[] = [create("login", ["owner-msg"], { priority: "high" }), { type: "split_task", taskId: "build", children: [draft("ui")], sourceMessageIds: ["m2"] }, { type: "set_priority", taskId: "research", priority: "low", sourceMessageIds: [] }, { type: "reassign", taskId: "build", assignee: "agent2", sourceMessageIds: [] }];
    const meta = taskMetaFromOps(ops, { planVersion: 2, createdBy: "owner", decisionRequestId: "dr1" });
    expect(meta.map((m) => [m.taskId, m.priority, m.origin])).toEqual([
      ["login", "high", { createdBy: "owner", planVersion: 2, sourceMessageIds: ["owner-msg"], decisionRequestId: "dr1" }],
      ["ui", "normal", { createdBy: "owner", planVersion: 2, sourceMessageIds: ["m2"], decisionRequestId: "dr1", splitFrom: "build" }],
      ["research", "low", undefined],
    ]);
    expect(meta[0]).toMatchObject({ routing: { executor: "agent" }, brief: { decisionIds: ["d1"] } });
  });
});

describe("validating work ops", () => {
  it("(4) refuses to split work that has started or has a result", () => {
    const { events, emit } = ledger(); commit(emit, 1, basePlan);
    const split = (taskId: string): PlanOp => ({ type: "split_task", taskId, children: [draft("part")], sourceMessageIds: [] });
    expect(planOpProblems(project(events), split("research"))).toEqual([]);
    expect(planOpProblems(project(events), split("build"))).toEqual([]);
    emit("task_start_reserved", { taskId: "research", specVersion: 1, trigger: "t" });
    emit("task_started", { taskId: "research" });
    const running = project(events);
    expect(running.tasks.get("research")?.status).toBe("running");
    expect(planOpProblems(running, split("research"))).toEqual([expect.stringMatching(/running/)]);
    expect(planOpProblems(running, create("part", [], { parentId: "research" }))).toEqual([expect.stringMatching(/running/)]);
    // A follow-up task is the way to add work to running work.
    expect(planOpProblems(running, create("follow", [], { dependsOn: ["research"] }))).toEqual([]);
    emit("result_submitted", { taskId: "research", resultId: "r", planVersion: 1, summary: "", artifactIds: [] });
    emit("revision_requested", { taskId: "research", resultId: "r", missing: [] });
    expect(planOpProblems(project(events), split("research"))).toEqual([expect.stringMatching(/revising/)]);
    expect(planOpProblems(project(events), { type: "split_task", taskId: "build", children: [], sourceMessageIds: [] })).toHaveLength(1);
  });

  it("(10) refuses parentId/dependsOn cycles, a third level, and a third reassignment", () => {
    const plan = [...basePlan, spec("ui", "agent", ["design"], { parentId: "build" }), spec("after", "agent2", ["build"])];
    const { events, emit } = ledger(); commit(emit, 1, plan);
    const state = project(events);
    // A subtask waiting on its own parent (or on work that waits on the parent) can never start.
    expect(planOpProblems(state, create("api", [], { parentId: "build", dependsOn: ["build"] }))).toEqual([expect.stringMatching(/cycle/)]);
    expect(planOpProblems(state, create("api", [], { parentId: "build", dependsOn: ["after"] }))).toEqual([expect.stringMatching(/cycle/)]);
    expect(planOpProblems(state, create("api", [], { parentId: "build", dependsOn: ["ui"] }))).toEqual([]);
    expect(planOpProblems(state, create("deep", [], { parentId: "ui" }))).toEqual([expect.stringMatching(/nested 3 deep/)]);
    expect(planStructureProblems([spec("a", "agent", [], { parentId: "b" }), spec("b", "agent", [], { parentId: "a" })])).toEqual(expect.arrayContaining([expect.stringMatching(/Parent cycle/)]));
    expect(planStructureProblems([spec("a", "agent", ["b"]), spec("b", "agent", ["a"])])).toEqual([expect.stringMatching(/Dependency cycle/)]);

    const reassign = (assignee: string): PlanOp => ({ type: "reassign", taskId: "research", assignee, sourceMessageIds: [] });
    const withAssignee = (assignee: string) => plan.map((t) => t.id === "research" ? { ...t, assignee } : t);
    expect(planOpProblems(state, reassign("agent"))).toEqual([]);
    commit(emit, 2, withAssignee("agent"));
    expect(planOpProblems(project(events), reassign("agent2"))).toEqual([]);
    commit(emit, 3, withAssignee("agent2"));
    const looped = project(events);
    expect(looped.tasks.get("research")?.reassignCount).toBe(MAX_REASSIGNS);
    expect(planOpProblems(looped, reassign("agent"))).toEqual([expect.stringMatching(/reassigned 2 times/)]);
    expect(planOpProblems(looped, reassign("agent2"))).toEqual([]);
  });

  it("checks drafted ids, routing and brief, and cancelling work others depend on", () => {
    const { events, emit } = ledger(); commit(emit, 1, basePlan);
    const state = project(events);
    expect(planOpProblems(state, create("design", []))).toEqual([expect.stringMatching(/already used/)]);
    expect(planOpProblems(state, create("x", [], { assignee: "ghost" }))).toEqual([expect.stringMatching(/unknown assignee/)]);
    expect(planOpProblems(state, create("x", [], { assignee: "designer" }))).toEqual([expect.stringMatching(/agent assignee/)]);
    expect(planOpProblems(state, create("x", [], { assignee: "designer", routing: { executor: "human", reason: "needs_human_judgement", note: "" } }))).toEqual([]);
    expect(planOpProblems(state, create("x", [], { priority: "urgent" as never }))).toEqual([expect.stringMatching(/priority/)]);
    expect(planOpProblems(state, create("x", [], { dependsOn: ["nope"] }))).toEqual([expect.stringMatching(/unknown task nope/)]);
    expect(planOpProblems(state, create("x", [], { brief: { why: "", sourceMessageIds: ["nope"], decisionIds: ["proposed"], attachmentIds: [], constraints: [] } })))
      .toEqual([expect.stringMatching(/unknown message nope/), expect.stringMatching(/unconfirmed decision proposed/)]);
    expect(planOpProblems(state, { type: "cancel_task", taskId: "design", reason: "필요 없음", sourceMessageIds: [] })).toEqual([expect.stringMatching(/build depends on unknown task design/)]);
    expect(planOpProblems(state, { type: "cancel_task", taskId: "build", reason: "필요 없음", sourceMessageIds: [] })).toEqual([]);
    expect(planOpProblems(state, { type: "set_priority", taskId: "ghost", priority: "high", sourceMessageIds: [] })).toEqual(["Unknown task ghost"]);
    // A batch sees the tasks its earlier ops drafted.
    expect(planOpsProblems(state, [create("x", []), create("y", [], { dependsOn: ["x"] }), { type: "split_task", taskId: "x", children: [draft("x1")], sourceMessageIds: [] }])).toEqual([]);
    expect(planOpsProblems(state, [create("y", [], { dependsOn: ["x"] })])).toHaveLength(1);
  });
});

describe("authority for work ops (§2.3)", () => {
  it("(5) top-level work needs the decider's own words; subtasks follow the split_task delegation", () => {
    const delegated = project(ledger().events);
    const notDelegated = project(ledger(["reorder"]).events);
    expect(opAuthority(delegated, create("login", ["designer-msg"]))).toEqual({ kind: "scope_add", personId: "owner", allowed: false });
    expect(opAuthority(delegated, create("login", ["owner-msg"]))).toEqual({ kind: "scope_add", personId: "owner", allowed: true });
    // DEFAULT_PM_MAY_APPLY (Q1) includes split_task: the PM splits without asking.
    expect(opAuthority(delegated, create("ui", ["designer-msg"], { parentId: "build" }))).toMatchObject({ kind: "split_task", allowed: true });
    expect(opAuthority(delegated, { type: "split_task", taskId: "build", children: [draft("ui")], sourceMessageIds: [] })).toMatchObject({ kind: "split_task", allowed: true });
    expect(opAuthority(notDelegated, create("ui", ["designer-msg"], { parentId: "build" }))).toEqual({ kind: "split_task", personId: "owner", allowed: false });
    expect(opAuthority(notDelegated, create("ui", ["owner-msg"], { parentId: "build" }))).toEqual({ kind: "split_task", personId: "owner", allowed: true });
  });

  it("work put on a person also needs that person; cancel is scope_reduce, priority is reorder", () => {
    const state = project(ledger().events);
    const forDesigner = (sources: string[]) => create("interview", sources, { assignee: "designer", routing: { executor: "human", reason: "needs_human_access", note: "" } });
    expect(opAuthority(state, forDesigner(["owner-msg"]))).toEqual({ kind: "human_commitment", personId: "designer", allowed: false });
    expect(opAuthority(state, forDesigner(["designer-msg"]))).toEqual({ kind: "scope_add", personId: "owner", allowed: false });
    expect(opAuthority(state, forDesigner(["owner-msg", "designer-msg"]))).toEqual({ kind: "human_commitment", personId: "designer", allowed: true });
    expect(opAuthority(state, { type: "split_task", taskId: "build", children: [draft("ui"), draft("talk", { assignee: "designer" })], sourceMessageIds: [] })).toEqual({ kind: "human_commitment", personId: "designer", allowed: false });
    expect(opAuthority(state, { type: "cancel_task", taskId: "build", reason: "", sourceMessageIds: ["designer-msg"] })).toEqual({ kind: "scope_reduce", personId: "owner", allowed: false });
    expect(opAuthority(state, { type: "set_priority", taskId: "build", priority: "high", sourceMessageIds: [] })).toMatchObject({ kind: "reorder", allowed: true });
    expect(opAuthority(state, { type: "reassign", taskId: "build", assignee: "agent2", sourceMessageIds: [] })).toMatchObject({ kind: "reassign_agent", allowed: true });
  });

  it("Q1 default delegation adds split_task to the existing free-start default", () => {
    expect(DEFAULT_PM_MAY_APPLY).toEqual(["reorder", "split_task", "reassign_agent"]);
  });
});
