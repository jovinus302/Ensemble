import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DecisionCard } from "../components/Cards";
import { DecisionRequestCard } from "../components/DecisionRequestCard";
import { WorkChips } from "../components/Message";
import { WorkItemDetail } from "../components/WorkItemDetail";
import { TeamList, WorkPanel, WorkTree } from "../components/WorkPanel";
import { briefPreview, decisionOptions, decisionTotal, groupWorkItems, pmTeamState, planTaskTree, stallGuidance, taskDetailRevision, teamLines, waitingLabel, workGroupOf } from "../components/work-view";
import { ActivityLine } from "../components/Activity";
import { buildMockViewModel } from "../lib/mock-view-model";
import type { VmDecisionCard, VmMessage, VmWorkItem } from "../lib/view-model";

const vm = buildMockViewModel("owner");
const items = vm.work!.items;
const noop = async () => ({ ok: true as const });
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const item = (over: Partial<VmWorkItem> & { id: string }): VmWorkItem =>
  ({ title: over.id, ownerId: "a", ownerKind: "agent", status: "todo", priority: "normal", childIds: [], ...over });

describe("작업 패널 보기 상태 묶기", () => {
  it("사람 대기 / 진행 중 / 할 일 / 완료 순서로 묶고, 완료만 접는다", () => {
    const groups = groupWorkItems(items);
    expect(groups.map(g => g.label)).toEqual(["사람 대기", "진행 중", "할 일", "완료"]);
    expect(groups.map(g => g.collapsed)).toEqual([false, false, false, true]);
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(items.length);
  });

  it("상위 작업이 진행 중이어도 결정을 기다리는 하위 작업은 사람 대기 묶음에 상위 이름과 함께 보인다", () => {
    const waiting = groupWorkItems(items).find(g => g.key === "waiting")!;
    // 우선순위 높은 가입 화면이 먼저
    expect(waiting.rows.map(r => [r.item.title, r.parentTitle])).toEqual([["가입 화면", "프로토타입"], ["결제 화면", "프로토타입"]]);
    const active = groupWorkItems(items).find(g => g.key === "active")!;
    const parent = active.rows.find(r => r.item.id === "prototype")!;
    expect(parent.childCount).toBe(2);
    expect(parent.children).toEqual([]);
  });

  it("같은 묶음의 하위 작업은 상위 작업 아래 트리로 들어간다", () => {
    const groups = groupWorkItems([
      item({ id: "p", status: "in_progress", childIds: ["c1", "c2"] }),
      item({ id: "c1", parentId: "p", status: "in_review" }),
      item({ id: "c2", parentId: "p", status: "blocked", priority: "high" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rows).toHaveLength(1);
    expect(groups[0]!.rows[0]!.children.map(c => c.id)).toEqual(["c2", "c1"]);
    expect(groups[0]!.count).toBe(3);
  });

  it("상태별 묶음 기준", () => {
    expect(workGroupOf("waiting_human")).toBe("waiting");
    expect(["in_progress", "in_review", "blocked"].map(s => workGroupOf(s as VmWorkItem["status"]))).toEqual(["active", "active", "active"]);
    expect(workGroupOf("cancelled")).toBe("done");
  });

  it("사람 대기 라벨은 기다리는 사람 이름, 나라면 '내 결정 대기'", () => {
    const signup = items.find(i => i.id === "prototype-signup")!;
    expect(waitingLabel(signup, vm.members, "owner")).toBe("내 결정 대기");
    expect(waitingLabel(signup, vm.members, "designer")).toBe("사용자님 결정 대기");
  });

  it("팀은 PM·사람·Agent를 모두 한 줄씩 보인다", () => {
    const lines = teamLines(vm.work, vm.members);
    expect(lines.map(l => l.member.kind)).toEqual(["pm", "human", "human", "human", "agent", "agent"]);
    expect(lines.find(l => l.member.id === "prototype-agent")!.current?.title).toBe("가입 화면");
  });

  it("작업 트리 렌더: 묶음 머리, 담당 이름, 대기 라벨, 완료는 접힘", () => {
    const out = html(createElement(WorkTree, { vm, onOpen: () => {} }));
    expect(out).toContain("사람 대기");
    expect(out).toContain("내 결정 대기");
    expect(out).toContain("프로토타입 Agent");
    expect(out).toContain("하위 작업 2개");
    expect(out).not.toContain("흐름 초안"); // 완료 묶음은 접혀 있다
    expect(out).toMatch(/aria-expanded="false"[^>]*><span>완료/);
  });

  it("팀 탭 렌더", () => {
    const out = html(createElement(TeamList, { vm, onOpen: () => {} }));
    expect(out).toContain("결정 2");
    expect(out).toContain("막힘: 이번 주 가용 시간 부족");
  });
});

describe("결정 요청 카드", () => {
  const payment = vm.decisionCards!.find(c => c.id === "decision-payment")!;
  const retry = vm.decisionCards!.find(c => c.id === "decision-retry")!;

  it("추천안이 선택지 맨 앞에 오고 하나만 추천으로 표시된다", () => {
    const shuffled: VmDecisionCard = { ...payment, options: [...payment.options].reverse() };
    const options = decisionOptions(shuffled);
    expect(options[0]!.optionId).toBe("drop-payment");
    expect(options.filter(o => o.recommended)).toHaveLength(1);
  });

  it("추천안은 강조 블록에 한 번만 그리고, 선택지 목록에는 나머지 안만 둔다", () => {
    const out = html(createElement(DecisionRequestCard, { card: payment, members: vm.members, onDecide: noop }));
    expect(out).toContain('class="recommendation"');
    expect(out).toContain("PM 추천");
    expect(out).toContain(payment.recommendation.rationale);
    const recommended = payment.options.find(o => o.optionId === payment.recommendation.optionId)!;
    // 회귀: 추천안 이름이 강조 블록과 선택지 목록에 두 번 보였다.
    expect(out.split(`>${recommended.label}<`)).toHaveLength(2);
    expect(out).not.toContain("option-recommended");
    expect(out).toContain(recommended.tradeoff);
    for (const other of payment.options.filter(o => o.optionId !== recommended.optionId)) expect(out).toContain(`>${other.label}<`);
    // 추천안 블록이 선택지 목록보다 먼저
    expect(out.indexOf("PM 추천")).toBeLessThan(out.indexOf("decision-options"));
  });

  it("버튼 네 개: 추천대로 진행 · 다른 안 선택 · 고쳐서 승인 · 보류", () => {
    const out = html(createElement(DecisionRequestCard, { card: payment, members: vm.members, onDecide: noop }));
    for (const label of ["추천대로 진행", "다른 안 선택", "고쳐서 승인", "보류"]) expect(out).toContain(`>${label}</button>`);
    expect(out).toContain("예상 종료 3일 당겨짐");
    expect(out).toContain("멈춘 작업");
  });

  it("편집할 필드가 없으면 '고쳐서 승인'을 감춘다", () => {
    const noEdit = html(createElement(DecisionRequestCard, { card: { ...payment, editable: undefined }, members: vm.members, onDecide: noop }));
    expect(noEdit).not.toContain("고쳐서 승인");
  });

  it("자유 답변형은 답 없이 진행할 수 없다: 추천대로 진행 대신 답변 입력란과 답변 보내기·보류만 둔다", () => {
    // 회귀: 답변형 카드에 '추천대로 진행'이 보여 답 없이 승인하면 서버가 400 answer_required로 거절하거나 작업이 멈췄다.
    const text = html(createElement(DecisionRequestCard, { card: retry, members: vm.members, onDecide: noop }));
    expect(retry.answerMode).toBe("text");
    for (const label of ["추천대로 진행", "다른 안 선택", "직접 답하기", "고쳐서 승인"]) expect(text).not.toContain(`>${label}</button>`);
    expect(text).toMatch(/<textarea[^>]*required/);
    expect(text).toMatch(/<button type="submit" class="btn-primary" disabled="">답변 보내기<\/button>/);
    expect(text).toContain(">보류</button>");
    expect(text).toContain(retry.recommendation.rationale);
  });

  it("Cards의 DecisionCard가 decision 종류를 결정 요청 카드로 분기한다", () => {
    const out = html(createElement(DecisionCard, { card: payment, members: vm.members, onDecide: noop, onDecideRequest: noop }));
    expect(out).toContain("추천대로 진행");
    const plan = html(createElement(DecisionCard, { card: vm.cards[0]!, onDecide: noop }));
    expect(plan).toContain("계획 v2 승인");
  });
});

describe("작업 키를 보이지 않는다", () => {
  const internalIds = items.map(i => i.id);
  const visibleText = (markup: string) => markup.replace(/<[^>]*>/g, " ");

  it("작업 패널·상세·칩 어디에도 내부 작업 id나 JIRA식 키가 글자로 보이지 않는다", () => {
    const panels = (["work", "team", "decisions", "schedule"] as const).map(tab => html(createElement(WorkPanel, {
      vm, tab, onTab: () => {}, onOpenTask: () => {}, onDecide: noop, onDecideRequest: noop, onSetAvailability: noop,
    })));
    const details = items.map(i => html(createElement(WorkItemDetail, {
      taskId: i.id, items, members: vm.members, me: vm.me, messages: vm.messages,
      onClose: () => {}, onLoad: async () => ({ ok: false as const, message: "x" }), onComment: noop, onOpenTask: () => {}, onJumpToMessage: () => {},
    })));
    const chips = html(createElement(WorkChips, { taskIds: ["prototype-payment", "unknown-task"], workTitles: new Map(items.map(i => [i.id, i.title])), onOpenTask: () => {} }));
    expect(chips).toContain("결제 화면");
    expect(chips).not.toContain("unknown-task");
    for (const markup of [...panels, ...details, chips]) {
      const text = visibleText(markup);
      expect(text).not.toMatch(/\b[A-Z]{2,}-\d+\b/);
      for (const id of internalIds) expect(text.split(/\s+/)).not.toContain(id);
    }
  });

  it("상세 서랍은 맥락·출처·활동·댓글 구역을 갖는다", () => {
    const out = html(createElement(WorkItemDetail, {
      taskId: "prototype", items, members: vm.members, me: vm.me, messages: vm.messages,
      onClose: () => {}, onLoad: async () => ({ ok: false as const, message: "x" }), onComment: noop, onOpenTask: () => {}, onJumpToMessage: () => {},
    }));
    for (const label of ["PM이 정리한 맥락", "출처", "이 대화에서 생김", "활동 기록", "댓글", "하위 작업", "실제 결제 연동은 하지 않음"]) expect(out).toContain(label);
  });
});

 it("keeps real roadmap tasks visible until the work projection is available", () => {
  const live = { ...vm, work: undefined, roadmap: { ...vm.roadmap, tasks: [{ ...vm.roadmap.tasks[0]!, id: "live-task", title: "Live worker result", status: "checked" }] } };
  const markup = html(createElement(WorkPanel, { vm: live, tab: "work", onTab: () => {}, onOpenTask: () => {}, onDecide: noop, onDecideRequest: noop, onSetAvailability: noop }));
  expect(markup).toContain("Live worker result");
  expect(markup).not.toContain("아직 작업 항목이 없어요");
 });

describe("계획 승인 카드의 작업 계층", () => {
  const plan = vm.cards.find(c => c.kind === "plan_approval")!;
  if (plan.kind !== "plan_approval") throw new Error("mock plan card");

  it("parentId로 하위 작업을 상위 작업 아래에 묶는다(상위가 계획에 없으면 맨 위 단계)", () => {
    const tree = planTaskTree(plan.tasks);
    const proto = tree.find(n => n.task.id === "prototype")!;
    expect(proto.children.map(c => c.task.title)).toEqual(["가입 화면", "결제 화면"]);
    expect(tree.some(n => n.task.parentId)).toBe(false);
    const orphan = planTaskTree([{ id: "x", parentId: "missing", title: "x", assigneeName: "a", dependsOn: [] }]);
    expect(orphan.map(n => n.task.id)).toEqual(["x"]);
    // 상위 관계가 순환해도 작업을 잃지 않는다.
    const cycle = planTaskTree([{ id: "a", parentId: "b", title: "a", assigneeName: "a", dependsOn: [] }, { id: "b", parentId: "a", title: "b", assigneeName: "a", dependsOn: [] }]);
    const count = (nodes: ReturnType<typeof planTaskTree>): number => nodes.reduce((n, x) => n + 1 + count(x.children), 0);
    expect(count(cycle)).toBe(2);
  });

  it("카드는 하위 작업을 상위 작업 항목 안의 중첩 목록으로 그린다", () => {
    // 회귀: 계약에 parentId가 없어 하위 작업이 상위 작업과 같은 단계에 평평하게 보였다.
    const out = html(createElement(DecisionCard, { card: plan, onDecide: noop }));
    expect(out).toMatch(/프로토타입\(가입 흐름\)<\/span>.*?<ol class="plan-tasks plan-subtasks"[^>]*>.*?가입 화면.*?결제 화면.*?<\/ol><\/li>/s);
    expect(out).toContain("하위 작업 2개");
    expect(out).toContain("선행 가입 화면");
  });
});

describe("작업 상세 서랍 새로 고침", () => {
  const base = [item({ id: "t1", status: "todo" }), item({ id: "t2" })];
  const msg = (over: Partial<VmMessage>): VmMessage => ({ id: "m", authorId: "a", text: "x", at: "2026-10-01T00:00:00Z", kind: "agent", attachments: [], ...over });

  it("작업 상태·담당·대기나 이 작업을 언급한 메시지가 바뀌면 값이 바뀐다", () => {
    const r0 = taskDetailRevision("t1", base, []);
    expect(taskDetailRevision("t1", [...base], [])).toBe(r0);
    expect(taskDetailRevision("t1", [item({ id: "t1", status: "in_progress" }), base[1]!], [])).not.toBe(r0);
    expect(taskDetailRevision("t1", [item({ id: "t1", ownerId: "b" }), base[1]!], [])).not.toBe(r0);
    expect(taskDetailRevision("t1", [item({ id: "t1", status: "waiting_human", waitingOn: { memberId: "owner", requestId: "r1" } }), base[1]!], [])).not.toBe(r0);
    expect(taskDetailRevision("t1", base, [msg({ threadId: "task:t1" })])).not.toBe(r0);
    expect(taskDetailRevision("t1", base, [msg({ taskIds: ["t1"] })])).not.toBe(r0);
    // 다른 작업의 변화는 무시한다.
    expect(taskDetailRevision("t1", [base[0]!, item({ id: "t2", status: "done" })], [msg({ taskIds: ["t2"] })])).toBe(r0);
  });

  it("열린 서랍의 상태 칩은 폴링한 작업 항목을 따른다", () => {
    const props = (status: VmWorkItem["status"]) => ({
      taskId: "t1", items: [item({ id: "t1", title: "작업 하나", status })], members: vm.members, me: vm.me, messages: [],
      onClose: () => {}, onLoad: async () => ({ ok: false as const, message: "x" }), onComment: noop, onOpenTask: () => {}, onJumpToMessage: () => {},
    });
    expect(html(createElement(WorkItemDetail, props("todo")))).toContain(">할 일<");
    expect(html(createElement(WorkItemDetail, props("done")))).toContain(">완료<");
  });
});

describe("계획 승인 전 작업 탭", () => {
  it("작업 탭은 일정 내용을 빌려 오지 않고 빈 상태를 보인다", () => {
    // 회귀: 계획 승인 전에는 작업 탭이 선택된 채로 일정(계획 없음·예상 종료) 카드가 보였다.
    const before = { ...vm, work: undefined, roadmap: { ...vm.roadmap, planVersion: null, tasks: [] } };
    const props = (tab: "work" | "schedule") => ({ vm: before, tab, onTab: () => {}, onOpenTask: () => {}, onDecide: noop, onDecideRequest: noop, onSetAvailability: noop });
    const work = html(createElement(WorkPanel, props("work")));
    const schedule = html(createElement(WorkPanel, props("schedule")));
    expect(work).toMatch(/aria-selected="true"[^>]*>작업</);
    expect(work).toContain("계획이 승인되면 작업이 여기에 보여요");
    expect(work).not.toContain('class="roadmap"');
    expect(schedule).toContain('class="roadmap"');
    const noCard = html(createElement(WorkPanel, { ...props("work"), vm: { ...before, cards: [] } }));
    expect(noCard).toContain("아직 승인된 계획이 없어요");
  });
});

describe("멈춤 안내", () => {
  it("실제로 보이는 버튼만 안내한다", () => {
    expect(stallGuidance({ reason: "r", canRetry: true, canSkip: true }, true)).toContain("다시 시도·건너뛰기");
    expect(stallGuidance({ reason: "r", canRetry: true, canSkip: false }, true)).not.toContain("건너뛰기");
    expect(stallGuidance({ reason: "r", canRetry: false, canSkip: false }, true)).not.toMatch(/다시 시도|건너뛰/);
    expect(stallGuidance({ reason: "r", canRetry: false, canSkip: false, tasks: [{ taskId: "t", title: "t", actions: ["retry"] }] }, true)).toContain("처리 방법");
  });

  it("버튼을 허용하지 않는 멈춤에서는 배너에 다시 시도·건너뛰기 버튼이 없고, 허용하면 둘 다 있다", () => {
    const stalled = (canRetry: boolean, canSkip: boolean) => html(createElement(ActivityLine, {
      activity: { kind: "idle", label: "x", since: "2026-10-01T00:00:00Z", stalled: { reason: "작업이 멈춤", canRetry, canSkip } }, busy: false, onRetry: noop, onSkip: noop,
    }));
    expect(stalled(false, false)).toContain("작업이 멈춤");
    expect(stalled(false, false)).not.toMatch(/다시 시도|건너뛰기/);
    expect(stalled(true, true)).toContain(">다시 시도</button>");
    expect(stalled(true, true)).toContain(">건너뛰기</button>");
  });
});

describe("묶인 결정 요청", () => {
  it("대표 카드 안에 묶인 요청을 접어 두고, 배지는 묶인 요청까지 센다", () => {
    const [payment, retry] = [vm.decisionCards!.find(c => c.id === "decision-payment")!, vm.decisionCards!.find(c => c.id === "decision-retry")!];
    const lead: VmDecisionCard = { ...payment, bundled: [retry, { ...retry, id: "decision-retry-2" }] };
    const out = html(createElement(DecisionRequestCard, { card: lead, members: vm.members, onDecide: noop }));
    expect(out).toMatch(/<details class="decision-bundle"><summary>같이 정할 결정 <span class="num">2<\/span>건 더<\/summary>/);
    expect(out.split(`<h3 class="card-title">${retry.question}</h3>`)).toHaveLength(3);
    expect(decisionTotal([lead, payment])).toBe(4);
    const panel = html(createElement(WorkPanel, { vm: { ...vm, decisionCards: [lead], cards: [] }, tab: "decisions", onTab: () => {}, onOpenTask: () => {}, onDecide: noop, onDecideRequest: noop, onSetAvailability: noop }));
    expect(panel).toContain('<span class="tab-count num">3</span>');
  });
});

describe("R1 QA 회귀", () => {
  const answerCard = vm.decisionCards!.find(c => c.id === "decision-retry")!;

  it("답변형 카드: answerText가 있는 선택지를 바로 고르는 버튼으로 보이고, 추천안에 PM 추천과 근거를 붙이며, 직접 답하기 입력란을 둔다", () => {
    const out = html(createElement(DecisionRequestCard, { card: answerCard, members: vm.members, onDecide: noop }));
    expect(out).toContain('aria-label="고를 수 있는 답"');
    expect(out).toMatch(/<button type="button" class="btn-primary"><span class="badge badge-recommend">PM 추천<\/span> 5회<\/button>/);
    expect(out).toMatch(/<button type="button" class="btn-outlined"> 나중에 정하기<\/button>/);
    expect(out).toContain("전달할 답: “잠금 없이 시안을 만들고, 검토 때 정해 주세요.”");
    expect(out).toContain(answerCard.recommendation.rationale);
    expect(out).toContain("직접 답하기<textarea");
    expect(out).toContain(">답변 보내기</button>");
    expect(out).not.toContain('aria-label="PM 추천안"'); // 추천안을 두 번 보이지 않는다
    expect(out).not.toContain(">답하기<");
  });

  it("answerText가 하나도 없으면(예전 서버) 지금처럼 추천 블록과 답변 입력란만 둔다", () => {
    const legacy = { ...answerCard, options: answerCard.options.map(({ answerText: _a, ...o }) => o) };
    const out = html(createElement(DecisionRequestCard, { card: legacy, members: vm.members, onDecide: noop }));
    expect(out).not.toContain("고를 수 있는 답");
    expect(out).toContain('aria-label="PM 추천안"');
    expect(out).toContain("답변<textarea");
  });

  it("팀 탭 PM 줄은 PM이 판단 중일 때만 '작업을 정리하는 중'이고, 일이 끝나면 쉬는 중이다", () => {
    const at = "2026-10-01T00:00:00Z";
    expect(pmTeamState({ activity: { kind: "pm_thinking", label: "PM이 판단 중", since: at }, busy: true })).toBe("작업을 정리하는 중");
    expect(pmTeamState({ activity: { kind: "idle", label: "", since: at }, busy: false })).toBe("쉬는 중");
    expect(pmTeamState({ activity: { kind: "agent_working", label: "", since: at }, busy: true })).toBe("쉬는 중");
    expect(pmTeamState({ busy: false })).toBe("쉬는 중");
    expect(pmTeamState({ busy: true })).toBe("작업을 정리하는 중");
    const idle = { ...vm, busy: false, activity: { kind: "idle" as const, label: "", since: at } };
    const out = html(createElement(TeamList, { vm: idle, onOpen: () => {} }));
    expect(out).not.toContain("작업을 정리하는 중");
    expect(teamLines(idle.work, idle.members, idle).find(l => l.member.kind === "pm")!.row.state).toBe("쉬는 중");
  });

  it("긴 맥락은 앞 두 문장만 먼저 보이고 나머지는 더 보기로 접는다", () => {
    const goal = "2주 안에 소규모 제품팀을 위한 고객 인터뷰 예약 서비스의 고객 반응을 확인하자. 대상은 한국의 제품팀이야. 가입, 시간 선택, 예약 확인까지 눌러 볼 수 있어야 해. 결제는 빼고 가자.";
    const p = briefPreview(goal);
    expect(p.head).toBe("2주 안에 소규모 제품팀을 위한 고객 인터뷰 예약 서비스의 고객 반응을 확인하자. 대상은 한국의 제품팀이야.");
    expect(p.rest).toBe("가입, 시간 선택, 예약 확인까지 눌러 볼 수 있어야 해. 결제는 빼고 가자.");
    expect(briefPreview("짧은 맥락이에요.")).toEqual({ head: "짧은 맥락이에요." });
    expect(briefPreview("가".repeat(300)).head.length).toBeLessThanOrEqual(140);
    const items2 = vm.work!.items.map(i => i.id === "prototype" ? { ...i, brief: { ...i.brief!, why: goal } } : i);
    const out = html(createElement(WorkItemDetail, { taskId: "prototype", items: items2, members: vm.members, me: "owner", messages: vm.messages,
      onClose: () => {}, onLoad: async () => ({ ok: false as const, message: "x" }), onComment: noop, onOpenTask: () => {}, onJumpToMessage: () => {} }));
    expect(out).toContain('<details class="compact-more"><summary class="small">더 보기</summary><p>가입, 시간 선택, 예약 확인까지');
  });
});
