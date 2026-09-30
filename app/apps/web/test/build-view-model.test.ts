import { describe, expect, it } from "vitest";
import { availabilityWeek, type EventPayloads, type EventType, type LedgerEvent, type TaskSpec } from "@ensemble/core";
import { buildViewModel, projectTitle, refreshTodo, stripTaskKeys } from "../lib/build-view-model";
import { buildMockViewModel } from "../lib/mock-view-model";

const NOW = new Date("2026-10-01T00:00:00Z");
const PROPOSAL = "8f1c2d3e-1111-4222-8333-944455556666";

function ledger() {
  const events: LedgerEvent[] = [];
  const emit = <K extends EventType>(type: K, payload: EventPayloads[K], extra: Partial<LedgerEvent> = {}) => {
    const e: LedgerEvent = { id: extra.id ?? `e${events.length}`, seq: events.length + 1, at: new Date(NOW.getTime() + events.length * 60_000).toISOString(), projectId: "p", targetProductId: "p", actor: { kind: "system", id: "pm" }, type, payload };
    events.push(e);
    return e;
  };
  return { events, emit };
}

const tasks: TaskSpec[] = [
  { id: "research", title: "경쟁 서비스 조사", assignee: "research-agent", dependsOn: [], handoffConditions: ["출처가 있는 비교표"] },
  { id: "interview", title: "고객 인터뷰", assignee: "owner", dependsOn: [], handoffConditions: ["최소 5명 인터뷰 기록"] },
  { id: "flow", title: "사용 흐름 설계", assignee: "designer", dependsOn: ["research", "interview"], handoffConditions: [] },
];
const estimates = [
  { taskId: "research", hours: { min: 2, max: 4 } },
  { taskId: "interview", hours: { min: 5, max: 8.5 } },
  { taskId: "flow", hours: { min: 6, max: 10 } },
];

function started(withAvailability = true) {
  const l = ledger();
  l.emit("member_joined", { memberId: "owner", kind: "human", displayName: "사용자" });
  l.emit("member_joined", { memberId: "designer", kind: "human", displayName: "디자이너" });
  l.emit("member_joined", { memberId: "research-agent", kind: "agent", displayName: "조사 Agent" });
  l.emit("goal_set", { text: "시연용 가상 자료입니다. 2주 안에 소규모 제품팀을 위한 고객 인터뷰 예약 서비스 Interview Loop의 고객 반응을 확인하자. 대상은 한국의 제품팀이야.", deadline: "2026-10-14T15:00:00Z", decider: "owner", delegation: { pmMayApply: [] } });
  if (withAvailability) {
    l.emit("availability_updated", { memberId: "owner", weeklyHours: 10 });
    l.emit("availability_updated", { memberId: "designer", weeklyHours: 8 });
  }
  l.emit("plan_proposed", { proposalId: PROPOSAL, version: 1, tasks, estimates, reason: "MVP 역할 템플릿", forMemberId: "owner" });
  l.emit("pm_considered", { considerationId: PROPOSAL, triggerId: PROPOSAL, whoseAction: "owner", alreadyKnows: "no", evidence: [PROPOSAL], decision: "speak", reason: "A person must decide the next action", openTopics: [] });
  l.emit("pm_spoke", { considerationId: PROPOSAL, messageId: `${PROPOSAL}:speech`, text: "계획 v1 초안을 확인하고 승인해 주세요.", kind: "ask" });
  return l;
}

function approved() {
  const l = started();
  l.emit("plan_decided", { proposalId: PROPOSAL, memberId: "owner", approved: true });
  l.emit("plan_committed", { version: 1, basedOn: null, tasks, reason: "MVP 역할 템플릿", approvedBy: "owner", sourceMessageIds: [] });
  for (const e of estimates) l.emit("estimate_updated", { taskId: e.taskId, hours: e.hours, source: "pm" });
  const start = `start:${PROPOSAL}:0`;
  l.emit("pm_considered", { considerationId: start, triggerId: start, whoseAction: "owner", alreadyKnows: "no", evidence: [start], decision: "speak", reason: "A person must decide the next action", openTopics: [] });
  l.emit("pm_spoke", { considerationId: start, messageId: `${start}:speech`, text: '@사용자 interview "고객 인터뷰"을(를) 시작할 수 있습니다.', kind: "ask" });
  l.emit("task_start_reserved", { taskId: "research", specVersion: 1, trigger: "plan" });
  l.emit("task_started", { taskId: "research" });
  return l;
}

describe("buildViewModel — M8 화면 계약", () => {
  it("긴 시연 목표는 짧은 제목과 시연용 표식으로", () => {
    const vm = buildViewModel(started().events, { me: "owner", mode: "scenario", busy: false, now: NOW });
    expect(vm.project.synthetic).toBe(true);
    expect(vm.project.title).toBe("2주 안에 소규모 제품팀을 위한 고객 인터뷰 예약 서비스…");
    expect(vm.project.title!.length).toBeLessThanOrEqual(41);
    expect(projectTitle("새 프로젝트")).toEqual({ title: "새 프로젝트" });
    expect(projectTitle(undefined)).toEqual({});
  });

  it("계획 카드에 작업별 추정 시간·예상 완료일·인계 조건을 싣는다", () => {
    const vm = buildViewModel(started().events, { me: "owner", mode: "free", busy: false, now: NOW });
    const card = vm.cards[0]!;
    expect(card.kind).toBe("plan_approval");
    if (card.kind !== "plan_approval") return;
    const interview = card.tasks.find(t => t.id === "interview")!;
    expect(interview.hours).toEqual({ min: 5, max: 8.5 });
    expect(interview.handoffConditions).toEqual(["최소 5명 인터뷰 기록"]);
    expect(interview.expectedEnd && Date.parse(interview.expectedEnd.min)).toBeGreaterThan(NOW.getTime());
    expect(card.finish).toBeDefined();
    // 가용 시간이 없으면 날짜 없이 보여 준다.
    const noHours = buildViewModel(started(false).events, { me: "owner", mode: "free", busy: false, now: NOW }).cards[0]!;
    expect(noHours.kind === "plan_approval" && noHours.tasks.every(t => !t.expectedEnd && t.hours)).toBe(true);
  });

  it("계획 제안 안내 발언은 카드와 연결된다(화면에서 카드 하나로 보인다)", () => {
    const vm = buildViewModel(started().events, { me: "owner", mode: "free", busy: false, now: NOW });
    expect(vm.messages.find(m => m.id === `${PROPOSAL}:speech`)?.cardId).toBe(PROPOSAL);
    expect(vm.cards.map(c => c.id)).toEqual([PROPOSAL]);
    // 카드가 없는 사람에게는 발언만 남는다.
    expect(buildViewModel(started().events, { me: "designer", mode: "free", busy: false, now: NOW }).cards).toEqual([]);
  });

  it("이번 주 예외 가용 시간은 기본값과 따로 준다", () => {
    const l = started();
    l.emit("availability_updated", { memberId: "designer", weeklyHours: 4, weekStart: availabilityWeek(NOW) });
    l.emit("availability_updated", { memberId: "owner", weeklyHours: 1, weekStart: "2020-01-06" });
    const members = buildViewModel(l.events, { me: "owner", mode: "free", busy: false, now: NOW }).members;
    expect(members.find(m => m.id === "designer")).toMatchObject({ weeklyHours: 8, weeklyHoursThisWeek: 4 });
    expect(members.find(m => m.id === "owner")?.weeklyHoursThisWeek).toBeUndefined();
  });

  it("승인된 계획은 채널에 결정 기록으로 남는다", () => {
    const vm = buildViewModel(approved().events, { me: "owner", mode: "free", busy: false, now: NOW });
    expect(vm.cards).toEqual([]);
    const record = vm.messages.find(m => m.record);
    expect(record).toMatchObject({ kind: "system", text: "계획 v1 승인 — 사용자", record: { kind: "plan_decision", planVersion: 1, approved: true, byName: "사용자" } });
  });

  it("로드맵: 기준 시각·추정·인계 조건을 주고, 상태는 core 값 그대로 둔다", () => {
    const vm = buildViewModel(approved().events, { me: "owner", mode: "free", busy: false, now: NOW });
    expect(vm.roadmap.origin).toBe(NOW.toISOString());
    const research = vm.roadmap.tasks.find(t => t.id === "research")!;
    expect(research).toMatchObject({ status: "running", hours: { min: 2, max: 4 }, handoffConditions: ["출처가 있는 비교표"] });
    expect(vm.roadmap.forecast?.ok).toBe(true);
  });

  it("예측 실패 이유는 한국어로", () => {
    const l = started(false);
    l.emit("plan_decided", { proposalId: PROPOSAL, memberId: "owner", approved: true });
    l.emit("plan_committed", { version: 1, basedOn: null, tasks, reason: "r", approvedBy: "owner", sourceMessageIds: [] });
    for (const e of estimates) l.emit("estimate_updated", { taskId: e.taskId, hours: e.hours, source: "pm" });
    const f = buildViewModel(l.events, { me: "owner", mode: "free", busy: false, now: NOW }).roadmap.forecast;
    expect(f?.ok).toBe(false);
    if (f && !f.ok) {
      expect(f.reasons.length).toBeGreaterThan(0);
      for (const r of f.reasons) { expect(r).toMatch(/[가-힣]/); expect(r).not.toMatch(/missing_|owner|designer/); }
    }
  });

  it("PM 판단 기록: 영어 이유·no/unknown·내부 ID를 사람이 읽는 말로, 발언과 계기를 함께", () => {
    const l = approved();
    const msg = l.emit("message_recorded", { messageId: "m-lunch", authorId: "owner", text: "다들 점심 뭐 드셨어요? 저는 김치찌개 ㅋㅋ", attachmentIds: [] });
    l.emit("pm_considered", { considerationId: "c-lunch", triggerId: "m-lunch", whoseAction: null, alreadyKnows: "unknown", evidence: ["msg:m-lunch", "forecast:candidate", "availability:designer", msg.id], decision: "silent", reason: "잡담이라 계획에 영향 없음", openTopics: [] });
    const vm = buildViewModel(l.events, { me: "owner", mode: "free", busy: false, now: NOW });
    const [proposal, start, lunch] = vm.pmLog;
    expect(vm.pmLog).toHaveLength(3);
    expect(proposal).toMatchObject({ reason: "사람이 다음 행동을 정해야 해요", alreadyKnows: "아직 모름", triggerLabel: "계획 v1 제안", spokenText: "계획 v1 초안을 확인하고 승인해 주세요.", evidence: ["계획 v1 제안"] });
    expect(start!.triggerLabel).toBe("계획 v1 승인 후 작업 시작 안내");
    expect(start!.spokenText).toBe('@사용자 "고객 인터뷰"을(를) 시작할 수 있습니다.');
    expect(lunch).toMatchObject({ alreadyKnows: "확인하지 못함", whoseAction: null });
    expect(lunch!.triggerLabel).toBeUndefined();
    expect(lunch!.evidence).toEqual(['메시지 · 사용자: "다들 점심 뭐 드셨어요? 저는 김치찌개 ㅋㅋ"', "변경안을 적용한 예측", "디자이너 주간 가용 시간 8시간"]);
    for (const j of vm.pmLog) for (const e of j.evidence) expect(e).not.toMatch(/msg:|forecast:|[0-9a-f]{8}-[0-9a-f]{4}/);
    // 채널 PM 발언의 근거와 발언 속 작업 키도 같은 방식으로.
    const speech = vm.messages.find(m => m.id === `start:${PROPOSAL}:0:speech`)!;
    expect(speech.text).not.toContain(" interview ");
    expect(speech.pm?.reason).toBe("사람이 다음 행동을 정해야 해요");
  });

  it("같은 판단이 두 번 기록되면 한 번만 보인다", () => {
    const l = approved();
    for (const id of ["c1", "c2"]) l.emit("pm_considered", { considerationId: id, triggerId: "m-x", whoseAction: null, alreadyKnows: "yes", evidence: [], decision: "silent", reason: "이미 앎", openTopics: [] });
    const vm = buildViewModel(l.events, { me: "owner", mode: "free", busy: false, now: NOW });
    expect(vm.pmLog.filter(j => j.triggerMessageId === "m-x")).toHaveLength(1);
  });

  it("Agent 결과 요약: 내부 키를 숨기고 '할 일'을 현재 상태에 맞춘다", () => {
    const l = approved();
    const summary = (text: string) => l.emit("reply_recorded", { memberId: "research-agent", taskId: "research", text, attachmentIds: [] });
    l.emit("result_submitted", { taskId: "research", resultId: "r1", planVersion: 1, summary: "s", artifactIds: [] });
    const first = summary("[research 경쟁 서비스 조사] 조사 Agent 결과\n무엇이 됐나: 비교\n할 일: PM이 인계 조건을 확인하는 중입니다.\n확인할 곳: a.md");
    const before = buildViewModel(l.events, { me: "owner", mode: "free", busy: false, now: NOW }).messages.find(m => m.id === first.id)!;
    expect(before.text).toBe("[경쟁 서비스 조사] 조사 Agent 결과\n무엇이 됐나: 비교\n할 일: PM이 인계 조건을 확인하는 중입니다.\n확인할 곳: a.md");
    l.emit("task_checked", { taskId: "research", resultId: "r1", reason: "met" });
    const after = buildViewModel(l.events, { me: "owner", mode: "free", busy: false, now: NOW }).messages.find(m => m.id === first.id)!;
    expect(after.text).toContain("할 일: PM이 인계 조건을 확인했습니다.");
    expect(after.text).not.toContain("확인하는 중");
    expect(after.text).not.toContain("[research");
  });

  it("activity는 서버가 주면 그대로, 없으면 빠진다", () => {
    const activity = { kind: "pm_thinking" as const, label: "PM이 판단 중", since: NOW.toISOString() };
    expect(buildViewModel(started().events, { me: "owner", mode: "free", busy: true, now: NOW, activity }).activity).toEqual(activity);
    expect("activity" in buildViewModel(started().events, { me: "owner", mode: "free", busy: true, now: NOW })).toBe(false);
  });
});

describe("문구 보정 함수", () => {
  it("refreshTodo: 이전 요약에서는 낡은 문장을 지우고, 최신 요약만 현재 상태를 말한다", () => {
    const text = "제목\n할 일: PM이 보완을 요청했습니다. 보완본이 오면 다시 알려드립니다.\n확인할 곳: 없음";
    expect(refreshTodo(text, "checked", false)).toBe("제목\n확인할 곳: 없음");
    expect(refreshTodo(text, "checked", true)).toBe("제목\n할 일: PM이 인계 조건을 확인했습니다.\n확인할 곳: 없음");
    expect(refreshTodo(text, "revising", true)).toBe(text);
    expect(refreshTodo("할 일: PM이 인계 조건을 확인하는 중입니다. 확인하지 못한 점: 가격", "checked", false)).toBe("할 일: 확인하지 못한 점: 가격");
  });

  it("stripTaskKeys: 형식이 다르면 건드리지 않는다", () => {
    expect(stripTaskKeys('[flow 흐름 설계] 결과, @디자이너 flow "흐름 설계"', ["flow"])).toBe('[흐름 설계] 결과, @디자이너 "흐름 설계"');
    expect(stripTaskKeys("flow가 늦어져요", ["flow"])).toBe("flow가 늦어져요");
  });

  it("mock 뷰 모델도 새 계약 필드를 갖는다", () => {
    const vm = buildMockViewModel("owner");
    expect(vm.activity?.stalled?.canRetry).toBe(true);
    expect(vm.roadmap.origin).toBeDefined();
    expect(vm.messages.some(m => m.record?.kind === "plan_decision")).toBe(true);
  });
});
