import { describe, expect, it } from "vitest";
import { checkResult, planStarts, project } from "@ensemble/core";
import type { EventPayloads, EventType, NewLedgerEvent, TaskSpec } from "@ensemble/core";
import { MemoryLedgerStore, SqliteLedgerStore } from "../src/index.ts";
import type { LedgerStore } from "../src/index.ts";

const ctx = { projectId: "project", targetProductId: "product" };
const event = <K extends EventType>(type: K, payload: EventPayloads[K]): NewLedgerEvent => ({ ...ctx, type, payload, actor: { kind: "human", id: "user" } });
const tasks: TaskSpec[] = [
  { id: "T1", title: "Research", assignee: "research", dependsOn: [], handoffConditions: [] },
  { id: "T2", title: "Interview", assignee: "user", dependsOn: [], handoffConditions: [] },
  { id: "T3", title: "Design", assignee: "designer", dependsOn: ["T1", "T2"], handoffConditions: [] },
  { id: "T4", title: "Prototype", assignee: "prototype", dependsOn: ["T3"], handoffConditions: [] },
];
const stores: [string, () => LedgerStore][] = [
  ["memory", () => new MemoryLedgerStore()],
  ["SQLite", () => new SqliteLedgerStore(":memory:")],
];
describe.each(stores)("%s dispatch integration", (_name, createStore) => {
  it("serializes concurrent starts and rejects results predating a changed specification", async () => {
    const store = createStore();
    try {
      await store.append([
        ...["user", "designer", "research", "prototype"].map((memberId) => event("member_joined", { memberId, displayName: memberId, kind: memberId === "user" || memberId === "designer" ? "human" : "agent" })),
        event("goal_set", { text: "Ship prototype", decider: "user", delegation: { pmMayApply: ["reorder", "split_task", "reassign_agent", "scope_reduce"] } }),
        event("plan_committed", { version: 1, basedOn: null, tasks, reason: "Initial plan", approvedBy: "user", sourceMessageIds: [] }),
      ]);
      const dispatch = (trigger: string) => store.transaction(ctx.projectId, (events) => ({ append: planStarts(project(events), trigger, ctx), result: null }));
      const first = await Promise.all([dispatch("same-trigger"), dispatch("same-trigger")]);
      expect(first.map((result) => result.appended.length).sort()).toEqual([0, 2]);
      const initial = await store.read({ projectId: ctx.projectId });
      expect(initial.filter((e) => e.type === "task_start_reserved").map((e) => e.idempotencyKey).sort()).toEqual(["start:T1:v1", "start:T2:v1"]);
      const submit = (taskId: string, resultId = `${taskId}-result`) => store.append([event("result_submitted", { taskId, resultId, planVersion: 1, summary: "Done", artifactIds: [] })]);
      const check = (taskId: string) => store.transaction(ctx.projectId, (events) => ({ append: [checkResult(project(events), taskId, `${taskId}-result`, "Conditions met", ctx)], result: null }));
      await submit("T1"); await check("T1");
      expect(project(await store.read()).tasks.get("T3")?.status).toBe("waiting");
      await submit("T2"); await check("T2");
      await dispatch("dependencies-checked");
      await submit("T3"); await check("T3");
      const handoffs = await Promise.all([dispatch("checked-trigger-one"), dispatch("checked-trigger-two")]);
      expect(handoffs.map((result) => result.appended.length).sort()).toEqual([0, 1]);
      expect((await store.read()).filter((e) => e.idempotencyKey === "start:T4:v1")).toHaveLength(1);
      await store.append([event("plan_committed", { version: 2, basedOn: 1, tasks: tasks.map((task) => task.id === "T4" ? { ...task, handoffConditions: ["Exclude payments"] } : task), reason: "Scope changed", approvedBy: "user", sourceMessageIds: [] })]);
      await submit("T4");
      const before = await store.read();
      await expect(check("T4")).rejects.toThrow(/Stale result/);
      expect(await store.read()).toEqual(before);
      expect(project(before).tasks.get("T4")).toMatchObject({ status: "submitted", specVersion: 2 });
      expect(project(before).tasks.get("T1")).toMatchObject({ status: "checked", specVersion: 1 });
    } finally {
      store.close();
    }
  });
});
