import { expect, it } from "vitest";
import { forecastFromState, project } from "../src/index.ts";
import type { EventPayloads, EventType, LedgerEvent } from "../src/index.ts";

it.each(['blocked', 'revising', 'submitted'] as const)('marks stopped %s work as uncertain and clears after resume', status => {
  const state = project([]);
  const spec = { id: 'research', title: '조사', assignee: 'agent', dependsOn: [], handoffConditions: [] };
  state.plan = { version: 1, tasks: [spec], reason: '', approvedBy: 'owner' };
  state.members.set('agent', { memberId: 'agent', kind: 'agent', displayName: '조사 Agent' });
  state.estimates.set('research', { min: 1, max: 2, source: 'pm' });
  state.tasks.set('research', { spec, specVersion: 1, status, results: [], updates: [] });
  const now = new Date('2026-10-01');
  expect(forecastFromState(state, now)).toMatchObject({ uncertainty: { stoppedTaskIds: ['research'], warning: '멈춘 작업 1개 — 날짜 불확실' } });
  state.tasks.get('research')!.status = 'running';
  state.activeTurn.set('agent', 'research');
  expect(forecastFromState(state, now)).not.toHaveProperty('uncertainty');
});

it("reflects availability changes, checked work, agents, cancellation, and the goal deadline", () => {
  const events: LedgerEvent[] = [];
  const emit = <K extends EventType>(type: K, payload: EventPayloads[K]) => events.push({ type, payload, id: `${events.length}`, seq: events.length + 1, at: "2026-09-28T00:00:00Z", projectId: "p", targetProductId: "product", actor: { kind: "human", id: "user" } });
  emit("member_joined", { memberId: "user", kind: "human", displayName: "User" });
  emit("member_joined", { memberId: "agent", kind: "agent", displayName: "Agent" });
  emit("goal_set", { text: "Ship", deadline: "2026-10-03T00:00:00Z", decider: "user", delegation: { pmMayApply: [] } });
  const tasks = [
    { id: "human", title: "Design", assignee: "user", dependsOn: [], handoffConditions: [] },
    { id: "agent", title: "Build", assignee: "agent", dependsOn: ["human"], handoffConditions: [] },
  ];
  emit("plan_committed", { version: 1, basedOn: null, tasks, reason: "Plan", approvedBy: "user", sourceMessageIds: [] });
  emit("estimate_updated", { taskId: "human", hours: { min: 14, max: 14 }, source: "human" });
  emit("estimate_updated", { taskId: "agent", hours: { min: 24, max: 24 }, source: "pm" });
  emit("availability_updated", { memberId: "user", weeklyHours: 28 });
  const now = new Date("2026-09-28T00:00:00Z");
  const before = forecastFromState(project(events), now);
  expect(before).toMatchObject({ ok: true, days: { min: 4.5, max: 4.5 }, lateness: { minDays: 0, maxDays: 0 } });
  emit("availability_updated", { memberId: "user", weeklyHours: 14 });
  const after = forecastFromState(project(events), now);
  expect(after).toMatchObject({ ok: true, days: { min: 8, max: 8 }, lateness: { minDays: 3, maxDays: 3 } });
  if (!before.ok || !after.ok) throw new Error("Expected successful forecasts");
  expect(after.end.max.getTime()).toBeGreaterThan(before.end.max.getTime());
  emit("result_submitted", { taskId: "human", resultId: "r", planVersion: 1, summary: "Done", artifactIds: [] });
  emit("task_checked", { taskId: "human", resultId: "r", reason: "Met" });
  expect(forecastFromState(project(events), now)).toMatchObject({ ok: true, days: { min: 1, max: 1 } });
  emit("plan_committed", { version: 2, basedOn: 1, tasks: [tasks[0]!], reason: "Remove build", approvedBy: "user", sourceMessageIds: [] });
  expect(project(events).tasks.get("agent")?.status).toBe("cancelled");
  expect(forecastFromState(project(events), now)).toMatchObject({ ok: true, tasks: [{ taskId: "human" }], days: { min: 0, max: 0 } });
});

it("returns an empty forecast before a plan exists", () => {
  expect(forecastFromState(project([]), new Date("2026-09-28T00:00:00Z"))).toMatchObject({ ok: true, tasks: [], days: { min: 0, max: 0 } });
});
