// 작업 패널의 보기 계산(순수 함수). 화면 컴포넌트는 이 결과만 그린다.
// 작업 id는 내부 값이다. 여기서 만드는 어떤 문구에도 id를 넣지 않는다(사용자에게 작업 키를 보이지 않는다).
import type { VmActivity, VmCard, VmDecisionCard, VmMember, VmMessage, VmPlanTask, VmWork, VmWorkItem, VmWorkStatus, VmWorkTeamRow } from "../lib/view-model";

export const WORK_STATUS_LABEL: Record<VmWorkStatus, string> = {
  todo: "할 일", in_progress: "진행 중", in_review: "검토 중", waiting_human: "사람 대기",
  blocked: "막힘", done: "완료", cancelled: "취소",
};
/** 상태 칩 색(기존 chip-* 톤을 다시 쓴다). */
export const WORK_STATUS_TONE: Record<VmWorkStatus, "done" | "working" | "needs" | "failed" | "queued"> = {
  todo: "queued", in_progress: "working", in_review: "working", waiting_human: "needs",
  blocked: "failed", done: "done", cancelled: "queued",
};

export type WorkGroupKey = "waiting" | "active" | "todo" | "done";
export const WORK_GROUP_LABEL: Record<WorkGroupKey, string> = { waiting: "사람 대기", active: "진행 중", todo: "할 일", done: "완료" };
const GROUP_ORDER: WorkGroupKey[] = ["waiting", "active", "todo", "done"];

/** 묶음 기준. 칸반 열이 아니다: 사람이 상태를 옮기지 않고, 묶음은 읽는 순서만 정한다. */
export function workGroupOf(status: VmWorkStatus): WorkGroupKey {
  switch (status) {
    case "waiting_human": return "waiting";
    case "in_progress": case "in_review": case "blocked": return "active";
    case "todo": return "todo";
    case "done": case "cancelled": return "done";
  }
}

/** 묶음 안의 한 줄. children은 같은 묶음에 든 하위 작업(트리로 들여 쓴다). parentTitle은 상위 작업이 다른 묶음에 있을 때의 맥락. */
export interface WorkRow { item: VmWorkItem; children: VmWorkItem[]; parentTitle?: string; childCount: number }
export interface WorkGroup { key: WorkGroupKey; label: string; rows: WorkRow[]; count: number; collapsed: boolean }

const PRIORITY_RANK = { high: 0, normal: 1, low: 2 } as const;
const byPriority = (order: Map<string, number>) => (a: VmWorkItem, b: VmWorkItem) =>
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);

/**
 * 작업 트리를 묶음으로 나눈다: 사람 대기 / 진행 중 / 할 일 / 완료(접힘). 빈 묶음은 뺀다.
 * 하위 작업은 상위 작업과 같은 묶음이면 그 아래에 들여 쓰고, 다른 묶음이면 자기 묶음에 "상위 작업 › 제목"으로 보인다.
 * 그래서 상위 작업이 진행 중이어도 결정을 기다리는 하위 작업은 "사람 대기"에 드러난다.
 */
export function groupWorkItems(items: VmWorkItem[]): WorkGroup[] {
  const byId = new Map(items.map(i => [i.id, i]));
  const order = new Map(items.map((i, n) => [i.id, n]));
  const rowsByGroup = new Map<WorkGroupKey, WorkRow[]>();
  const sorted = [...items].sort(byPriority(order));
  for (const item of sorted) {
    const group = workGroupOf(item.status);
    const parent = item.parentId ? byId.get(item.parentId) : undefined;
    if (parent && workGroupOf(parent.status) === group) continue; // 상위 작업 줄 아래에 들어간다
    const childItems = item.childIds.map(id => byId.get(id)).filter((c): c is VmWorkItem => !!c);
    const children = childItems.filter(c => workGroupOf(c.status) === group).sort(byPriority(order));
    const row: WorkRow = { item, children, childCount: childItems.length, ...(parent ? { parentTitle: parent.title } : {}) };
    rowsByGroup.set(group, [...(rowsByGroup.get(group) ?? []), row]);
  }
  return GROUP_ORDER.flatMap(key => {
    const rows = rowsByGroup.get(key);
    if (!rows?.length) return [];
    const count = rows.reduce((n, r) => n + 1 + r.children.length, 0);
    return [{ key, label: WORK_GROUP_LABEL[key], rows, count, collapsed: key === "done" }];
  });
}

/** "사용자님 결정 대기" / 나라면 "내 결정 대기". */
export function waitingLabel(item: VmWorkItem, members: VmMember[], me: string): string | undefined {
  if (!item.waitingOn) return undefined;
  if (item.waitingOn.memberId === me) return "내 결정 대기";
  const name = members.find(m => m.id === item.waitingOn!.memberId)?.displayName ?? "담당자";
  return `${name}님 결정 대기`;
}

/** 팀 탭 한 줄. 멤버 순서는 PM → 사람 → Agent. 서버 행이 없는 멤버도 한 줄로 보인다. */
export interface TeamLine { member: VmMember; row: VmWorkTeamRow; current?: VmWorkItem }
const KIND_ORDER = { pm: 0, human: 1, agent: 2 } as const;
export function teamLines(work: VmWork | undefined, members: VmMember[]): TeamLine[] {
  const rows = new Map((work?.team ?? []).map(r => [r.memberId, r]));
  const items = new Map((work?.items ?? []).map(i => [i.id, i]));
  return [...members].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]).map(member => {
    const row = rows.get(member.id) ?? { memberId: member.id, state: member.kind === "pm" ? "작업을 정리하는 중" : member.busy ? "작업 중" : "쉬는 중", openDecisions: 0 };
    const current = row.currentItemId ? items.get(row.currentItemId) : undefined;
    return { member, row, ...(current ? { current } : {}) };
  });
}

/** 결정 카드의 선택지를 추천안이 먼저 오도록 정렬하고 추천 여부를 붙인다. */
export function decisionOptions(card: VmDecisionCard) {
  const options = card.options.map(o => ({ ...o, recommended: o.optionId === card.recommendation.optionId }));
  return [...options.filter(o => o.recommended), ...options.filter(o => !o.recommended)];
}

/** 결정 배지 숫자: 묶인 요청(bundled)도 각자 답해야 하므로 센다. */
export function decisionTotal(cards: readonly (VmCard | VmDecisionCard)[]): number {
  return cards.reduce((n, c) => n + 1 + (c.kind === "decision" ? c.bundled?.length ?? 0 : 0), 0);
}

export const DECISION_KIND_LABEL: Record<VmDecisionCard["requestKind"], string> = {
  plan_change: "계획 변경", assignment: "담당 확인", choice: "선택", missing_info: "정보 필요", stuck_work: "멈춘 작업",
};

/** 이 결정으로 바뀌는 예상 종료: 음수는 당겨짐, 양수는 늦어짐. */
export function deadlineDeltaLabel(days: number | undefined): string | undefined {
  if (days === undefined || days === 0) return undefined;
  return days < 0 ? `예상 종료 ${Math.abs(days)}일 당겨짐` : `예상 종료 ${days}일 늦어짐`;
}

/** 계획 승인 카드의 작업 트리 한 마디. 상위 작업이 계획에 없는 하위 작업은 맨 위 단계로 올린다. */
export interface PlanTaskNode { task: VmPlanTask; children: PlanTaskNode[] }
export function planTaskTree(tasks: VmPlanTask[]): PlanTaskNode[] {
  const ids = new Set(tasks.map(t => t.id));
  const childrenOf = new Map<string, VmPlanTask[]>();
  for (const t of tasks) if (t.parentId && t.parentId !== t.id && ids.has(t.parentId)) childrenOf.set(t.parentId, [...(childrenOf.get(t.parentId) ?? []), t]);
  const seen = new Set<string>();
  const node = (task: VmPlanTask): PlanTaskNode => {
    seen.add(task.id);
    return { task, children: (childrenOf.get(task.id) ?? []).filter(c => !seen.has(c.id)).map(node) };
  };
  const roots = tasks.filter(t => !t.parentId || t.parentId === t.id || !ids.has(t.parentId)).map(node);
  // 상위 관계가 순환하면 어느 쪽도 뿌리가 아니다: 빠진 작업은 맨 위 단계에 붙여 하나도 잃지 않는다.
  for (const t of tasks) if (!seen.has(t.id)) roots.push(node(t));
  return roots;
}

/**
 * 열린 작업 상세가 다시 불러와야 하는지 가늠하는 값. 상태 폴링의 작업 항목(상태·담당·대기·하위 작업)과
 * 이 작업을 언급한 메시지 수가 바뀌면 값이 바뀐다. 활동·댓글은 폴링에 없으므로 이 값으로 상세를 새로 가져온다.
 */
export function taskDetailRevision(taskId: string, items: VmWorkItem[], messages: VmMessage[]): string {
  const item = items.find(i => i.id === taskId);
  const mentions = messages.filter(m => !m.local && (m.threadId === `task:${taskId}` || m.taskIds?.includes(taskId))).length;
  const children = item ? item.childIds.map(id => items.find(i => i.id === id)?.status ?? "").join(",") : "";
  return JSON.stringify([item?.status, item?.ownerId, item?.waitingOn?.requestId, item?.resolution?.actions, children, mentions]);
}

/**
 * 멈춤 안내 문구. 다시 시도·건너뛰기는 서버가 허용할 때(canRetry/canSkip)만 버튼이 보이므로, 안내도 그 버튼이
 * 실제로 있을 때만 그 이름을 말한다. 작업별 처리 버튼이 있으면 그쪽을 가리키고, 아무 버튼도 없으면 확인만 권한다.
 */
export function stallGuidance(stalled: NonNullable<VmActivity["stalled"]>, canResolveTasks: boolean): string {
  const buttons = [stalled.canRetry && "다시 시도", stalled.canSkip && "건너뛰기"].filter(Boolean).join("·");
  if (buttons) return `대본이 멈췄어요. 아래 ${buttons} 버튼으로 이어 가세요.`;
  if (canResolveTasks && stalled.tasks?.length) return "작업이 멈췄어요. 아래에서 그 작업의 처리 방법을 골라 주세요.";
  return "진행이 멈췄어요. 아래 이유를 확인하고 채널에서 PM에게 알려 주세요.";
}
