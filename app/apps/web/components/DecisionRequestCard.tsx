"use client";

import { useState } from "react";
import type { VmDecisionCard, VmMember } from "../lib/view-model";
import type { ActionResult, DecisionInput } from "./use-view-model";
import { DECISION_KIND_LABEL, deadlineDeltaLabel, decisionOptions } from "./work-view";

export type DecideRequest = (requestId: string, answer: DecisionInput) => Promise<ActionResult>;
type Mode = "idle" | "choose" | "edit" | "answer";

const PRIORITY_LABEL = { high: "높음", normal: "보통", low: "낮음" } as const;

/** 고쳐서 승인: editable에 든 필드만 바꿀 수 있다. 바꾼 값만 edits로 보낸다. */
function EditForm({ card, members, pending, onSubmit, onCancel }: {
  card: VmDecisionCard; members: VmMember[]; pending: boolean;
  onSubmit: (edits: Record<string, unknown>) => void; onCancel: () => void;
}) {
  const fields = card.editable ?? [];
  const [assignee, setAssignee] = useState("");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("");
  const [include, setInclude] = useState<string[]>(card.impact.taskTitles);
  const submit = () => {
    const edits: Record<string, unknown> = {};
    if (fields.includes("assignee") && assignee) edits.assignee = assignee;
    if (fields.includes("title") && title.trim()) edits.title = title.trim();
    if (fields.includes("priority") && priority) edits.priority = priority;
    if (fields.includes("include")) edits.include = include;
    onSubmit(edits);
  };
  return (
    <form className="decision-form" onSubmit={e => { e.preventDefault(); submit(); }}>
      {fields.includes("title") && (
        <label className="field">작업 이름<input value={title} onChange={e => setTitle(e.target.value)} placeholder="바꿀 이름" disabled={pending} /></label>
      )}
      {fields.includes("assignee") && (
        <label className="field">담당
          <select value={assignee} onChange={e => setAssignee(e.target.value)} disabled={pending}>
            <option value="">그대로</option>
            {members.filter(m => m.kind !== "pm").map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
          </select>
        </label>
      )}
      {fields.includes("priority") && (
        <label className="field">우선순위
          <select value={priority} onChange={e => setPriority(e.target.value)} disabled={pending}>
            <option value="">그대로</option>
            {(["high", "normal", "low"] as const).map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </label>
      )}
      {fields.includes("include") && card.impact.taskTitles.length > 0 && (
        <fieldset className="decision-include">
          <legend className="small muted">포함할 작업</legend>
          {card.impact.taskTitles.map(t => (
            <label key={t} className="check">
              <input type="checkbox" checked={include.includes(t)} disabled={pending}
                onChange={e => setInclude(v => e.target.checked ? [...v, t] : v.filter(x => x !== t))} /> {t}
            </label>
          ))}
        </fieldset>
      )}
      <div className="card-actions">
        <button type="button" className="btn-text" onClick={onCancel} disabled={pending}>취소</button>
        <button type="submit" className="btn-primary" disabled={pending}>고친 내용으로 승인</button>
      </div>
    </form>
  );
}

/**
 * PM의 결정 요청 카드. 채널 인라인과 "내 결정" 탭이 같은 컴포넌트를 쓴다.
 * 추천안을 맨 위에 강조하고, 버튼은 [추천대로 진행] [다른 안 선택] [고쳐서 승인] [보류] 네 가지다.
 * 자유 답변형(missing_info)은 "고쳐서 승인" 자리에 "직접 답하기"가 온다.
 */
export function DecisionRequestCard({ card, members, onDecide }: { card: VmDecisionCard; members: VmMember[]; onDecide: DecideRequest }) {
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<Mode>("idle");
  const [choice, setChoice] = useState<string>("");
  const [text, setText] = useState("");
  const options = decisionOptions(card);
  const recommended = options.find(o => o.recommended);
  const others = options.filter(o => !o.recommended);
  const canEdit = card.answerMode === "choose" && (card.editable?.length ?? 0) > 0;
  const delta = deadlineDeltaLabel(card.impact.deadlineDeltaDays);

  const send = async (answer: DecisionInput) => {
    setPending(true);
    try { const result = await onDecide(card.id, answer); if (result.ok) setMode("idle"); }
    finally { setPending(false); }
  };

  return (
    <section className="card approval-card decision-card" aria-label={`결정 요청: ${card.question}`}>
      <header className="card-head">
        <span className="chip chip-needs"><span aria-hidden>✋</span> 내 결정 필요</span>
        <span className="chip chip-plain">{DECISION_KIND_LABEL[card.requestKind]}</span>
      </header>
      <h3 className="card-title">{card.question}</h3>

      {recommended && (
        <div className="recommendation" aria-label="PM 추천안">
          <div className="recommendation-head">
            <span className="badge badge-recommend">PM 추천</span>
            <strong className="recommendation-label">{recommended.label}</strong>
          </div>
          <p className="card-text">{card.recommendation.rationale}</p>
          {card.recommendation.evidence.length > 0 && (
            <ul className="evidence small">{card.recommendation.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
          )}
        </div>
      )}

      <ul className="decision-options" aria-label="선택지">
        {options.map(o => (
          <li key={o.optionId} className={`decision-option${o.recommended ? " option-recommended" : ""}`}>
            <div className="decision-option-head">
              <span className="task-title">{o.label}</span>
              {o.recommended && <span className="badge badge-recommend">추천</span>}
            </div>
            {o.tradeoff && <p className="small muted decision-tradeoff">{o.tradeoff}</p>}
            {o.summary.length > 0 && <ul className="small decision-summary">{o.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>}
          </li>
        ))}
      </ul>

      {(card.impact.taskTitles.length > 0 || card.impact.blockedTitles.length > 0 || delta) && (
        <dl className="decision-impact small">
          {card.impact.taskTitles.length > 0 && <><dt>관련 작업</dt><dd>{card.impact.taskTitles.join(", ")}</dd></>}
          {card.impact.blockedTitles.length > 0 && <><dt>멈춘 작업</dt><dd>{card.impact.blockedTitles.join(", ")}</dd></>}
          {delta && <><dt>일정</dt><dd>{delta}</dd></>}
        </dl>
      )}

      {mode === "choose" && (
        <form className="decision-form" onSubmit={e => { e.preventDefault(); if (choice) void send({ action: "choose", optionId: choice }); }}>
          <fieldset className="decision-choose">
            <legend className="small muted">다른 안</legend>
            {others.map(o => (
              <label key={o.optionId} className="check">
                <input type="radio" name={`choice-${card.id}`} value={o.optionId} checked={choice === o.optionId} disabled={pending} onChange={() => setChoice(o.optionId)} /> {o.label}
              </label>
            ))}
          </fieldset>
          <div className="card-actions">
            <button type="button" className="btn-text" onClick={() => setMode("idle")} disabled={pending}>취소</button>
            <button type="submit" className="btn-primary" disabled={pending || !choice}>이 안으로 진행</button>
          </div>
        </form>
      )}
      {mode === "edit" && (
        <EditForm card={card} members={members} pending={pending}
          onSubmit={edits => void send({ action: "edit", optionId: card.recommendation.optionId, edits })} onCancel={() => setMode("idle")} />
      )}
      {mode === "answer" && (
        <form className="decision-form" onSubmit={e => { e.preventDefault(); if (text.trim()) void send({ action: "answer", text: text.trim() }); }}>
          <label className="field">답변<textarea className="decision-text" value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="Agent에게 그대로 전달돼요" disabled={pending} /></label>
          <div className="card-actions">
            <button type="button" className="btn-text" onClick={() => setMode("idle")} disabled={pending}>취소</button>
            <button type="submit" className="btn-primary" disabled={pending || !text.trim()}>답변 보내기</button>
          </div>
        </form>
      )}

      {mode === "idle" && (
        <div className="card-actions decision-actions">
          <button type="button" className="btn-outlined" disabled={pending} onClick={() => void send({ action: "reject" })}>보류</button>
          {card.answerMode === "text"
            ? <button type="button" className="btn-outlined" disabled={pending} onClick={() => setMode("answer")}>직접 답하기</button>
            : canEdit && <button type="button" className="btn-outlined" disabled={pending} onClick={() => setMode("edit")}>고쳐서 승인</button>}
          <button type="button" className="btn-tonal" disabled={pending || others.length === 0} onClick={() => { setChoice(""); setMode("choose"); }}>다른 안 선택</button>
          <button type="button" className="btn-primary" disabled={pending} onClick={() => void send({ action: "approve", optionId: card.recommendation.optionId })}>추천대로 진행</button>
        </div>
      )}
    </section>
  );
}
