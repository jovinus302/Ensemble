import { describe, expect, it } from "vitest";
import { checkResult, handoffBlockers, pendingUpdates, planStarts, project } from "../src/index.ts";
import type { EventPayloads, EventType, LedgerEvent, NewLedgerEvent, TaskSpec } from "../src/index.ts";

const ctx = { projectId: "p", targetProductId: "product" };
const specs: TaskSpec[] = [ { id: "T1", title: "Research", assignee: "research", dependsOn: [], handoffConditions: [] } ];
function fixture() {
  const events: LedgerEvent[] = [];
  const append = (event: NewLedgerEvent) => { const seq = events.length + 1; events.push({ ...event, id: `e${seq}`, seq, at: "2026-09-28T00:00:00Z" }); };
  const emit = <K extends EventType>(type: K, payload: EventPayloads[K]) => append({ ...ctx, type, payload, actor: { kind: "human", id: "user" } });
  for (const memberId of ["user", "research", "prototype"]) emit("member_joined", { memberId, displayName: memberId, kind: memberId === "user" ? "human" : "agent" });
  const plan = (version: number, tasks = specs) => emit("plan_committed", { version, basedOn: version === 1 ? null : version - 1, tasks, reason: "Agreed plan", approvedBy: "user", sourceMessageIds: [] });
  plan(1);
  const submit = (taskId: string, resultId = `${taskId}-result`, planVersion = 1) => emit("result_submitted", { taskId, resultId, planVersion, summary: "Done", artifactIds: [] });
  const check = (taskId: string, resultId = `${taskId}-result`) => append(checkResult(project(events), taskId, resultId, "Conditions met", ctx));
  return { events, append, emit, plan, submit, check };
}

describe("sessions and plan updates", () => {
  it("projects the latest session per agent and releases the turn on observed completion", () => {
    const f = fixture();
    f.emit("session_linked", { agentId: "research", threadId: "th-1", workspace: "ws-a" });
    f.emit("session_linked", { agentId: "research", threadId: "th-2", workspace: "ws-b" });
    expect(project(f.events).sessions.get("research")).toEqual({ threadId: "th-2", workspace: "ws-b" });
    f.plan(2, [ { ...specs[0]!, id: "A", assignee: "prototype" }, { ...specs[0]!, id: "B", assignee: "prototype" } ]);
    planStarts(project(f.events), "go", ctx).forEach(f.append);
    f.emit("turn_observed", { agentId: "prototype", taskId: "A", turnId: "t1", status: "started" });
    expect(project(f.events).activeTurn.get("prototype")).toBe("A");
    f.emit("turn_observed", { agentId: "prototype", taskId: "B", turnId: "t1", status: "completed" });
    expect(project(f.events).activeTurn.get("prototype")).toBe("A");
    f.emit("turn_observed", { agentId: "prototype", taskId: "A", turnId: "t1", status: "completed" });
    expect(project(f.events).activeTurn.has("prototype")).toBe(false);
    expect(planStarts(project(f.events), "go", ctx)[0]?.idempotencyKey).toBe("start:B:v2");
  });

  it("refuses results until the update is acknowledged, then only results on the acknowledged version", () => {
    const f = fixture();
    f.emit("update_sent", { updateId: "u1", taskId: "T1", fromVersion: 1, toVersion: 2 });
    f.plan(2); // Same specs: T1 keeps specVersion 1, so only the update rule applies.
    f.submit("T1", "old", 1);
    let state = project(f.events);
    expect(pendingUpdates(state.tasks.get("T1")!).map((u) => u.status)).toEqual(["sent"]);
    expect(handoffBlockers(state, "T1", "old")).toHaveLength(1);
    expect(() => f.check("T1", "old")).toThrow(/not yet acknowledged/);

    f.emit("update_acknowledged", { updateId: "u1", taskId: "T1", planVersion: 2, applied: ["scope"], dropped: ["extra"] });
    state = project(f.events);
    expect(state.tasks.get("T1")?.updates).toEqual([{ updateId: "u1", toVersion: 2, status: "acknowledged", droppedItems: ["extra"] }]);
    expect(pendingUpdates(state.tasks.get("T1")!)).toEqual([]);
    expect(() => f.check("T1", "old")).toThrow(/before acknowledged v2/);

    f.submit("T1", "new", 2);
    expect(handoffBlockers(project(f.events), "T1", "new")).toEqual([]);
    f.check("T1", "new");
    expect(project(f.events).tasks.get("T1")?.status).toBe("checked");
  });

  it("keeps refusing while the acknowledgement is rejected", () => {
    const f = fixture();
    f.emit("update_sent", { updateId: "u1", taskId: "T1", fromVersion: 1, toVersion: 2 });
    f.plan(2);
    f.emit("update_rejected", { updateId: "u1", taskId: "T1", reasons: ["missing applied items"] });
    f.submit("T1", "r", 2);
    const state = project(f.events);
    expect(pendingUpdates(state.tasks.get("T1")!).map((u) => u.status)).toEqual(["rejected"]);
    expect(handoffBlockers(state, "T1", "r")[0]).toMatch(/rejected/);
    expect(() => f.check("T1", "r")).toThrow(/rejected/);
  });

  it("reports existing handoff rules as blockers without throwing", () => {
    const f = fixture();
    expect(handoffBlockers(project(f.events), "T1", "x")[0]).toMatch(/submitted/);
    expect(handoffBlockers(project(f.events), "nope", "x")[0]).toMatch(/Unknown task/);
    f.emit("reply_recorded", { memberId: "research", taskId: "T1", text: "On it" });
    f.submit("T1");
    expect(handoffBlockers(project(f.events), "T1", "T1-result")).toEqual([]);
  });
});
