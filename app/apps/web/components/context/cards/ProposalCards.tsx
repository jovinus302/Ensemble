// 작업 흐름 C: 인력 pool 후보, Proposal 요약, D/F/S/V 펼침 칩.
import type { VmContextItem, VmPoolCandidate, VmProposal } from "../../../lib/work-context-view-model";
import { expansionGroups, poolRow, proposalView } from "./card-view";
import { ToneChip } from "./ToneChip";

export function PoolCandidates({ candidates }: { candidates: VmPoolCandidate[] }) {
  return (
    <ul className="ctx-pool" aria-label="인력 pool 후보">
      {candidates.map(c => {
        const row = poolRow(c);
        return (
          <li key={c.candidateId} className="ctx-pool-row" data-joined={c.joined || undefined}>
            <span className="ctx-pool-avatar" aria-hidden>{row.initial}</span>
            <span className="ctx-pool-body"><strong>{row.name}</strong><span className="ctx-pool-detail">{row.detail}</span></span>
            <span className="ctx-chip" data-tone={row.status.tone} aria-live="polite">{!c.joined && c.invited && <span className="ctx-spin" aria-hidden />}{row.status.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function ProposalSummary({ proposal }: { proposal: VmProposal }) {
  const view = proposalView(proposal);
  return (
    <div className="ctx-route ctx-proposal" aria-label={view.title}>
      <p className="ctx-route-head"><strong>{view.title}</strong> <ToneChip value={view.status} /></p>
      <ul>
        {view.rows.map(r => (
          <li key={r.head + r.text}>
            <span className="ctx-route-text"><strong>{r.head}</strong> · {r.text}</span>
            <ToneChip value={r.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExpansionChips({ items }: { items: VmContextItem[] }) {
  return (
    <ul className="ctx-chips ctx-expansion" aria-label="결정 → 기능 → 화면 → 지표">
      {expansionGroups(items).map(g => (
        <li key={g.label} className="ctx-chip" data-tone={g.tone} title={g.keys.map(k => k.title).join("\n")}>
          {g.tone === "changed"
            ? g.keys.map(k => <span key={k.key} className="ctx-chip-key" data-tone={k.tone}>{k.key}</span>)
            : g.label}
        </li>
      ))}
    </ul>
  );
}
