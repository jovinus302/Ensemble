"use client";

import type { VmMember, VmMessage, VmPmJudgement } from "../lib/view-model";
import { formatTime } from "./format";

// PM이 말한 순간뿐 아니라 침묵한 순간과 그 이유도 함께 보여 준다.
export function PmLogPanel({ log, messages, members, onClose }: {
  log: VmPmJudgement[]; messages: VmMessage[]; members: VmMember[]; onClose: () => void;
}) {
  // 판단 시각이 있으면 시간순, 없으면 계기 메시지 순서. 둘 다 없으면 서버가 준 기록 순서를 지킨다.
  const order = new Map(messages.map((m, i) => [m.id, i]));
  const sorted = log.map((j, i) => ({ j, i })).sort((a, b) => {
    if (a.j.at && b.j.at) return Date.parse(a.j.at) - Date.parse(b.j.at) || a.i - b.i;
    const x = order.get(a.j.triggerMessageId), y = order.get(b.j.triggerMessageId);
    return x !== undefined && y !== undefined ? x - y || a.i - b.i : a.i - b.i;
  }).map(({ j }) => j);
  const nameOf = (id: string | null) => (id === null ? "없음" : members.find(m => m.id === id)?.displayName ?? id);

  return (
    <aside className="pm-log" aria-label="PM 판단 기록">
      <header className="pm-log-head">
        <h2>PM 판단 기록</h2>
        <button type="button" className="icon-btn" aria-label="닫기" onClick={onClose}>×</button>
      </header>
      {sorted.length === 0 ? (
        <p className="muted">아직 판단 기록이 없어요.</p>
      ) : (
        <ol className="pm-log-list">
          {sorted.map((j, i) => {
            const trigger = messages.find(m => m.id === j.triggerMessageId);
            const at = j.at ?? trigger?.at;
            const evidence = j.evidence.filter(e => e !== j.triggerLabel);
            return (
              <li key={`${j.triggerMessageId}-${i}`} className={`judgement judgement-${j.decision}`}>
                <div className="judgement-head">
                  <span className={`chip ${j.decision === "speak" ? "chip-done" : "chip-queued"}`}>
                    <span aria-hidden>{j.decision === "speak" ? "💬" : "🤫"}</span> {j.decision === "speak" ? "말함" : "침묵"}
                  </span>
                  {at && <time className="muted small num" dateTime={at}>{formatTime(at)}</time>}
                </div>
                {trigger ? (
                  <p className="judgement-trigger">
                    <span className="muted">{nameOf(trigger.authorId)}:</span> {trigger.text}
                  </p>
                ) : j.triggerLabel ? (
                  <p className="judgement-trigger"><span className="muted">계기:</span> {j.triggerLabel}</p>
                ) : null}
                {j.spokenText && <p className="judgement-spoken"><span className="muted">PM:</span> {j.spokenText}</p>}
                <p><strong>이유</strong> {j.reason}</p>
                <dl className="judgement-meta">
                  <dt>할 일이 있는 사람</dt><dd>{nameOf(j.whoseAction)}</dd>
                  <dt>이미 아는가</dt><dd>{j.alreadyKnows || "—"}</dd>
                </dl>
                {evidence.length > 0 && <ul className="evidence">{evidence.map((e, k) => <li key={k}>{e}</li>)}</ul>}
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
