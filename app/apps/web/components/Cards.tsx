"use client";

import { useRef, useState } from "react";
import type { VmCard, VmDecisionCard, VmMember, VmPlanTask } from "../lib/view-model";
import { DecisionRequestCard, type DecideRequest } from "./DecisionRequestCard";
import { formatDateRange, formatHourRange } from "./format";
import { ScopeLists } from './TaskResolution';
import { AssigneeKindBadge } from "./TeamBadges";
import { planTaskTree, type PlanTaskNode } from "./work-view";

const CHANGE_KIND: Record<string, string> = {
  scope_reduce: "범위 축소", reorder: "순서 변경", reassign_agent: "Agent 담당 변경",
  reassign_human: "사람 담당 변경", reschedule: "일정 변경", deadline_change: "기한 변경",
};

/** 채널·"내 결정" 탭의 카드 하나. 결정 요청(kind "decision")은 별도 카드와 응답 경로(`decisions/:id`)를 쓴다. */
export function DecisionCard({ card, onDecide, onDecideRequest, members = [] }: {
  card: VmCard | VmDecisionCard; onDecide: (cardId: string, approve: boolean) => Promise<unknown>;
  onDecideRequest?: DecideRequest; members?: VmMember[];
}) {
  if (card.kind === "decision") {
    return <DecisionRequestCard card={card} members={members} onDecide={onDecideRequest ?? (async () => ({ ok: false, message: "이 화면에서는 답할 수 없어요." }))} />;
  }
  return <ApprovalCard card={card} onDecide={onDecide} />;
}

/** 계획 작업 목록. 하위 작업은 상위 작업 아래에 들여 쓴 목록으로 그린다. */
function PlanTaskList({ nodes, all, nested }: { nodes: PlanTaskNode[]; all: VmPlanTask[]; nested?: boolean }) {
  return (
    <ol className={`plan-tasks${nested ? " plan-subtasks" : ""}`} aria-label={nested ? "하위 작업" : undefined}>
      {nodes.map(({ task: t, children }) => (
        <li key={t.id} className={`plan-task${nested ? " plan-task-child" : ""}`}>
          <div className="plan-task-head">
            <span className="task-title">{t.title}</span>
            <span className="muted small">{t.assigneeName} <AssigneeKindBadge kind={t.assigneeKind} />{children.length > 0 ? ` · 하위 작업 ${children.length}개` : ""}</span>
          </div>
          <div className="plan-task-meta small">
            <span>추정 <span className="num">{t.hours ? formatHourRange(t.hours.min, t.hours.max) : "—"}</span></span>
            <span>예상 완료 <span className="num">{t.expectedEnd ? formatDateRange(t.expectedEnd.min, t.expectedEnd.max) : "계산 전"}</span></span>
            {t.dependsOn.length > 0 && <span>선행 {t.dependsOn.map(d => all.find(x => x.id === d)?.title ?? "다른 작업").join(", ")}</span>}
          </div>
          <ScopeLists exclusions={t.exclusions} limits={t.limits} />
          {t.handoffConditions && t.handoffConditions.length > 0 && (
            <div className="handoff small">
              <span className="muted">넘기기 전 확인할 조건</span>
              <ul>{t.handoffConditions.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
          )}
          {children.length > 0 && <PlanTaskList nodes={children} all={all} nested />}
        </li>
      ))}
    </ol>
  );
}

function ApprovalCard({ card, onDecide }: { card: VmCard; onDecide: (cardId: string, approve: boolean) => Promise<unknown> }) {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const decide = async (approve: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try { await onDecide(card.id, approve); } finally { inFlight.current = false; setPending(false); }
  };

  return (
    <section className="card approval-card" aria-label={card.kind === "plan_approval" ? "계획 승인 요청" : "권한 요청"}>
      <header className="card-head">
        <span className="chip chip-needs"><span aria-hidden>✋</span> 내 결정 필요</span>
        <h3 className="card-title">
          {card.kind === "plan_approval" ? `계획 v${card.planVersion} 승인 요청` : "권한 요청"}
        </h3>
      </header>

      {card.kind === "plan_approval" ? (
        <>
          <p className="card-text">{card.reason}</p>
          {card.finish && <p className="card-text small"><span className="muted">예상 종료</span> <strong className="num">{formatDateRange(card.finish.min, card.finish.max)}</strong></p>}
          <PlanTaskList nodes={planTaskTree(card.tasks)} all={card.tasks} />
        </>
      ) : (
        <>
          <p className="card-text">{card.text}</p>
          <div className="chip-row">
            {card.changeKinds.map(k => <span key={k} className="chip chip-plain">{CHANGE_KIND[k] ?? k}</span>)}
          </div>
        </>
      )}

      <div className="card-actions">
        <button type="button" className="btn-outlined" disabled={pending} onClick={() => decide(false)}>거절</button>
        <button type="button" className="btn-primary" disabled={pending} onClick={() => decide(true)}>
          {card.kind === "plan_approval" ? `계획 v${card.planVersion} 승인` : "권한 승인"}
        </button>
      </div>
    </section>
  );
}
