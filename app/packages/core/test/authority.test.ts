import { expect, it } from "vitest";
import { whoApproves } from "../src/index.ts";
import type { EventPayloads, ChangeKind } from "../src/index.ts";
const goal: EventPayloads["goal_set"] = { text: "Ship", decider: "user", delegation: { pmMayApply: ["reorder", "split_task", "reassign_agent", "scope_reduce", "goal_change", "deadline_change", "human_commitment"] } };
it.each<ChangeKind>(["reorder", "split_task", "reassign_agent", "scope_reduce"])("delegates %s to PM", (kind) => expect(whoApproves({ kind }, goal)).toEqual({ by: "pm" }));
it.each<ChangeKind>(["goal_change", "deadline_change", "scope_add"])("requires decider for %s", (kind) => expect(whoApproves({ kind }, goal)).toMatchObject({ by: "person", personId: "user" }));
it("requires the affected person for a human commitment, even with delegation", () => {
  expect(whoApproves({ kind: "human_commitment", affectedPerson: "designer" }, goal)).toMatchObject({ by: "person", personId: "designer" });
  expect(() => whoApproves({ kind: "human_commitment" }, goal)).toThrow(/affectedPerson/);
  expect(() => whoApproves({ kind: "reorder" }, undefined)).toThrow(/goal/);
});
