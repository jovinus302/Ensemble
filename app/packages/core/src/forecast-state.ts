import { forecast } from "./forecast.ts";
import type { ForecastResult, ForecastTask } from "./forecast.ts";
import type { ProjectState } from "./projection.ts";
import type { TaskSpec } from "./events.ts";

/**
 * Adapt the current plan without changing forecast scheduling policy. Parents (work with a live
 * subtask) never run, so they are left out and a dependency on a parent becomes a dependency on its
 * subtasks. Like the projection, a subtask waits only for its own `dependsOn` (`applyOps` copies the
 * parent's into it). Parenthood is read from the plan so candidate plans forecast the same way.
 */
export function forecastFromState(state: ProjectState, now: Date): ForecastResult {
  const tasks: ForecastTask[] = [];
  const specs = (state.plan?.tasks ?? []).filter((spec) => state.tasks.get(spec.id)?.status !== "cancelled");
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  const children = new Map<string, string[]>();
  for (const spec of specs) if (spec.parentId !== undefined && byId.has(spec.parentId)) children.set(spec.parentId, [...(children.get(spec.parentId) ?? []), spec.id]);
  const runnable = (id: string, seen = new Set<string>()): string[] => {
    if (seen.has(id)) return [];
    seen.add(id);
    const kids = children.get(id);
    return kids ? kids.flatMap((kid) => runnable(kid, seen)) : [id];
  };
  const waitsFor = (spec: TaskSpec): string[] => [...new Set(spec.dependsOn.flatMap((id) => byId.has(id) ? runnable(id) : [id]))];
  for (const spec of specs) {
    if (children.has(spec.id)) continue;
    const task = state.tasks.get(spec.id);
    const member = state.members.get(spec.assignee);
    if (!member) throw new Error(`Unknown assignee ${spec.assignee} for task ${spec.id}`);
    const estimate = state.estimates.get(spec.id);
    tasks.push({
      id: spec.id,
      assignee: spec.assignee,
      assigneeKind: member.kind,
      dependsOn: waitsFor(spec),
      done: task?.status === "checked" && JSON.stringify(task.spec) === JSON.stringify(spec),
      hours: estimate === undefined ? undefined : { min: estimate.min, max: estimate.max },
    });
  }
  const result = forecast({
    now,
    deadline: state.goal?.deadline === undefined ? undefined : new Date(state.goal.deadline),
    tasks,
    weeklyHours: state.availability,
    weeklyOverrides: state.availabilityOverrides,
  });
  const stoppedTaskIds = (state.plan?.tasks ?? []).filter(spec => {
    const task = state.tasks.get(spec.id);
    if (children.has(spec.id)) return false;
    return task?.status === 'blocked' || (task?.status === 'submitted' && !!task.reviewFailedResultId && task.reviewFailedResultId === task.results.at(-1)?.resultId);
  }).map(spec => spec.id);
  return withStopped(result, stoppedTaskIds);
}

/** A task a person is resolving right now (accept/retry/recheck) no longer makes the date uncertain. */
export function withoutStopped(result: ForecastResult, resolvedTaskIds: Iterable<string>): ForecastResult {
  if (!result.uncertainty) return result;
  const resolved = new Set(resolvedTaskIds);
  const { uncertainty, ...rest } = result;
  return withStopped(rest, uncertainty.stoppedTaskIds.filter(id => !resolved.has(id)));
}

function withStopped(result: ForecastResult, stoppedTaskIds: string[]): ForecastResult {
  return stoppedTaskIds.length ? { ...result, uncertainty: { stoppedTaskIds, warning: `멈춘 작업 ${stoppedTaskIds.length}개 — 날짜 불확실` } } : result;
}
