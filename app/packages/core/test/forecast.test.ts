import { describe, expect, it } from "vitest";
import { forecast } from "../src/forecast.ts";
import type { ForecastInput, ForecastResult, ForecastSuccess, ForecastTask } from "../src/forecast.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-01T00:00:00Z");

function task(id: string, overrides: Partial<ForecastTask> = {}): ForecastTask {
  return {
    id,
    assignee: "designer",
    assigneeKind: "human",
    dependsOn: [],
    done: false,
    hours: { min: 7, max: 7 },
    ...overrides,
  };
}

function input(tasks: ForecastTask[], weekly: Record<string, number>, deadline?: Date): ForecastInput {
  return { now, deadline, tasks, weeklyHours: new Map(Object.entries(weekly)) };
}

function success(result: ForecastResult): ForecastSuccess {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.reasons)}`);
  return result;
}

function spanOf(result: ForecastSuccess, taskId: string) {
  const found = result.tasks.find((t) => t.taskId === taskId);
  if (found === undefined) throw new Error(`no forecast for ${taskId}`);
  return found;
}

describe("forecast", () => {
  it("halving weekly hours moves a 20h task end from day 14 to day 28", () => {
    const tasks = [task("T1", { hours: { min: 20, max: 20 } })];

    const at10 = success(forecast(input(tasks, { designer: 10 })));
    const at5 = success(forecast(input(tasks, { designer: 5 })));

    expect(at10.days.max).toBe(14);
    expect(at5.days.max).toBe(28);
    expect(at5.end.max.getTime()).toBe(now.getTime() + 28 * DAY_MS);
  });

  it.each([
    ["missing estimate", [task("T1", { hours: undefined })], { designer: 7 }, { kind: "missing_estimate", taskId: "T1" }],
    ["missing availability", [task("T1")], {}, { kind: "missing_availability", memberId: "designer" }],
    ["zero availability", [task("T1")], { designer: 0 }, { kind: "zero_availability", memberId: "designer" }],
    ["unknown dependency", [task("T1", { dependsOn: ["ghost"] })], { designer: 7 }, { kind: "unknown_dependency", taskId: "T1" }],
  ] as const)("fails without dates on %s", (_name, tasks, weekly, reason) => {
    const result = forecast(input([...tasks], weekly));

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("end");
    if (!result.ok) expect(result.reasons).toEqual([reason]);
  });

  it("fails on a dependency cycle and names only the tasks on it", () => {
    const result = forecast(
      input(
        [task("T1", { dependsOn: ["T2"] }), task("T2", { dependsOn: ["T1"] }), task("T3", { dependsOn: ["T1"] })],
        { designer: 7 },
      ),
    );

    expect(result).toEqual({
      ok: false,
      reasons: [
        { kind: "cycle", taskId: "T1" },
        { kind: "cycle", taskId: "T2" },
      ],
    });
  });

  it("does not double-book one person across independent tasks", () => {
    const result = success(forecast(input([task("T1"), task("T2")], { designer: 7 })));

    expect(spanOf(result, "T1").max).toEqual({ startDay: 0, endDay: 7 });
    expect(spanOf(result, "T2").max).toEqual({ startDay: 7, endDay: 14 });
  });

  it("starts a task only after all its dependencies finish", () => {
    const result = success(
      forecast(
        input(
          [
            task("T3", { assignee: "dev", dependsOn: ["T1", "T2"] }),
            task("T1", { hours: { min: 7, max: 7 } }),
            task("T2", { assignee: "coder", assigneeKind: "agent", hours: { min: 48, max: 48 } }),
          ],
          { designer: 7, dev: 7 },
        ),
      ),
    );

    expect(spanOf(result, "T1").max.endDay).toBe(7);
    expect(spanOf(result, "T2").max.endDay).toBe(2);
    expect(spanOf(result, "T3").max).toEqual({ startDay: 7, endDay: 14 });
  });

  it("reports an end range, lateness and shortage when the deadline is exceeded", () => {
    const deadline = new Date(now.getTime() + 14 * DAY_MS);
    const result = success(
      forecast(input([task("T1", { hours: { min: 10, max: 20 } })], { designer: 7 }, deadline)),
    );

    expect(result.days).toEqual({ min: 10, max: 20 });
    expect(result.end.min.getTime()).toBeLessThan(result.end.max.getTime());
    expect(result.lateness).toEqual({ minDays: 0, maxDays: 6 });
    expect(result.shortages).toEqual([{ memberId: "designer", hours: 6 }]);
    expect(result.assumptions.length).toBeGreaterThan(0);
  });

  it("reports no lateness or shortage when the plan fits the deadline", () => {
    const deadline = new Date(now.getTime() + 30 * DAY_MS);
    const result = success(forecast(input([task("T1")], { designer: 7 }, deadline)));

    expect(result.lateness).toEqual({ minDays: 0, maxDays: 0 });
    expect(result.shortages).toEqual([]);
  });

  it("spends no time on done tasks and needs no estimate for them", () => {
    const result = success(
      forecast(
        input(
          [task("T1", { done: true, hours: undefined }), task("T2", { dependsOn: ["T1"] })],
          { designer: 7 },
        ),
      ),
    );

    expect(spanOf(result, "T1").max).toEqual({ startDay: 0, endDay: 0 });
    expect(spanOf(result, "T2").max).toEqual({ startDay: 0, endDay: 7 });
  });
});
