import { describe, expect, it } from "vitest";
import {
  bundleDecisions, createDecisionRequest, decisionReminderKey, decisionsDue, openDecisions, pausedTaskIds, project, resolveDecision, workStatus,
} from "../src/index.ts";
import type { EventPayloads, EventType, LedgerEvent, NewLedgerEvent, TaskSpec } from "../src/index.ts";

const ctx = { projectId: "p", targetProductId: "p" };
const pm = { kind: "pm", id: "pm" } as const;
const owner = { kind: "human", id: "owner" } as const;
const spec = (id: string, assignee: string): TaskSpec => ({ id, title: id, baseTitle: id, assignee, dependsOn: [], handoffConditions: [], exclusions: [], limits: [] });

function ledger() {
  const events: LedgerEvent[] = [];
  const emit = <K extends EventType>(type: K, payload: EventPayloads[K], actor: LedgerEvent["actor"] = pm, at = "2026-10-01T00:00:00Z") =>
    events.push({ id: `e${events.length}`, seq: events.length + 1, at, projectId: "p", targetProductId: "p", actor, type, payload });
  const append = (event: NewLedgerEvent) => events.push({ ...event, id: `e${events.length}`, seq: events.length + 1, at: event.at ?? "2026-10-01T00:00:00Z" });
  emit("member_joined", { memberId: "owner", kind: "human", displayName: "사용자" });
  emit("member_joined", { memberId: "designer", kind: "human", displayName: "디자이너" });
  emit("member_joined", { memberId: "agent", kind: "agent", displayName: "Agent", role: "prototype" });
  emit("goal_set", { text: "출시", decider: "owner", delegation: { pmMayApply: ["reorder"] } }, owner);
  const tasks = ["a", "b", "c", "d", "e"].map((id) => spec(id, "agent"));
  emit("plan_committed", { version: 1, basedOn: null, tasks, reason: "초기", approvedBy: "owner", sourceMessageIds: [] });
  return { events, emit, append };
}

const request = (requestId: string, taskId: string, patch: Partial<EventPayloads["decision_requested"]> = {}): EventPayloads["decision_requested"] => ({
  requestId, kind: "plan_change", targetMemberId: "owner", question: `${taskId}를 디자이너에게 맡길까요?`,
  options: [
    { optionId: "move", label: "디자이너가 맡기", effects: [{ type: "plan_ops", ops: [{ type: "reassign", taskId, assignee: "designer", sourceMessageIds: [] }] }], tradeoff: "디자이너 시간 사용" },
    { optionId: "keep", label: "그대로 두기", effects: [{ type: "none" }], tradeoff: "늦어짐" },
  ],
  recommendation: { optionId: "move", rationale: "Agent가 막혔음", evidence: ["e5"] },
  impact: { taskIds: [taskId], blockedTaskIds: [taskId] }, editable: ["assignee", "priority"], sourceMessageIds: [], ...patch,
});
const now = new Date("2026-10-01T00:00:00Z");

describe("decision request creation", () => {
  it("rejects a request without a recommendation or with only one option", () => {
    const { events } = ledger(); const state = project(events);
    const { recommendation: _r, ...noRecommendation } = request("r1", "a");
    expect(() => createDecisionRequest(state, noRecommendation as EventPayloads["decision_requested"], ctx, now)).toThrow(/추천안/);
    const single = request("r1", "a"); single.options = single.options.slice(0, 1);
    expect(() => createDecisionRequest(state, single, ctx, now)).toThrow(/선택지/);
    expect(() => createDecisionRequest(state, request("r1", "a", { recommendation: { optionId: "nope", rationale: "x", evidence: [] } }), ctx, now)).toThrow(/추천안/);
    expect(() => createDecisionRequest(state, request("r1", "a", { targetMemberId: "agent" }), ctx, now)).toThrow(/사람/);
    const noHold = request("r1", "a"); noHold.options = [noHold.options[0]!, { ...noHold.options[0]!, optionId: "other" }];
    expect(() => createDecisionRequest(state, noHold, ctx, now)).toThrow(/보류/);
    const event = createDecisionRequest(state, request("r1", "a"), ctx, now);
    expect(event.payload).toMatchObject({ requestId: "r1", remindAt: "2026-10-02T00:00:00.000Z" });
  });

  it("ignores invalid requests written straight to the ledger", () => {
    const { events, emit } = ledger();
    const single = request("r1", "a"); single.options = single.options.slice(0, 1);
    emit("decision_requested", single);
    expect(project(events).decisionRequests.size).toBe(0);
  });

  it("allows one open request per task", () => {
    const { events, append } = ledger();
    append(createDecisionRequest(project(events), request("r1", "a"), ctx, now));
    expect(() => createDecisionRequest(project(events), request("r2", "a"), ctx, now)).toThrow(/이미 열린 요청/);
    const state = project(events);
    expect(workStatus(state.tasks.get("a")!, state)).toBe("waiting_human");
    append(resolveDecision(state, "r1", { by: "pm", action: "withdraw" }, ctx).events[0]!);
    expect(() => createDecisionRequest(project(events), request("r2", "a"), ctx, now)).not.toThrow();
  });
});

describe("answering", () => {
  it("rejects answers from anyone but the target; the target's approval resets the automation counter", () => {
    const { events, emit, append } = ledger();
    append(createDecisionRequest(project(events), request("r1", "a"), ctx, now));
    for (let i = 0; i < 3; i++) emit("task_start_reserved", { taskId: "b", specVersion: 1, trigger: `t${i}` });
    let state = project(events);
    expect(state.automation.actionsSinceResume).toBe(4);
    expect(() => resolveDecision(state, "r1", { by: "designer", action: "approve" }, ctx)).toThrow(/대상자/);
    emit("decision_resolved", { requestId: "r1", by: "designer", outcome: "approved" }, { kind: "human", id: "designer" });
    state = project(events);
    expect(state.decisionRequests.get("r1")!.status).toBe("open");
    expect(state.automation.actionsSinceResume).toBe(4);

    const { effects, events: out } = resolveDecision(state, "r1", { by: "owner", action: "approve" }, ctx);
    expect(effects).toEqual(request("r1", "a").options[0]!.effects);
    out.forEach(append);
    state = project(events);
    expect(state.decisionRequests.get("r1")).toMatchObject({ status: "approved", resolution: { by: "owner", optionId: "move" } });
    expect(state.automation.actionsSinceResume).toBe(0);
    expect(() => resolveDecision(state, "r1", { by: "owner", action: "approve" }, ctx)).toThrow(/닫힌/);
  });

  it("rejection closes without effects or counter reset; another option applies its effects", () => {
    const { events, emit, append } = ledger();
    append(createDecisionRequest(project(events), request("r1", "a"), ctx, now));
    append(createDecisionRequest(project(events), request("r2", "b"), ctx, now));
    emit("task_start_reserved", { taskId: "c", specVersion: 1, trigger: "t" });
    const state = project(events);
    const rejected = resolveDecision(state, "r1", { by: "owner", action: "reject" }, ctx);
    expect(rejected.effects).toEqual([]);
    const other = resolveDecision(state, "r2", { by: "owner", action: "choose", optionId: "keep" }, ctx);
    expect(other.effects).toEqual([{ type: "none" }]);
    expect(other.events[0]!.payload).toMatchObject({ outcome: "chose_other", optionId: "keep" });
    append(rejected.events[0]!);
    expect(project(events).automation.actionsSinceResume).toBe(2);
  });

  it("edits apply only editable fields", () => {
    const { events, append } = ledger();
    append(createDecisionRequest(project(events), request("r1", "a"), ctx, now));
    const state = project(events);
    expect(() => resolveDecision(state, "r1", { by: "owner", action: "edit", edits: { title: "새 이름" } }, ctx)).toThrow(/편집할 수 없/);
    expect(() => resolveDecision(state, "r1", { by: "owner", action: "edit", edits: { priority: "urgent" } }, ctx)).toThrow(/priority/);
    const { effects, events: out } = resolveDecision(state, "r1", { by: "owner", action: "edit", edits: { assignee: "owner", priority: "high" } }, ctx);
    expect(effects).toEqual([{ type: "plan_ops", ops: [{ type: "reassign", taskId: "a", assignee: "owner", sourceMessageIds: [] }] }]);
    expect(out.map((e) => [e.type, e.payload])).toEqual([
      ["decision_resolved", { requestId: "r1", by: "owner", outcome: "edited", optionId: "move", edits: { assignee: "owner", priority: "high" } }],
      ["task_meta_set", { taskId: "a", priority: "high" }],
    ]);
    out.forEach(append);
    const after = project(events);
    expect(after.decisionRequests.get("r1")!.status).toBe("edited");
    expect(after.automation.actionsSinceResume).toBe(0);
    // The stored option is untouched by the edit.
    expect(after.decisionRequests.get("r1")!.request.options[0]!.effects).toEqual(request("r1", "a").options[0]!.effects);
  });

  it("include keeps only the chosen tasks' ops", () => {
    const { events, append } = ledger();
    const req = request("r1", "a", { editable: ["include"], impact: { taskIds: ["a", "b"], blockedTaskIds: [] } });
    req.options[0]!.effects = [{ type: "plan_ops", ops: ["a", "b"].map((taskId) => ({ type: "reassign" as const, taskId, assignee: "designer", sourceMessageIds: [] })) }];
    append(createDecisionRequest(project(events), req, ctx, now));
    const { effects } = resolveDecision(project(events), "r1", { by: "owner", action: "edit", edits: { include: ["b"] } }, ctx);
    expect(effects).toEqual([{ type: "plan_ops", ops: [{ type: "reassign", taskId: "b", assignee: "designer", sourceMessageIds: [] }] }]);
  });

  it("missing_info answers carry the text and the answer effect", () => {
    const { events, append } = ledger();
    append(createDecisionRequest(project(events), request("q1", "a", {
      kind: "missing_info", question: "오류 흐름 기준이 뭔가요?",
      options: [
        { optionId: "answer", label: "답하기", effects: [{ type: "answer", taskId: "a", questionId: "q" }], tradeoff: "" },
        { optionId: "hold", label: "보류", effects: [{ type: "none" }], tradeoff: "작업이 멈춤" },
      ],
      recommendation: { optionId: "answer", rationale: "작업이 멈춤", evidence: [] },
    }), ctx, now));
    const state = project(events);
    expect(() => resolveDecision(state, "q1", { by: "owner", action: "answer", text: " " }, ctx)).toThrow(/답변/);
    const { effects, events: out } = resolveDecision(state, "q1", { by: "owner", action: "answer", text: "빨간 배너" }, ctx);
    expect(effects).toEqual([{ type: "answer", taskId: "a", questionId: "q" }]);
    expect(out[0]!.payload).toMatchObject({ outcome: "answered", answerText: "빨간 배너" });
  });

  it("an offered answer (answerText) answers with its words when approved or chosen; a typed answer still goes", () => {
    const { events, append } = ledger();
    const answer = { type: "answer" as const, taskId: "a", questionId: "q" };
    append(createDecisionRequest(project(events), request("q1", "a", {
      kind: "missing_info", question: "로그인 방식은 무엇으로 할까요?",
      options: [
        { optionId: "choice-1", label: "이메일만", answerText: "이메일만", effects: [answer], tradeoff: "" },
        { optionId: "choice-2", label: "이메일과 소셜 로그인", answerText: "이메일과 소셜 로그인", effects: [answer], tradeoff: "" },
        { optionId: "hold", label: "보류", effects: [{ type: "none" }], tradeoff: "작업이 멈춤" },
      ],
      recommendation: { optionId: "choice-1", rationale: "범위가 작아 먼저 확인하기 쉬움", evidence: ["q"] },
    }), ctx, now));
    const state = project(events);
    const approved = resolveDecision(state, "q1", { by: "owner", action: "approve" }, ctx);
    expect(approved.effects).toEqual([answer]);
    expect(approved.events[0]!.payload).toMatchObject({ outcome: "answered", optionId: "choice-1", answerText: "이메일만" });
    expect(resolveDecision(state, "q1", { by: "owner", action: "choose", optionId: "choice-2" }, ctx).events[0]!.payload).toMatchObject({ outcome: "answered", optionId: "choice-2", answerText: "이메일과 소셜 로그인" });
    expect(resolveDecision(state, "q1", { by: "owner", action: "answer", text: "이메일과 구글" }, ctx).events[0]!.payload).toMatchObject({ outcome: "answered", answerText: "이메일과 구글" });
    expect(resolveDecision(state, "q1", { by: "owner", action: "choose", optionId: "hold" }, ctx).events[0]!.payload).toMatchObject({ outcome: "chose_other", optionId: "hold" });
  });

  it("refuses an answerText on an option that cannot relay it", () => {
    const { events } = ledger();
    const bad = request("q1", "a");
    bad.options[0] = { ...bad.options[0]!, answerText: "디자이너" };
    expect(() => createDecisionRequest(project(events), bad, ctx, now)).toThrow(/답 전달/);
    const blank = request("q2", "b", { kind: "missing_info", options: [
      { optionId: "c1", label: "빈 답", answerText: " ", effects: [{ type: "answer", taskId: "b" }], tradeoff: "" },
      { optionId: "hold", label: "보류", effects: [{ type: "none" }], tradeoff: "" },
    ], recommendation: { optionId: "c1", rationale: "x", evidence: [] } });
    expect(() => createDecisionRequest(project(events), blank, ctx, now)).toThrow(/답이 비었/);
  });
});

describe("openDecisions and bundling", () => {
  it("includes legacy plan_proposed and authority_requested in the same shape", () => {
    const { events, emit, append } = ledger();
    emit("plan_proposed", { proposalId: "prop2", version: 2, tasks: [spec("a", "agent")], estimates: [], reason: "범위 조정", forMemberId: "owner" });
    emit("authority_requested", { requestId: "auth1", personId: "designer", changeKinds: ["human_commitment"], text: "검토를 맡아 주실래요?" });
    append(createDecisionRequest(project(events), request("r1", "a"), ctx, now));
    const open = openDecisions(project(events));
    expect(open.map((d) => [d.source, d.requestId, d.targetMemberId, d.kind])).toEqual([
      ["decision_requested", "r1", "owner", "plan_change"], ["plan_proposed", "prop2", "owner", "plan_change"], ["authority_requested", "auth1", "designer", "plan_change"],
    ]);
    const keys = Object.keys(open[0]!).filter((k) => k !== "editable" && k !== "remindAt" && k !== "requestedSeq").sort();
    for (const decision of open.slice(1)) {
      expect(Object.keys(decision).sort()).toEqual(keys);
      expect(decision.options.some((o) => o.optionId === decision.recommendation.optionId)).toBe(true);
    }
  });

  it("bundles a person's requests beyond three into the most recent card", () => {
    const { events, append } = ledger();
    for (const id of ["a", "b", "c", "d", "e"]) append(createDecisionRequest(project(events), request(`r-${id}`, id), ctx, now));
    append(createDecisionRequest(project(events), request("r-x", "x", { targetMemberId: "designer", impact: { taskIds: [], blockedTaskIds: [] } }), ctx, now));
    const cards = bundleDecisions(openDecisions(project(events)));
    expect(cards.map((card) => card.map((d) => d.requestId))).toEqual([["r-a"], ["r-b"], ["r-c", "r-d", "r-e"], ["r-x"]]);
  });
});

describe("unanswered requests (Q3)", () => {
  it("reminds once, then expires and keeps the work paused without applying anything", () => {
    const { events, append, emit } = ledger();
    append(createDecisionRequest(project(events), request("r1", "a"), ctx, now));
    const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000);
    expect(decisionsDue(project(events), events, at(23))).toEqual([]);
    expect(decisionsDue(project(events), events, at(24))).toEqual([{ requestId: "r1", targetMemberId: "owner", action: "remind" }]);
    events.push({ id: "rem", seq: events.length + 1, at: at(24).toISOString(), projectId: "p", targetProductId: "p", actor: pm, type: "pm_spoke", idempotencyKey: decisionReminderKey("r1"),
      payload: { considerationId: "c", messageId: "pm-rem", text: "다시 여쭤요", kind: "ask", requestId: "r1" } });
    expect(decisionsDue(project(events), events, at(47))).toEqual([]);
    expect(decisionsDue(project(events), events, at(48))).toEqual([{ requestId: "r1", targetMemberId: "owner", action: "expire" }]);

    // A person cannot expire their own request.
    emit("decision_resolved", { requestId: "r1", by: "owner", outcome: "expired" }, owner);
    const state = project(events);
    expect(state.decisionRequests.get("r1")!.status).toBe("open");
    const expired = resolveDecision(state, "r1", { by: "pm", action: "expire" }, ctx);
    expect(expired.effects).toEqual([]);
    expired.events.forEach(append);
    const after = project(events);
    expect(after.decisionRequests.get("r1")!.status).toBe("expired");
    expect(after.automation.actionsSinceResume).toBe(1);
    expect(workStatus(after.tasks.get("a")!, after)).toBe("todo");
    expect([...pausedTaskIds(after)]).toEqual(["a"]);
    expect([...pausedTaskIds(after, { unanswered: "apply_recommendation" })]).toEqual([]);
    expect(decisionsDue(after, events, at(100))).toEqual([]);
  });

  it("applies the recommendation on expiry only when switched by the setting", () => {
    const { events, append } = ledger();
    append(createDecisionRequest(project(events), request("r1", "a"), ctx, now));
    const { effects } = resolveDecision(project(events), "r1", { by: "pm", action: "expire" }, ctx, { unanswered: "apply_recommendation" });
    expect(effects).toEqual(request("r1", "a").options[0]!.effects);
  });
});
