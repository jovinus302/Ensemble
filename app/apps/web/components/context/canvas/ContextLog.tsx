"use client";
// 작업 흐름 B 소유: LOG — "10:45 누락 · …" 한 줄씩, 최신이 위. 시각은 서울 기준(format.ts).
import type { VmContextLogLine, VmContextTone } from "../../../lib/work-context-view-model";
import { formatTime } from "../../format";

const KIND_TONE: Record<string, VmContextTone> = {
  충돌: "conflict", 위반: "violation", 미정: "undecided", 누락: "missing", 분기: "branch", 검토: "info", 호출: "info",
  전달: "info", 재전달: "changed", 추가: "changed", 갱신: "changed", 낡음: "stale", 제외: "excluded", 되돌림: "stale",
};
const toneOf = (kindLabel: string): VmContextTone => KIND_TONE[kindLabel] ?? KIND_TONE[kindLabel.split(" · ")[0]!] ?? "ok";

export function ContextLog({ lines }: { lines: VmContextLogLine[] }) {
  return (
    <section className="cv-log" aria-label="LOG">
      <header className="cv-log-head">
        <h3 className="cv-log-title">LOG</h3>
        {lines[0] && <time className="num muted" dateTime={lines[0].at}>{formatTime(lines[0].at)}</time>}
      </header>
      {lines.length === 0 ? <p className="muted small">아직 기록이 없습니다.</p> : (
        <ol className="cv-log-lines">
          {lines.map(line => (
            <li key={line.id} data-tone={toneOf(line.kindLabel)}>
              <time className="num" dateTime={line.at}>{formatTime(line.at)}</time>{" "}
              <span className="cv-log-kind">{line.kindLabel}</span> · <span className="cv-log-text">{line.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
