"use client";
// 작업 흐름 C: v1.0 → v1.1 변경 카드. 버튼은 결정권자에게만(canResolve), 닫힌 뒤에는 결과만 보인다.
import { useState } from "react";
import type { VmChangeSet } from "../../../lib/work-context-view-model";
import { changeSetView } from "./card-view";
import { ToneChip } from "./ToneChip";

export type ResolveChange = (changeSetId: string, outcome: "applied" | "reverted") => void | Promise<unknown>;

export function ChangeSetCard({ changeSet, onResolve }: { changeSet: VmChangeSet; onResolve?: ResolveChange }) {
  const view = changeSetView(changeSet);
  const [sending, setSending] = useState(false);
  const resolve = async (outcome: "applied" | "reverted") => {
    if (!onResolve || sending) return;
    setSending(true);
    try { await onResolve(changeSet.id, outcome); } finally { setSending(false); }
  };
  return (
    <section className="ctx-card ctx-change" data-status={changeSet.status} aria-label={view.title}>
      <p className="ctx-route-head"><strong className="num">{view.title}</strong> <ToneChip value={view.status} /></p>
      <p className="ctx-chips">{view.chips.map(c => <ToneChip key={c.text} value={c} />)}</p>
      {view.stale.length > 0 && <p className="ctx-stale"><span className="ctx-chip" data-tone="stale">갱신 대상</span> {view.stale.join(" · ")}</p>}
      {onResolve && view.actions.length > 0 && (
        <div className="ctx-actions">
          {view.actions.map(a => (
            <button key={a.outcome} type="button" className={a.outcome === "applied" ? "btn-primary btn-small" : "btn-text btn-small"} disabled={sending} aria-busy={sending || undefined} onClick={() => void resolve(a.outcome)}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
