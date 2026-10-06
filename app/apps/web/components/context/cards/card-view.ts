// 작업 흐름 C: 채팅 카드·멤버 목록이 보이는 문구를 정하는 순수 함수. 컴포넌트는 이 결과만 그린다(JSX 없이 검사할 수 있게).
// 규칙: 서버가 풀어 준 VmContextCard만 읽고, 내부 id(itemId·handoffId·searchId …)는 문구에 넣지 않는다(React key로만 쓴다).
import type { VmMember } from "../../../lib/view-model";
import type {
  VmChangeSet, VmContextBranch, VmContextCard, VmContextItem, VmContextTone, VmPoolCandidate, VmProposal, VmToolHandoff,
} from "../../../lib/work-context-view-model";

export interface ToneText { text: string; tone: VmContextTone }

/** PM 단계 칩("판단 중: 결정 근거 확인 → 멤버 역량 확인 → 가능 인력 검색"). 결과가 카드에 붙어 있으면 단계가 끝난 것이다. */
export function stepsView(card: Extract<VmContextCard, { kind: "pm_steps" }>): { label: string; steps: string[]; done: boolean } {
  return { label: card.label, steps: card.steps, done: !!(card.candidates?.length || card.proposal) };
}

/** pool 후보 한 줄: 상태는 원장의 초대·합류에서 온다(호출 중 → 합류). */
export function poolRow(c: VmPoolCandidate): { name: string; initial: string; detail: string; status: ToneText } {
  const status: ToneText = c.joined ? { text: "합류", tone: "ok" } : c.invited ? { text: "호출 중", tone: "info" }
    : c.available ? { text: "가용", tone: "info" } : { text: "바쁨", tone: "excluded" };
  return { name: c.name, initial: c.initial, detail: [c.role, c.available ? "가용" : "바쁨", c.note].join(" · "), status };
}

/** 분기 선택지의 현재 상태: 고른 것, 고르지 않은 것(흐리게), 미리 보는 것, 아직 열린 것. */
export function branchOptionState(branch: VmContextBranch, optionId: string): "chosen" | "dim" | "previewing" | "open" {
  const option = branch.options.find(o => o.optionId === optionId);
  if (option?.chosen) return "chosen";
  if (option?.previewing) return "previewing";
  return branch.options.some(o => o.chosen) ? "dim" : "open";
}

/** 분기 카드 아래 한 줄: "B 선택 · 확정 김서연 · 근거 한지우 · 정유나". 열려 있으면 아무도 고르지 않았다고 보인다. */
export function branchSummary(branch: VmContextBranch): ToneText {
  const chosen = branch.options.find(o => o.chosen);
  if (!chosen) return { text: "아직 고르지 않았어요 · 확정은 사람이 합니다", tone: "branch" };
  const parts = [`${chosen.optionId} 선택`];
  if (branch.decidedByName) parts.push(`확정 ${branch.decidedByName}`);
  if (branch.evidenceNames.length) parts.push(`근거 ${branch.evidenceNames.join(" · ")}`);
  return { text: parts.join(" · "), tone: "ok" };
}

/** "A로 가면?" 카드: 예상 변화와 그 선택지의 이득·위험 칩. 예상이 걷히면 같은 카드가 "걷음"으로 바뀐다. */
export function branchPreviewView(branch: VmContextBranch, optionId: string): { title: string; open: boolean; effects: string[]; chips: ToneText[]; status: ToneText } {
  const option = branch.options.find(o => o.optionId === optionId);
  const chosen = branch.options.find(o => o.chosen);
  const open = !!option?.previewing;
  const chips: ToneText[] = [...(option?.risks ?? []).map(text => ({ text, tone: "violation" as const })), ...(option?.gains ?? []).map(text => ({ text, tone: "ok" as const }))];
  const status: ToneText = open ? { text: `예상 경로 · ${optionId} 적용 시`, tone: "undecided" }
    : { text: chosen ? `예상 경로 걷음 · ${chosen.optionId} 유지` : "예상 경로 걷음", tone: "ok" };
  return { title: `${optionId}로 가면`, open, effects: open ? branch.previewEffects ?? [] : [], chips, status };
}

/** Proposal 요약 줄(덱): 결정 · 화면 "N SCREENS" · 누락 보완. 입력 수는 미리보기 설명("5 inputs")에 있다. */
export function proposalView(p: VmProposal): { title: string; status: ToneText; rows: { head: string; text: string; status: ToneText }[] } {
  const rows = [
    ...p.decisions.map(d => ({ head: d.key ? `결정 ${d.key}` : "결정", text: d.title, status: { text: d.statusLabel || "제안", tone: d.statusLabel === "분기" ? "branch" as const : "ok" as const } })),
    { head: "화면", text: p.screens.join(" · "), status: { text: `${p.screens.length} SCREENS`, tone: "info" as const } },
    ...(p.filledTitles.length ? [{ head: "누락 보완", text: p.filledTitles.join(" · "), status: { text: "포함", tone: "ok" as const } }] : []),
  ];
  return { title: `Proposal v${p.version}`, status: p.status === "confirmed" ? { text: "확정", tone: "ok" } : { text: "생성됨", tone: "changed" }, rows };
}

/** 펼침 칩: 같은 레이어 키를 한 칩으로 묶는다("D1 D2", "F1–F4"). 상태가 바뀐 키는 따로 보인다(F2 제외 등). */
export function expansionGroups(items: VmContextItem[]): { label: string; keys: { key: string; tone: VmContextTone; title: string }[]; tone: VmContextTone }[] {
  const groups = new Map<string, { key: string; tone: VmContextTone; title: string }[]>();
  for (const item of items) {
    if (!item.key) continue;
    const prefix = item.key.replace(/\d+$/, "");
    const list = groups.get(prefix) ?? [];
    list.push({ key: item.key, tone: item.tone === "info" ? "ok" : item.tone, title: `${item.layerLabel} ${item.title}${item.statusLabel ? ` · ${item.statusLabel}` : ""}` });
    groups.set(prefix, list);
  }
  return [...groups.values()].map(keys => {
    const uniform = keys.every(k => k.tone === keys[0]!.tone);
    const nums = keys.map(k => Number(k.key.match(/\d+$/)?.[0]));
    const consecutive = nums.every((n, i) => i === 0 || n === nums[i - 1]! + 1);
    const label = uniform && consecutive && keys.length >= 3 ? `${keys[0]!.key}–${keys.at(-1)!.key}` : keys.map(k => k.key).join(" ");
    return { label, keys, tone: uniform ? keys[0]!.tone : "changed" };
  });
}

const HANDOFF_TONE: Record<VmToolHandoff["status"], VmContextTone> = { delivered: "info", in_progress: "undecided", done: "ok" };
/**
 * 제작 도구 한 줄. 전달 카드는 "화면 S1 · S2 → Figma · 박도윤 연결", 빌드 카드는 "Figma · 화면 S1 · S2 → 개발 도구".
 * 라벨(전달됨 → 제작 중 → 제작 완료)은 서버가 지금 상태로 풀어 준 값이다. 도구가 남긴 메모(note)는 전달 카드에서 한 줄 더,
 * 빌드 카드에서는 줄 본문으로 보인다. 라벨과 같은 메모("통합 빌드 중")는 두 번 보이지 않는다.
 */
export function handoffRow(h: VmToolHandoff, mode: "handoff" | "build"): { lead: string; text: string; owner?: string; memo?: string; status: ToneText; working: boolean } {
  const status = { text: h.statusLabel, tone: HANDOFF_TONE[h.status] };
  const memo = h.note && h.note !== h.statusLabel ? h.note : undefined;
  // 전달 카드 줄은 이미 제목을 보이므로 "제목 → 개발 도구" 메모는 "결과 → 개발 도구"로 줄인다.
  const shortMemo = memo?.startsWith(`${h.title} →`) ? `결과 ${memo.slice(h.title.length).trim()}` : memo;
  return mode === "handoff"
    ? { lead: h.title, text: `→ ${h.toolName}`, ...(h.ownerName ? { owner: `${h.ownerName} 연결` } : {}), ...(shortMemo ? { memo: shortMemo } : {}), status, working: h.status === "in_progress" }
    : { lead: h.toolName, text: memo ?? h.title, status, working: h.status === "in_progress" };
}

/** 빌드 카드 머리: 도구 단계 칩과 빌드 버전. */
export function buildView(card: Extract<VmContextCard, { kind: "build" }>): { label: string; steps: string[]; version: string } {
  return { label: "제작", steps: card.handoffs.map(h => h.toolId === "dev-tools" ? `${h.toolName} 통합` : h.toolName), version: `v${card.version} 빌드` };
}

const CHANGE_TEXT: Record<VmChangeSet["changes"][number]["change"], ToneText> = {
  added: { text: "추가", tone: "changed" }, excluded: { text: "제외", tone: "excluded" }, updated: { text: "갱신", tone: "changed" },
};
/**
 * 변경 카드. 버튼은 결정권자이고 아직 열린 변경일 때만 있다(canResolve는 서버가 me 기준으로 계산).
 * 닫히면 버튼 대신 결과("적용됨 · v1.1" / "되돌림 · v1.0 유지")를 보인다.
 */
export function changeSetView(cs: VmChangeSet): {
  title: string; chips: ToneText[]; stale: string[]; actions: { outcome: "applied" | "reverted"; label: string }[]; status: ToneText;
} {
  const chips: ToneText[] = [
    ...cs.changes.map(c => ({ text: `${c.key ? `${c.key} ` : ""}${c.title} ${CHANGE_TEXT[c.change].text}`, tone: CHANGE_TEXT[c.change].tone })),
    ...cs.unaffectedKeys.map(key => ({ text: `${key} 유지`, tone: "ok" as const })),
  ];
  const status: ToneText = cs.status === "applied" ? { text: `적용됨 · v${cs.toVersion}`, tone: "ok" }
    : cs.status === "reverted" ? { text: `되돌림 · v${cs.fromVersion} 유지`, tone: "excluded" }
    : { text: cs.canResolve ? "적용할지 정해 주세요" : "결정권자가 정합니다", tone: "undecided" };
  const actions = cs.status === "proposed" && cs.canResolve
    ? [{ outcome: "applied" as const, label: `변경 적용 · v${cs.toVersion}` }, { outcome: "reverted" as const, label: "되돌리기" }] : [];
  return { title: `v${cs.fromVersion} → v${cs.toVersion} · 변경 ${cs.changes.length}건`, chips, stale: cs.staleTitles, actions, status };
}

const KIND_LABEL = { human: "사람", agent: "Agent", pm: "PM" } as const;
/** 멤버 머리: "멤버 8명 (사람 3 · Agent 2 · PM 1)"과 "+2 POOL". pool 멤버는 사람 수와 따로 세어 합이 맞는다. */
export function memberSummary(members: VmMember[]): { total: string; breakdown: string; pool?: string } {
  const team = members.filter(m => !m.pool), pool = members.length - team.length;
  const breakdown = (["human", "agent", "pm"] as const).map(k => `${KIND_LABEL[k]} ${team.filter(m => m.kind === k).length}`).join(" · ");
  return { total: `멤버 ${members.length}명`, breakdown, ...(pool ? { pool: `+${pool} POOL` } : {}) };
}
export function memberRole(m: VmMember): string {
  return m.role ?? KIND_LABEL[m.kind];
}

/** 카드가 화면에 내는 모든 문구(검사용: 내부 id가 새지 않는지). 컴포넌트가 그리는 문구와 같은 함수에서 나온다. */
export function cardTexts(card: VmContextCard): string[] {
  switch (card.kind) {
    case "branch_options":
      return [card.branch.question, ...card.branch.options.flatMap(o => [o.optionId, o.title, ...o.gains, ...o.risks]), branchSummary(card.branch).text];
    case "branch_preview": {
      const v = branchPreviewView(card.branch, card.optionId);
      return [v.title, v.status.text, ...v.effects, ...v.chips.map(c => c.text)];
    }
    case "pm_steps": {
      const v = stepsView(card);
      return [v.label, ...v.steps, ...(card.candidates ?? []).flatMap(c => { const r = poolRow(c); return [r.name, r.initial, r.detail, r.status.text]; }),
        ...(card.proposal ? proposalTexts(card.proposal) : [])];
    }
    case "pool_candidates":
      return card.candidates.flatMap(c => { const r = poolRow(c); return [r.name, r.initial, r.detail, r.status.text]; });
    case "proposal":
      return proposalTexts(card.proposal);
    case "expansion":
      return expansionGroups(card.items).flatMap(g => [g.label, ...g.keys.flatMap(k => [k.key, k.title])]);
    case "tool_handoffs":
      return card.handoffs.flatMap(h => { const r = handoffRow(h, "handoff"); return [r.lead, r.text, r.owner ?? "", r.memo ?? "", r.status.text, h.ownerInitial]; });
    case "build": {
      const v = buildView(card);
      return [v.label, v.version, ...v.steps, ...card.handoffs.flatMap(h => { const r = handoffRow(h, "build"); return [r.lead, r.text, r.status.text]; })];
    }
    case "change_set": {
      const v = changeSetView(card.changeSet);
      return [v.title, v.status.text, ...v.chips.map(c => c.text), ...v.stale, ...v.actions.map(a => a.label)];
    }
  }
}
function proposalTexts(p: VmProposal): string[] {
  const v = proposalView(p);
  return [v.title, v.status.text, ...v.rows.flatMap(r => [r.head, r.text, r.status.text])];
}
