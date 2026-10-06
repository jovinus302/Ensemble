"use client";
// 작업 흐름 C 소유: 채팅 메시지 안의 WORK CONTEXT 카드 9종. 서버가 지금 원장 상태로 풀어 준 카드만 그린다.
import type { VmContextCard } from "../../lib/work-context-view-model";
import { BranchOptionsCard, BranchPreviewCard } from "./cards/BranchCards";
import { buildView, stepsView } from "./cards/card-view";
import { ChangeSetCard, type ResolveChange } from "./cards/ChangeSetCard";
import { HandoffRows } from "./cards/HandoffCards";
import { ExpansionChips, PoolCandidates, ProposalSummary } from "./cards/ProposalCards";
import { StepStrip } from "./cards/ToneChip";

export function ContextMessageCard({ card, onResolveChange }: { card: VmContextCard; onResolveChange?: ResolveChange }) {
  switch (card.kind) {
    case "branch_options":
      return <BranchOptionsCard branch={card.branch} />;
    case "branch_preview":
      return <BranchPreviewCard branch={card.branch} optionId={card.optionId} />;
    case "pm_steps":
      return (
        <section className="ctx-card ctx-steps-card" aria-label={card.label}>
          <StepStrip {...stepsView(card)} />
          {card.candidates && card.candidates.length > 0 && <PoolCandidates candidates={card.candidates} />}
          {card.proposal && <ProposalSummary proposal={card.proposal} />}
        </section>
      );
    case "pool_candidates":
      return <section className="ctx-card" aria-label="인력 pool 후보"><PoolCandidates candidates={card.candidates} /></section>;
    case "proposal":
      return <section className="ctx-card"><ProposalSummary proposal={card.proposal} /></section>;
    case "expansion":
      return <section className="ctx-card" aria-label="펼친 항목"><ExpansionChips items={card.items} /></section>;
    case "tool_handoffs":
      return <section className="ctx-card" aria-label="제작 도구 전달"><HandoffRows handoffs={card.handoffs} mode="handoff" /></section>;
    case "build": {
      const view = buildView(card);
      return (
        <section className="ctx-card ctx-build" aria-label={view.version}>
          <div className="ctx-build-head">
            <StepStrip label={view.label} steps={view.steps} done={card.handoffs.every(h => h.status === "done")} />
            <span className="ctx-chip" data-tone="ok">{view.version}</span>
          </div>
          <HandoffRows handoffs={card.handoffs} mode="build" />
        </section>
      );
    }
    case "change_set":
      return <ChangeSetCard changeSet={card.changeSet} onResolve={onResolveChange} />;
  }
}
