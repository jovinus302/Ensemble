"use client";

import { useState } from "react";
import type { VmCard } from "../lib/view-model";

const CHANGE_KIND: Record<string, string> = {
  scope_reduce: "범위 축소", reorder: "순서 변경", reassign_agent: "Agent 담당 변경",
  reassign_human: "사람 담당 변경", reschedule: "일정 변경", deadline_change: "기한 변경",
};

export function DecisionCard({ card, onDecide }: { card: VmCard; onDecide: (cardId: string, approve: boolean) => Promise<void> }) {
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
          <div className="table-wrap">
            <table className="task-table">
              <thead><tr><th>작업</th><th>담당</th><th>선행 작업</th></tr></thead>
              <tbody>
                {card.tasks.map(t => (
                  <tr key={t.id}>
                    <td>{t.title}</td>
                    <td>{t.assigneeName}</td>
                    <td>{t.dependsOn.length ? t.dependsOn.map(d => card.tasks.find(x => x.id === d)?.title ?? d).join(", ") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
