// 작업 흐름 C: 분기 A/B 카드와 "A로 가면?" 예상 카드.
import type { VmContextBranch } from "../../../lib/work-context-view-model";
import { branchOptionState, branchPreviewView, branchSummary } from "./card-view";
import { ToneChip } from "./ToneChip";

export function BranchOptionsCard({ branch }: { branch: VmContextBranch }) {
  const summary = branchSummary(branch);
  return (
    <section className="ctx-card ctx-branch" aria-label={branch.key ? `분기 ${branch.key} · ${branch.question}` : `분기 · ${branch.question}`}>
      <ul className="ctx-options">
        {branch.options.map(o => (
          <li key={o.optionId} className="ctx-option" data-state={branchOptionState(branch, o.optionId)}>
            <span className="ctx-option-id">{o.optionId}</span>
            <span className="ctx-option-body">
              <span className="ctx-option-title">{o.title}</span>
              {(o.gains.length > 0 || o.risks.length > 0) && <span className="ctx-option-meta">{[...o.gains, ...o.risks].join(" · ")}</span>}
            </span>
            {o.chosen && <span className="ctx-chip" data-tone="ok">선택</span>}
          </li>
        ))}
      </ul>
      <p className="ctx-foot"><ToneChip value={summary} /></p>
    </section>
  );
}

export function BranchPreviewCard({ branch, optionId }: { branch: VmContextBranch; optionId: string }) {
  const view = branchPreviewView(branch, optionId);
  return (
    <section className="ctx-card ctx-branch-preview" data-open={view.open || undefined} aria-label={view.title}>
      <p className="ctx-foot"><ToneChip value={view.status} /></p>
      {view.effects.length > 0 && <ul className="ctx-effects">{view.effects.map(e => <li key={e}>{e}</li>)}</ul>}
      {view.open && view.chips.length > 0 && <p className="ctx-chips">{view.chips.map(c => <ToneChip key={c.text} value={c} />)}</p>}
    </section>
  );
}
