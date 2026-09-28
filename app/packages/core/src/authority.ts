import type { Id } from "./ledger.ts";
import type { ChangeKind, EventPayloads } from "./events.ts";
export function whoApproves(change: { kind: ChangeKind; affectedPerson?: Id }, goal: EventPayloads["goal_set"] | undefined): { by: "pm" } | { by: "person"; personId: Id; reason: string } {
  if (!goal) throw new Error("A goal is required to determine approval authority");
  if (change.kind === "human_commitment") {
    if (!change.affectedPerson) throw new Error("human_commitment requires affectedPerson");
    return { by: "person", personId: change.affectedPerson, reason: "People approve their own commitments" };
  }
  if (change.kind === "goal_change" || change.kind === "deadline_change") return { by: "person", personId: goal.decider, reason: "Goal and deadline changes require the decider" };
  if (goal.delegation.pmMayApply.includes(change.kind)) return { by: "pm" };
  return { by: "person", personId: goal.decider, reason: "Change is outside PM delegation" };
}
