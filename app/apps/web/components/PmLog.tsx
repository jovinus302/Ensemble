"use client";

import type { VmMember, VmMessage, VmPmJudgement } from "../lib/view-model";
import { formatTime } from "./format";

// PM이 말한 순간뿐 아니라 침묵한 순간과 그 이유도 함께 보여 준다.
export function PmLogPanel({ log, messages, members, onClose }: {
  log: VmPmJudgement[]; messages: VmMessage[]; members: VmMember[]; onClose: () => void;
}) {
  const order = new Map(messages.map((m, i) => [m.id, i]));
  const sorted = [...log].sort((a, b) => (order.get(a.triggerMessageId) ?? 0) - (order.get(b.triggerMessageId) ?? 0));
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
            return (
              <li key={`${j.triggerMessageId}-${i}`} className={`judgement judgement-${j.decision}`}>
                <div className="judgement-head">
                  <span className={`chip ${j.decision === "speak" ? "chip-done" : "chip-queued"}`}>
                    <span aria-hidden>{j.decision === "speak" ? "💬" : "🤫"}</span> {j.decision === "speak" ? "말함" : "침묵"}
                  </span>
                  {trigger && <time className="muted small num">{formatTime(trigger.at)}</time>}
                </div>
                {trigger && (
                  <p className="judgement-trigger">
                    <span className="muted">{nameOf(trigger.authorId)}:</span> {trigger.text}
                  </p>
                )}
                <p><strong>이유</strong> {j.reason}</p>
                <dl className="judgement-meta">
                  <dt>할 일이 있는 사람</dt><dd>{nameOf(j.whoseAction)}</dd>
                  <dt>이미 아는 사람</dt><dd>{j.alreadyKnows || "—"}</dd>
                </dl>
                {j.evidence.length > 0 && <ul className="evidence">{j.evidence.map((e, k) => <li key={k}><code>{e}</code></li>)}</ul>}
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
