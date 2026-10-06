"use client";
// 작업 흐름 C 소유: 채팅 메시지 안의 WORK CONTEXT 카드. 기반 커밋은 종류별 최소 화면이다.
import type { VmContextCard } from "../../lib/work-context-view-model";

export function ContextMessageCard({ card, onResolveChange }: { card: VmContextCard; onResolveChange?: (changeSetId: string, outcome: "applied" | "reverted") => void }) {
  switch (card.kind) {
    case "branch_options": case "branch_preview":
      return <ul className="ctx-card ctx-branch">{card.branch.options.map(o => <li key={o.optionId} data-chosen={o.chosen || undefined}><strong>{o.optionId}</strong> {o.title}</li>)}</ul>;
    case "pm_steps":
      return (
        <div className="ctx-card ctx-steps">
          <span className="chip chip-plain">{card.label}</span> {card.steps.join(" → ")}
          {card.candidates && <ul>{card.candidates.map(c => <li key={c.candidateId}>{c.name} · {c.role} · {c.note}</li>)}</ul>}
          {card.proposal && <p>Proposal v{card.proposal.version}</p>}
        </div>
      );
    case "pool_candidates":
      return <ul className="ctx-card ctx-pool">{card.candidates.map(c => <li key={c.candidateId}>{c.name} · {c.role}</li>)}</ul>;
    case "proposal":
      return <div className="ctx-card ctx-proposal">Proposal v{card.proposal.version} · {card.proposal.screens.join(" · ")}</div>;
    case "expansion":
      return <ul className="ctx-card ctx-expansion">{card.items.map(i => <li key={i.id}>{i.key ?? i.title}</li>)}</ul>;
    case "tool_handoffs": case "build":
      return <ul className="ctx-card ctx-handoffs">{card.handoffs.map(h => <li key={h.id}>{h.toolName} · {h.title} · {h.statusLabel}</li>)}</ul>;
    case "change_set":
      return (
        <div className="ctx-card ctx-change">
          v{card.changeSet.fromVersion} → v{card.changeSet.toVersion} · {card.changeSet.changes.map(c => c.key ?? c.title).join(" · ")}
          {card.changeSet.canResolve && onResolveChange && (
            <span className="ctx-change-actions">
              <button type="button" className="btn-tonal btn-small" onClick={() => onResolveChange(card.changeSet.id, "applied")}>변경 적용 · v{card.changeSet.toVersion}</button>
              <button type="button" className="btn-text btn-small" onClick={() => onResolveChange(card.changeSet.id, "reverted")}>되돌리기</button>
            </span>
          )}
        </div>
      );
  }
}
