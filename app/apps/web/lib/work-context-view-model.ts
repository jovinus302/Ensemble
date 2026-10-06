// 서버-화면 공통 계약(Pages v2.5 WORK CONTEXT). docs/pages-v25-runtime-demo.md §6.
// 서버가 작업 기록(@ensemble/core의 WorkContextState)에서 이 형태를 만들고, 화면은 이 형태만 보고 그린다.
// 모양을 바꿀 때는 coordinator를 거친다(작업 흐름 B·C가 함께 쓴다).
import type { AppPreviewSpec, ContextEdgeKind, ContextItemStatus, ContextLayer, PreviewSource, ProductionToolId, ToolHandoffStatus } from "@ensemble/core";

/** 색 묶음: 감지(충돌·위반·미정·누락), 정리(ok·분기), 변경(변경·낡음·제외). */
export type VmContextTone = "conflict" | "violation" | "undecided" | "missing" | "ok" | "branch" | "changed" | "stale" | "excluded" | "info";

export interface VmContextSource { name: string; initial: string; kind: "human" | "agent" | "pm" | "pool" }
export interface VmContextItem {
  id: string;
  /** 보이는 키("D1", "F5"). 없으면 키 없이 그린다. */
  key?: string;
  layer: ContextLayer;
  /** "[결정]", "[기능]" … 레이어 이름. */
  layerLabel: string;
  title: string;
  status: ContextItemStatus;
  /** 사람이 읽는 상태("충돌", "누락", "통합", "검증 예정"). stated면 비운다. */
  statusLabel?: string;
  tone: VmContextTone;
  note?: string;
  source: VmContextSource;
}
export interface VmContextEdge { id: string; from: string; to: string; kind: ContextEdgeKind; stale?: boolean }
export interface VmBranchOption { optionId: string; title: string; gains: string[]; risks: string[]; chosen: boolean; previewing: boolean }
export interface VmContextBranch {
  itemId: string; key?: string; question: string; options: VmBranchOption[];
  /** 정한 사람과 근거를 준 사람(이름). */
  decidedByName?: string; evidenceNames: string[];
  /** 지금 미리 보는 선택지의 예상 변화("A로 가면?"). */
  previewEffects?: string[];
}
/** LOG 한 줄: "10:45 누락 · 대화에는 없지만 …". 최신이 위. */
export interface VmContextLogLine { id: string; at: string; kindLabel: string; text: string }
/** 캔버스 머리 요약("연결 2 · 충돌 1 · 위반 1 …"). */
export interface VmContextSummaryChip { label: string; count?: number; tone: VmContextTone }

export interface VmAppPreview { previewId: string; source: PreviewSource; label: string; caption?: string; spec: AppPreviewSpec }
export interface VmToolHandoff {
  id: string; toolId: ProductionToolId; toolName: string; ownerName: string; ownerInitial: string;
  title: string; round: number; status: ToolHandoffStatus;
  /** "전달됨" / "제작 중" / "제작 완료" (개발 도구는 "통합 빌드 중" / "빌드 완료"). */
  statusLabel: string; note?: string;
}
export interface VmPoolCandidate { candidateId: string; name: string; initial: string; role: string; note: string; available: boolean; invited: boolean; joined: boolean }
export interface VmProposal {
  id: string; version: number; title: string; status: "generated" | "confirmed";
  decisions: { key?: string; title: string; statusLabel: string }[];
  screens: string[]; filledTitles: string[]; inputCount: number;
}
export interface VmChangeSet {
  id: string; fromVersion: string; toVersion: string; status: "proposed" | "applied" | "reverted";
  changes: { key?: string; title: string; change: "added" | "excluded" | "updated" }[];
  staleTitles: string[]; unaffectedKeys: string[];
  /** me가 결정권자이고 아직 열린 변경이면 "변경 적용 / 되돌리기"를 보인다. */
  canResolve: boolean;
}

/** 채팅 메시지 안의 카드. 서버가 현재 상태로 풀어서 준다(진행 상황이 제자리에서 바뀐다). */
export type VmContextCard =
  | { kind: "branch_options"; branch: VmContextBranch }
  | { kind: "pm_steps"; label: string; steps: string[]; candidates?: VmPoolCandidate[]; proposal?: VmProposal }
  | { kind: "pool_candidates"; candidates: VmPoolCandidate[] }
  | { kind: "proposal"; proposal: VmProposal }
  | { kind: "branch_preview"; branch: VmContextBranch; optionId: string }
  | { kind: "expansion"; items: VmContextItem[] }
  | { kind: "tool_handoffs"; handoffs: VmToolHandoff[] }
  | { kind: "build"; version: string; handoffs: VmToolHandoff[] }
  | { kind: "change_set"; changeSet: VmChangeSet };

/** 변경 카드의 버튼(`POST /api/context/changes/:id`). */
export interface ContextChangeAnswer { me: string; outcome: "applied" | "reverted" }

export interface VmWorkContext {
  code: string; title: string; channelName: string;
  /** "v0.3", "v1.0", "v1.0 → v1.1". */
  versionLabel: string;
  /** 캔버스 머리 문구("Proposal v1 · 확정 → 제작 도구 전달 → 제작 완료"). */
  stageLabel?: string;
  summary: VmContextSummaryChip[];
  /** supersededBy가 있는 항목은 빠진다(LOG에만 남는다). */
  items: VmContextItem[];
  edges: VmContextEdge[];
  branches: VmContextBranch[];
  log: VmContextLogLine[];
  /** 오른쪽 모바일 화면(가장 최근의 걷히지 않은 미리보기). */
  preview?: VmAppPreview;
  /** 분기 미리보기("예상 · A 적용 시")가 열려 있으면 나란히 그린다. */
  comparePreview?: VmAppPreview;
  handoffs: VmToolHandoff[];
  proposal?: VmProposal;
  changeSet?: VmChangeSet;
  pool: { candidates: VmPoolCandidate[]; joinedCount: number };
}
