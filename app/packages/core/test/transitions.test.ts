import { describe, expect, it } from "vitest";
import { checkResult, planStarts, project, requestRevision } from "../src/index.ts";
import type { EventPayloads, EventType, LedgerEvent, NewLedgerEvent, TaskSpec } from "../src/index.ts";
export const ctx = { projectId: "p", targetProductId: "product" };
export const specs: TaskSpec[] = [
  { id: "T1", title: "Research", assignee: "research", dependsOn: [], handoffConditions: [] },
  { id: "T2", title: "Interview", assignee: "user", dependsOn: [], handoffConditions: [] },
  { id: "T3", title: "Design", assignee: "designer", dependsOn: ["T1", "T2"], handoffConditions: [] },
  { id: "T4", title: "Prototype", assignee: "prototype", dependsOn: ["T3"], handoffConditions: [] },
];
export function fixture() {
  const events: LedgerEvent[] = [];
  const append = (event: NewLedgerEvent) => { const seq = events.length + 1; events.push({ ...event, id: `e${seq}`, seq, at: "2026-09-28T00:00:00Z" }); };
  const emit = <K extends EventType>(type: K, payload: EventPayloads[K]) => append({ ...ctx, type, payload, actor: { kind: "human", id: "user" } });
  for (const memberId of ["user", "designer", "research", "prototype"]) emit("member_joined", { memberId, displayName: memberId, kind: ["research", "prototype"].includes(memberId) ? "agent" : "human" });
  emit("goal_set", { text: "Ship prototype", decider: "user", delegation: { pmMayApply: ["reorder", "split_task", "reassign_agent", "scope_reduce"] } });
  const plan = (version: number, tasks = specs) => emit("plan_committed", { version, basedOn: version === 1 ? null : version - 1, tasks, reason: "Agreed plan", approvedBy: "user", sourceMessageIds: [] });
  plan(1);
  const submit = (taskId: string, resultId = `${taskId}-result`, planVersion = 1) => emit("result_submitted", { taskId, resultId, planVersion, summary: "Done", artifactIds: [] });
  const check = (taskId: string, resultId = `${taskId}-result`) => append(checkResult(project(events), taskId, resultId, "Conditions met", ctx));
  return { events, append, emit, plan, submit, check };
}
describe("task transitions", () => {
  it("reserves once, waits for both dependencies, and hands off after revision", () => {
    const f = fixture();
    const initial = project(f.events);
    const starts = planStarts(initial, "plan", ctx);
    expect(starts.map((e) => e.payload)).toEqual([ { taskId: "T1", specVersion: 1, trigger: "plan" }, { taskId: "T2", specVersion: 1, trigger: "plan" } ]);
    expect(planStarts(initial, "plan", ctx)).toEqual(starts); // Pure proposals; persistence provides deduplication.
    starts.forEach(f.append);
    expect(planStarts(project(f.events), "plan", ctx)).toEqual([]);
    f.submit("T1"); f.check("T1");
    expect(project(f.events).tasks.get("T3")?.status).toBe("waiting");
    f.submit("T2"); f.check("T2");
    expect(project(f.events).tasks.get("T3")?.status).toBe("ready");
    planStarts(project(f.events), "checked", ctx).forEach(f.append);
    f.submit("T3");
    f.append(requestRevision(project(f.events), "T3", "T3-result", ["Add flow"], ctx));
    expect(project(f.events).tasks.get("T3")?.status).toBe("revising");
    f.submit("T3", "T3-new"); f.check("T3", "T3-new");
    const next = planStarts(project(f.events), "checked", ctx);
    expect(next).toHaveLength(1);
    expect(next[0]?.idempotencyKey).toBe("start:T4:v1");
    next.forEach(f.append);
    expect(planStarts(project(f.events), "checked", ctx)).toEqual([]);
  });
  it("allows only one active turn per agent, including within a batch", () => {
    const f = fixture();
    f.plan(2, [ { ...specs[0]!, id: "A", assignee: "prototype" }, { ...specs[0]!, id: "B", assignee: "prototype" } ]);
    const starts = planStarts(project(f.events), "go", ctx);
    expect(starts).toHaveLength(1);
    starts.forEach(f.append);
    f.emit("turn_finished", { agentId: "prototype", taskId: "B" });
    expect(planStarts(project(f.events), "go", ctx)).toEqual([]);
    f.emit("turn_finished", { agentId: "prototype", taskId: "A" });
    expect(planStarts(project(f.events), "go", ctx)[0]?.idempotencyKey).toBe("start:B:v2");
  });
  it("rejects stale, unknown, and non-submitted results", () => {
    const f = fixture();
    expect(() => f.check("T1")).toThrow(/submitted/);
    f.submit("T1"); f.check("T1"); f.submit("T4");
    f.plan(2, specs.map((s) => s.id === "T4" ? { ...s, handoffConditions: ["No payments"] } : s));
    const state = project(f.events);
    expect(state.tasks.get("T1")).toMatchObject({ status: "checked", specVersion: 1 });
    expect(state.tasks.get("T4")?.specVersion).toBe(2);
    expect(() => f.check("T4")).toThrow(/Stale/);
    expect(() => checkResult(state, "T4", "absent", "ok", ctx)).toThrow(/Unknown result/);
    expect(() => checkResult(state, "absent", "r", "ok", ctx)).toThrow(/Unknown task/);
    f.submit("T4", "fresh", 2); f.check("T4", "fresh");
    expect(project(f.events).tasks.get("T4")?.status).toBe("checked");
  });
});
