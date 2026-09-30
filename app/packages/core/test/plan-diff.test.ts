import { expect, it } from "vitest";
import { affectedMembers, diffPlans, project, runningAffected } from "../src/index.ts";
import type { EventPayloads, EventType, LedgerEvent, TaskSpec } from "../src/index.ts";

const spec = (id: string, assignee: string, extra: Partial<TaskSpec> = {}): TaskSpec => ({ id, title: id, assignee, dependsOn: [], handoffConditions: [], ...extra });

it("diffs added, removed, per-field changed and unchanged tasks", () => {
  const prev = [spec("A", "a"), spec("B", "b"), spec("C", "c"), spec("D", "d")];
  const next = [spec("A", "a"), spec("B", "x", { title: "B2" }), spec("C", "c", { dependsOn: ["A"], handoffConditions: ["tests"] }), spec("E", "e")];
  const diff = diffPlans(prev, next);
  expect(diff.added.map((s) => s.id)).toEqual(["E"]);
  expect(diff.removed.map((s) => s.id)).toEqual(["D"]);
  expect(diff.unchanged.map((s) => s.id)).toEqual(["A"]);
  expect(diff.changed.map(({ taskId, fields }) => ({ taskId, fields }))).toEqual([
    { taskId: "B", fields: ["title", "assignee"] },
    { taskId: "C", fields: ["dependsOn", "handoffConditions"] },
  ]);
  expect(diffPlans(undefined, next).added).toHaveLength(4);
  expect(diffPlans(next, structuredClone(next))).toMatchObject({ added: [], removed: [], changed: [] });
});

it("lists affected members without the assignees of unchanged tasks", () => {
  const diff = diffPlans([spec("A", "a"), spec("B", "b"), spec("D", "d")], [spec("A", "a"), spec("B", "x"), spec("E", "e")]);
  const members = new Map(["e", "x", "a", "b"].map((id) => [id, { memberId: id, kind: "agent" as const, displayName: id }]));
  expect(affectedMembers({ members }, diff)).toEqual(["e", "x", "b", "d"]);
});

it("returns only changed tasks with an active agent turn", () => {
  const events: LedgerEvent[] = [];
  const emit = <K extends EventType>(type: K, payload: EventPayloads[K]) => events.push({ id: `${events.length}`, seq: events.length + 1, at: "fixed", projectId: "p", targetProductId: "p", actor: { kind: "pm", id: "pm" }, type, payload });
  for (const id of ["a", "b"]) emit("member_joined", { memberId: id, kind: "agent", displayName: id });
  const v1 = [spec("A", "a"), spec("B", "b")];
  emit("plan_committed", { version: 1, basedOn: null, tasks: v1, reason: "start", approvedBy: "u", sourceMessageIds: [] });
  emit("task_start_reserved", { taskId: "A", specVersion: 1, trigger: "t" });
  const state = project(events);
  expect(state.activeTurn.get("a")).toBe("A");
  const changedBoth = diffPlans(v1, [spec("A", "a", { title: "A2" }), spec("B", "b", { title: "B2" })]);
  expect(runningAffected(state, changedBoth)).toEqual([{ agentId: "a", taskId: "A" }]);
  expect(runningAffected(state, diffPlans(v1, [spec("A", "a"), spec("B", "b", { title: "B2" })]))).toEqual([]);
});
