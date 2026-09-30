// Deadline forecast: a pure calculation over its own input shape. Converting
// project state into ForecastInput belongs to the caller.

export interface ForecastTask {
  id: string;
  assignee: string;
  assigneeKind: "human" | "agent";
  dependsOn: string[];
  done: boolean;
  hours?: { min: number; max: number };
}

export interface ForecastInput {
  now: Date;
  deadline?: Date;
  tasks: ForecastTask[];
  /** Weekly working hours per human member. Agents are not listed here. */
  weeklyHours: ReadonlyMap<string, number>;
  weeklyOverrides?: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

export interface ScheduledSpan {
  startDay: number;
  endDay: number;
}

export interface TaskForecast {
  taskId: string;
  min: ScheduledSpan;
  max: ScheduledSpan;
}

export interface MemberShortage {
  memberId: string;
  hours: number;
}

export type ForecastFailureKind =
  | "missing_estimate"
  | "missing_availability"
  | "zero_availability"
  | "cycle"
  | "unknown_dependency";

export interface ForecastFailure {
  kind: ForecastFailureKind;
  taskId?: string;
  memberId?: string;
}

export interface ForecastSuccess {
  ok: true;
  tasks: TaskForecast[];
  end: { min: Date; max: Date };
  days: { min: number; max: number };
  /** Present only when a deadline is given. Both values are 0 or more. */
  lateness?: { minDays: number; maxDays: number };
  /** Humans whose needed hours exceed their available hours before the deadline. */
  shortages: MemberShortage[];
  assumptions: string[];
}

export interface ForecastFailed {
  ok: false;
  reasons: ForecastFailure[];
}

export type ForecastResult = (ForecastSuccess | ForecastFailed) & {
  uncertainty?: { stoppedTaskIds: string[]; warning: string };
};

const DAY_MS = 24 * 60 * 60 * 1000;
const AGENT_HOURS_PER_DAY = 24;

const ASSUMPTIONS: readonly string[] = [
  "사람의 하루 작업 시간은 주간 시간을 7일에 균등하게 나눈 값이다.",
  "Agent는 경과 시간 기준 하루 24시간 일하고, 한 번에 한 작업만 한다.",
  "완료된 작업은 시간을 쓰지 않는다.",
  "같은 담당자의 시간은 겹쳐 쓰지 않는다.",
  "선후 관계 순서대로 앞에서부터 채운 일정이며, 최적 일정이라고 보장하지 않는다.",
];

type Scenario = "min" | "max";

export function forecast(input: ForecastInput): ForecastResult {
  const { tasks } = input;
  const reasons = validate(input);

  const order = topologicalOrder(tasks);
  for (const taskId of order.cyclic) reasons.push({ kind: "cycle", taskId });

  if (reasons.length > 0) return { ok: false, reasons };

  const min = schedule(input, order.sorted, "min");
  const max = schedule(input, order.sorted, "max");

  const minDays = latestEnd(min);
  const maxDays = latestEnd(max);
  const result: ForecastSuccess = {
    ok: true,
    tasks: tasks.map((task) => ({
      taskId: task.id,
      min: spanOf(min, task.id),
      max: spanOf(max, task.id),
    })),
    end: { min: addDays(input.now, minDays), max: addDays(input.now, maxDays) },
    days: { min: minDays, max: maxDays },
    shortages: [],
    assumptions: [...ASSUMPTIONS],
  };

  if (input.deadline !== undefined) {
    const deadlineDays = (input.deadline.getTime() - input.now.getTime()) / DAY_MS;
    result.lateness = {
      minDays: Math.max(0, minDays - deadlineDays),
      maxDays: Math.max(0, maxDays - deadlineDays),
    };
    result.shortages = shortages(input, max, deadlineDays);
  }

  return result;
}

function validate(input: ForecastInput): ForecastFailure[] {
  const reasons: ForecastFailure[] = [];
  const ids = new Set(input.tasks.map((task) => task.id));
  const checkedMembers = new Set<string>();

  for (const task of input.tasks) {
    for (const dependency of task.dependsOn) {
      if (!ids.has(dependency)) reasons.push({ kind: "unknown_dependency", taskId: task.id });
    }
    if (task.done) continue;
    if (task.hours === undefined) reasons.push({ kind: "missing_estimate", taskId: task.id });
    if (task.assigneeKind !== "human" || checkedMembers.has(task.assignee)) continue;
    checkedMembers.add(task.assignee);
    const weekly = input.weeklyHours.get(task.assignee);
    if (weekly === undefined) {
      reasons.push({ kind: "missing_availability", memberId: task.assignee });
    } else if (weekly <= 0) {
      reasons.push({ kind: "zero_availability", memberId: task.assignee });
    }
  }
  return reasons;
}

/**
 * Kahn's algorithm, breaking ties by input order. Unknown dependencies are
 * ignored here (validate reports them). Tasks that cannot be ordered are
 * trimmed down to the ones on or between cycles, dropping pure downstream tasks.
 */
function topologicalOrder(tasks: ForecastTask[]): { sorted: ForecastTask[]; cyclic: string[] } {
  const ids = new Set(tasks.map((task) => task.id));
  const remainingDeps = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    const known = task.dependsOn.filter((dependency) => ids.has(dependency));
    remainingDeps.set(task.id, known.length);
    for (const dependency of known) {
      const list = dependents.get(dependency) ?? [];
      list.push(task.id);
      dependents.set(dependency, list);
    }
  }

  const sorted: ForecastTask[] = [];
  const placed = new Set<string>();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const task of tasks) {
      if (placed.has(task.id) || remainingDeps.get(task.id) !== 0) continue;
      placed.add(task.id);
      sorted.push(task);
      for (const dependent of dependents.get(task.id) ?? []) {
        remainingDeps.set(dependent, (remainingDeps.get(dependent) ?? 0) - 1);
      }
      progressed = true;
      break; // restart so the earliest ready task in input order goes next
    }
  }

  const leftover = new Set(tasks.filter((task) => !placed.has(task.id)).map((task) => task.id));
  let trimmed = true;
  while (trimmed) {
    trimmed = false;
    for (const id of leftover) {
      const feedsLeftover = (dependents.get(id) ?? []).some((dependent) => leftover.has(dependent));
      if (!feedsLeftover) {
        leftover.delete(id);
        trimmed = true;
      }
    }
  }

  return { sorted, cyclic: tasks.filter((task) => leftover.has(task.id)).map((task) => task.id) };
}

function hoursPerDay(input: ForecastInput, task: ForecastTask): number {
  if (task.assigneeKind === "agent") return AGENT_HOURS_PER_DAY;
  // validate guarantees a positive value for every undone human task
  return (input.weeklyHours.get(task.assignee) ?? 0) / 7;
}

function durationDays(input: ForecastInput, task: ForecastTask, scenario: Scenario, startDay = 0): number {
  if (task.done || task.hours === undefined) return 0;
  const hours = task.hours[scenario];
  if (task.assigneeKind === "agent") return hours / AGENT_HOURS_PER_DAY;
  const overrides = input.weeklyOverrides?.get(task.assignee);
  if (overrides?.size) {
    let remaining = hours, day = startDay;
    for (const segment of capacitySegments(input, task.assignee, startDay, Infinity)) {
      const available = (segment.end - day) * segment.rate;
      if (segment.rate > 0 && available >= remaining) return day - startDay + remaining / segment.rate;
      remaining -= available; day = segment.end;
    }
  }
  // hours * 7 / weekly keeps whole-number results exact
  return (hours * 7) / (input.weeklyHours.get(task.assignee) ?? 0);
}

function resourceKey(task: ForecastTask): string {
  return `${task.assigneeKind}:${task.assignee}`;
}

function schedule(
  input: ForecastInput,
  sorted: ForecastTask[],
  scenario: Scenario,
): Map<string, ScheduledSpan> {
  const spans = new Map<string, ScheduledSpan>();
  const nextFree = new Map<string, number>();

  for (const task of sorted) {
    if (task.done) {
      spans.set(task.id, { startDay: 0, endDay: 0 });
      continue;
    }
    const dependenciesEnd = Math.max(
      0,
      ...task.dependsOn.map((dependency) => spans.get(dependency)?.endDay ?? 0),
    );
    const key = resourceKey(task);
    const startDay = Math.max(dependenciesEnd, nextFree.get(key) ?? 0);
    const endDay = startDay + durationDays(input, task, scenario, startDay);
    spans.set(task.id, { startDay, endDay });
    nextFree.set(key, endDay);
  }
  return spans;
}

function shortages(
  input: ForecastInput,
  maxSpans: Map<string, ScheduledSpan>,
  deadlineDays: number,
): MemberShortage[] {
  const perMember = new Map<string, { needed: number; firstStart: number; perDay: number }>();
  for (const task of input.tasks) {
    if (task.done || task.assigneeKind !== "human" || task.hours === undefined) continue;
    const startDay = spanOf(maxSpans, task.id).startDay;
    const entry = perMember.get(task.assignee);
    if (entry === undefined) {
      perMember.set(task.assignee, {
        needed: task.hours.max,
        firstStart: startDay,
        perDay: hoursPerDay(input, task),
      });
    } else {
      entry.needed += task.hours.max;
      entry.firstStart = Math.min(entry.firstStart, startDay);
    }
  }

  const result: MemberShortage[] = [];
  for (const [memberId, entry] of perMember) {
    const available = capacitySegments(input, memberId, entry.firstStart, Math.max(entry.firstStart, deadlineDays)).reduce((sum, s) => sum + (s.end - s.start) * s.rate, 0);
    const hours = entry.needed - available;
    if (hours > 0) result.push({ memberId, hours });
  }
  return result;
}

function spanOf(spans: Map<string, ScheduledSpan>, taskId: string): ScheduledSpan {
  return spans.get(taskId) ?? { startDay: 0, endDay: 0 };
}

function latestEnd(spans: Map<string, ScheduledSpan>): number {
  let end = 0;
  for (const span of spans.values()) end = Math.max(end, span.endDay);
  return end;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** ISO weeks start Monday at midnight in the project's Korean time zone. */
export function availabilityWeek(now: Date): string {
  const local = new Date(now.getTime() + 9 * 3600000);
  local.setUTCDate(local.getUTCDate() - (local.getUTCDay() + 6) % 7);
  return local.toISOString().slice(0, 10);
}
function capacitySegments(input: ForecastInput, member: string, start: number, end: number) {
  const windows = [...(input.weeklyOverrides?.get(member) ?? [])].map(([week, hours]) => ({ start: (Date.parse(`${week}T00:00:00+09:00`) - input.now.getTime()) / DAY_MS, hours })).sort((a,b) => a.start - b.start);
  const boundaries = [...new Set([start, ...windows.flatMap(w => [w.start, w.start + 7]).filter(d => d > start && d < end), end])].sort((a,b) => a-b);
  return boundaries.slice(0,-1).map((point,i) => ({ start: point, end: boundaries[i+1]!, rate: (windows.find(w => point >= w.start && point < w.start+7)?.hours ?? input.weeklyHours.get(member) ?? 0) / 7 }));
}
