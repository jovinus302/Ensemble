"use client";
// 작업 흐름 B 소유: WORK CONTEXT 캔버스(레이어 열·연결선·분기)와 LOG. 기반 커밋은 목록형 최소 화면이다.
import type { VmWorkContext } from "../../lib/work-context-view-model";

export function ContextPane({ context }: { context: VmWorkContext }) {
  return (
    <aside className="context-pane" aria-label="WORK CONTEXT">
      <header className="context-head">
        <h2 className="context-title">WORK CONTEXT</h2>
        <span className="chip chip-plain num">{context.versionLabel}</span>
        {context.stageLabel && <span className="muted small">{context.stageLabel}</span>}
        <ul className="context-summary">
          {context.summary.map(s => <li key={s.label} data-tone={s.tone}>{s.label}{s.count !== undefined && <> <span className="num">{s.count}</span></>}</li>)}
        </ul>
      </header>
      <ul className="context-items">
        {context.items.map(item => (
          <li key={item.id} className="context-item" data-layer={item.layer} data-tone={item.tone}>
            {item.key && <span className="context-key">{item.key}</span>}
            <span className="context-item-title">{item.title}</span>
            {item.statusLabel && <span className="context-status">{item.statusLabel}</span>}
            {item.note && <span className="muted small">{item.note}</span>}
            <span className="context-source" title={item.source.name}>{item.source.initial}</span>
          </li>
        ))}
      </ul>
      <section className="context-log" aria-label="LOG">
        <h3 className="context-log-title">LOG</h3>
        <ol>{context.log.map(line => <li key={line.id}><time className="num">{line.at}</time> {line.kindLabel} · {line.text}</li>)}</ol>
      </section>
    </aside>
  );
}
