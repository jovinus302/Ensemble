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
  return forecast({
    now,
    deadline: state.goal?.deadline === undefined ? undefined : new Date(state.goal.deadline),
    tasks,
    weeklyHours: state.availability,
    weeklyOverrides: state.availabilityOverrides,
  });
}
