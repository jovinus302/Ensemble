"use client";

import type { VmAutoStart, VmResultSource } from "../lib/view-model";
import { autoStartLine } from "./format";

/** 담당이 사람인지 Agent인지 한눈에: 작업 카드·일정·계획 카드가 같은 배지를 쓴다. */
export function AssigneeKindBadge({ kind }: { kind?: "human" | "agent" }) {
  if (!kind) return null;
  return kind === "agent"
    ? <span className="badge badge-kind badge-kind-agent" title="Agent가 맡은 작업"><span aria-hidden>🤖</span> Agent</span>
    : <span className="badge badge-kind badge-kind-human" title="사람이 맡은 작업"><span aria-hidden>👤</span> 사람</span>;
}

/** 결과가 들어온 경로("IDE · 김상성의 Coding Agent")와 결과 링크. via가 없으면 출처 칩을 그리지 않는다. */
export function ResultSourceLine({ source, compact }: { source: VmResultSource; compact?: boolean }) {
  if (!source.via && source.links.length === 0) return null;
  return (
    <span className={`result-source${compact ? " result-source-compact" : ""}`}>
      {source.via && <span className="via-chip" title="결과가 들어온 경로"><span aria-hidden>↗</span> {source.via.label}</span>}
      {!compact && source.links.map(l => (
        <a key={l.url} className="result-link" href={l.url} target="_blank" rel="noreferrer noopener"><span aria-hidden>🔗</span> {l.name}</a>
      ))}
    </span>
  );
}

/** "T-1 확인 → T-2 자동 시작": PM이 선행 작업 확인으로 다음 작업을 스스로 맡긴 사실. */
export function AutoStartNote({ auto }: { auto: VmAutoStart }) {
  return (
    <div className="autostart-note small" role="note">
      <span className="chip chip-done">자동 인계</span>
      <span>{autoStartLine(auto)}</span>
    </div>
  );
}
