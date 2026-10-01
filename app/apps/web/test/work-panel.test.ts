import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DecisionCard } from "../components/Cards";
import { DecisionRequestCard } from "../components/DecisionRequestCard";
import { WorkChips } from "../components/Message";
import { WorkItemDetail } from "../components/WorkItemDetail";
import { TeamList, WorkPanel, WorkTree } from "../components/WorkPanel";
import { decisionOptions, groupWorkItems, teamLines, waitingLabel, workGroupOf } from "../components/work-view";
import { buildMockViewModel } from "../lib/mock-view-model";
import type { VmDecisionCard, VmWorkItem } from "../lib/view-model";

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

  it("추천안을 강조 블록과 추천 배지로 그린다(추천 선택지에만)", () => {
    const out = html(createElement(DecisionRequestCard, { card: payment, members: vm.members, onDecide: noop }));
    expect(out).toContain('class="recommendation"');
    expect(out).toContain("PM 추천");
    expect(out).toContain(payment.recommendation.rationale);
    expect(out.match(/option-recommended/g)).toHaveLength(1);
    expect(out).toMatch(/decision-option option-recommended"><div class="decision-option-head"><span class="task-title">결제 화면 빼기/);
    // 추천안 블록이 선택지 목록보다 먼저
    expect(out.indexOf("PM 추천")).toBeLessThan(out.indexOf("decision-options"));
  });

  it("버튼 네 개: 추천대로 진행 · 다른 안 선택 · 고쳐서 승인 · 보류", () => {
    const out = html(createElement(DecisionRequestCard, { card: payment, members: vm.members, onDecide: noop }));
    for (const label of ["추천대로 진행", "다른 안 선택", "고쳐서 승인", "보류"]) expect(out).toContain(`>${label}</button>`);
    expect(out).toContain("예상 종료 3일 당겨짐");
    expect(out).toContain("멈춘 작업");
  });

  it("편집할 필드가 없으면 '고쳐서 승인'을 감추고, 자유 답변형은 '직접 답하기'를 보인다", () => {
    const noEdit = html(createElement(DecisionRequestCard, { card: { ...payment, editable: undefined }, members: vm.members, onDecide: noop }));
    expect(noEdit).not.toContain("고쳐서 승인");
    const text = html(createElement(DecisionRequestCard, { card: retry, members: vm.members, onDecide: noop }));
    for (const label of ["추천대로 진행", "다른 안 선택", "직접 답하기", "보류"]) expect(text).toContain(`>${label}</button>`);
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
