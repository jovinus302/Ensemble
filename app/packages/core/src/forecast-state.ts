import { forecast } from "./forecast.ts";
import type { ForecastResult, ForecastTask } from "./forecast.ts";
import type { ProjectState } from "./projection.ts";

/** Adapt the current plan without changing forecast scheduling policy. */
export function forecastFromState(state: ProjectState, now: Date): ForecastResult {
  const tasks: ForecastTask[] = [];
  for (const spec of state.plan?.tasks ?? []) {
    const task = state.tasks.get(spec.id);
    if (task?.status === "cancelled") continue;
    const member = state.members.get(spec.assignee);
    if (!member) throw new Error(`Unknown assignee ${spec.assignee} for task ${spec.id}`);
    const estimate = state.estimates.get(spec.id);
    tasks.push({
      id: spec.id,
      assignee: spec.assignee,
      assigneeKind: member.kind,
      dependsOn: [...spec.dependsOn],
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
