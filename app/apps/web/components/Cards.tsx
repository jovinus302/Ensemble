"use client";

import { useState } from "react";
import type { VmCard } from "../lib/view-model";
import { formatDateRange, formatHourRange } from "./format";
import { ScopeLists } from './TaskResolution';

const CHANGE_KIND: Record<string, string> = {
  scope_reduce: "범위 축소", reorder: "순서 변경", reassign_agent: "Agent 담당 변경",
  reassign_human: "사람 담당 변경", reschedule: "일정 변경", deadline_change: "기한 변경",
};

export function DecisionCard({ card, onDecide }: { card: VmCard; onDecide: (cardId: string, approve: boolean) => Promise<unknown> }) {
  const [pending, setPending] = useState(false);
  const decide = async (approve: boolean) => {
    setPending(true);
    try { await onDecide(card.id, approve); } finally { setPending(false); }
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
          <ol className="plan-tasks">
            {card.tasks.map(t => (
              <li key={t.id} className="plan-task">
                <div className="plan-task-head">
                  <span className="task-title">{t.title}</span>
                  <span className="muted small">{t.assigneeName}</span>
                </div>
                <div className="plan-task-meta small">
                  <span>추정 <span className="num">{t.hours ? formatHourRange(t.hours.min, t.hours.max) : "—"}</span></span>
                  <span>예상 완료 <span className="num">{t.expectedEnd ? formatDateRange(t.expectedEnd.min, t.expectedEnd.max) : "계산 전"}</span></span>
                  {t.dependsOn.length > 0 && <span>선행 {t.dependsOn.map(d => card.tasks.find(x => x.id === d)?.title ?? d).join(", ")}</span>}
                </div>
                <ScopeLists exclusions={t.exclusions} limits={t.limits} />
                {t.handoffConditions && t.handoffConditions.length > 0 && (
                  <div className="handoff small">
                    <span className="muted">넘기기 전 확인할 조건</span>
                    <ul>{t.handoffConditions.map((c, i) => <li key={i}>{c}</li>)}</ul>
                  </div>
                )}
              </li>
            ))}
          </ol>
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
