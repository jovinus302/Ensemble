"use client";
// 작업 흐름 B 소유: WORK CONTEXT 캔버스(레이어 열·연결선·분기)와 LOG.
import { useMemo } from "react";
import type { VmWorkContext } from "../../lib/work-context-view-model";
import { CanvasGraph } from "./canvas/CanvasGraph";
import { CompactItem } from "./canvas/CanvasNode";
import { ContextLog } from "./canvas/ContextLog";
import { canvasLayout } from "./canvas/layout";

export function ContextPane({ context }: { context: VmWorkContext }) {
  const layout = useMemo(() => canvasLayout(context), [context]);
  const foldedSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of layout.folded) { const label = item.layerLabel.replace(/[[\]]/g, ""); counts.set(label, (counts.get(label) ?? 0) + 1); }
    return [...counts].map(([label, n]) => `${label} ${n}`).join(" · ");
  }, [layout.folded]);
  return (
    <aside className="context-pane" aria-label="WORK CONTEXT">
      <header className="cv-head">
        <div className="cv-title-row">
          <h2 className="cv-title">WORK CONTEXT</h2>
          <span className="chip chip-plain num">{context.versionLabel}</span>
          {context.stageLabel && <span className="cv-stage">{context.stageLabel}</span>}
        </div>
        <ul className="cv-summary" aria-label="요약">
          {context.summary.map(s => (
            <li key={s.label} className="cv-chip" data-tone={s.tone}>
              <span className="cv-dot" aria-hidden="true" />{s.label}{s.count !== undefined && <span className="num">{s.count}</span>}
            </li>
          ))}
        </ul>
      </header>
      {layout.columns.length === 0
        ? <p className="cv-empty muted">아직 대화에서 읽어 낸 맥락이 없습니다. 대화가 이어지면 PM이 의도·결정·기능·화면을 여기에 올립니다.</p>
        : <CanvasGraph columns={layout.columns} edges={layout.edges} />}
      {layout.folded.length > 0 && (
        <details className="cv-folded">
          <summary>정렬한 맥락 · {foldedSummary}</summary>
          <ul className="cv-folded-nodes">{layout.folded.map(item => <li key={item.id}><CompactItem item={item} /></li>)}</ul>
        </details>
      )}
      <ContextLog lines={context.log} />
    </aside>
  );
}
