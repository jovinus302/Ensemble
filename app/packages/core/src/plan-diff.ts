import type { Id } from "./ledger.ts";
import type { TaskSpec } from "./events.ts";
import type { ProjectState } from "./projection.ts";

export type PlanField = "title" | "baseTitle" | "exclusions" | "limits" | "assignee" | "dependsOn" | "handoffConditions";
export interface ChangedTask { taskId: Id; fields: PlanField[]; prev: TaskSpec; next: TaskSpec }
export interface PlanDiff { added: TaskSpec[]; removed: TaskSpec[]; changed: ChangedTask[]; unchanged: TaskSpec[] }

const FIELDS: PlanField[] = ["title", "baseTitle", "exclusions", "limits", "assignee", "dependsOn", "handoffConditions"];

/** Compare two plan task lists by task id; array fields compare in order, as the projection does. */
export function diffPlans(prev: readonly TaskSpec[] | undefined, next: readonly TaskSpec[]): PlanDiff {
  const before = new Map((prev ?? []).map((spec) => [spec.id, spec]));
  const nextIds = new Set(next.map((spec) => spec.id));
  const diff: PlanDiff = { added: [], removed: (prev ?? []).filter((spec) => !nextIds.has(spec.id)), changed: [], unchanged: [] };
  for (const spec of next) {
    const old = before.get(spec.id);
    if (!old) { diff.added.push(spec); continue; }
    const fields = FIELDS.filter((field) => JSON.stringify(old[field]) !== JSON.stringify(spec[field]));
    if (fields.length === 0) diff.unchanged.push(spec);
    else diff.changed.push({ taskId: spec.id, fields, prev: old, next: spec });
  }
  return diff;
}

/**
 * Assignees touched by the diff: added, removed and changed tasks, with both the previous and new
 * assignee on a reassignment. Assignees of unchanged tasks are not included unless touched elsewhere.
 * Known members come first in join order; unknown ids follow in diff order.
 */
export function affectedMembers(state: Pick<ProjectState, "members">, diff: PlanDiff): Id[] {
  const ids = new Set<Id>();
  for (const spec of diff.added) ids.add(spec.assignee);
  for (const spec of diff.removed) ids.add(spec.assignee);
  for (const change of diff.changed) { ids.add(change.prev.assignee); ids.add(change.next.assignee); }
  const known = [...state.members.keys()].filter((id) => ids.has(id));
  return [...known, ...[...ids].filter((id) => !state.members.has(id))];
}

/** Changed tasks an agent is working on right now: the targets for a mid-turn update. */
export function runningAffected(state: Pick<ProjectState, "activeTurn">, diff: PlanDiff): { agentId: Id; taskId: Id }[] {
  const changed = new Set(diff.changed.map((change) => change.taskId));
  return [...state.activeTurn].filter(([, taskId]) => changed.has(taskId)).map(([agentId, taskId]) => ({ agentId, taskId }));
}
