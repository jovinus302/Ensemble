"use client";

import { useState } from "react";
import type { VmDecisionCard, VmMember } from "../lib/view-model";
import type { ActionResult, DecisionInput } from "./use-view-model";
import { DECISION_KIND_LABEL, deadlineDeltaLabel, decisionOptions } from "./work-view";

export type DecideRequest = (requestId: string, answer: DecisionInput) => Promise<ActionResult>;
type Mode = "idle" | "choose" | "edit";

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
 * 추천안을 맨 위에 강조하고(추천안은 이 블록에만 한 번 보인다), 아래에 나머지 선택지를 둔다.
 * 버튼은 [추천대로 진행] [다른 안 선택] [고쳐서 승인] [보류] 네 가지다.
 * 자유 답변형(answerMode "text", 예: Agent 질문의 missing_info)은 답 없이 진행할 수 없다: 추천대로 진행·다른 안 선택 대신
 * 답변 입력란과 [답변 보내기] [보류]만 둔다. 답 없이 승인하면 요청이 닫히고 Agent는 오지 않을 답을 기다리게 된다.
 * 답변형 카드의 선택지에 전달할 답(answerText)이 있으면 그 선택지를 바로 고르는 버튼으로 보이고(추천안을 강조하고 근거를 붙인다),
 * 그 아래에 직접 답하는 입력란을 그대로 둔다. answerText가 하나도 없으면(예전 서버) 입력란만 둔다.
 */
export function DecisionRequestCard({ card, members, onDecide }: { card: VmDecisionCard; members: VmMember[]; onDecide: DecideRequest }) {
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<Mode>("idle");
  const [choice, setChoice] = useState<string>("");
  const [text, setText] = useState("");
  const options = decisionOptions(card);
  const recommended = options.find(o => o.recommended);
  const others = options.filter(o => !o.recommended);
  const textMode = card.answerMode === "text";
  const answerChoices = textMode ? options.filter(o => o.answerText) : [];
  // 추천안이 답 버튼 중 하나면 그 버튼에 강조와 근거를 붙이고, 위쪽 추천 블록은 그리지 않는다(같은 안을 두 번 보이지 않는다).
  const recommendedIsChoice = answerChoices.some(o => o.recommended);
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

      {answerChoices.length > 0 && !recommendedIsChoice && (
        <p className="card-text">{card.recommendation.rationale}</p>
      )}
      {answerChoices.length > 0 && (
        <ul className="answer-choices" aria-label="고를 수 있는 답">
          {answerChoices.map(o => (
            <li key={o.optionId} className={`answer-choice${o.recommended ? " answer-choice-recommended" : ""}`}>
              <button type="button" className={o.recommended ? "btn-primary" : "btn-outlined"} disabled={pending}
                onClick={() => void send({ action: "choose", optionId: o.optionId })}>
                {o.recommended && <span className="badge badge-recommend">PM 추천</span>} {o.label}
              </button>
              {o.answerText !== o.label && <p className="small muted answer-choice-text">전달할 답: “{o.answerText}”</p>}
              {o.recommended && <p className="small answer-choice-why">{card.recommendation.rationale}</p>}
              {o.recommended && card.recommendation.evidence.length > 0 && (
                <ul className="evidence small">{card.recommendation.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
              )}
              {o.tradeoff && <p className="small muted decision-tradeoff">{o.tradeoff}</p>}
            </li>
          ))}
        </ul>
      )}

      {recommended && answerChoices.length === 0 && (
        <div className="recommendation" aria-label="PM 추천안">
          <div className="recommendation-head">
            <span className="badge badge-recommend">PM 추천</span>
            <strong className="recommendation-label">{recommended.label}</strong>
          </div>
          <p className="card-text">{card.recommendation.rationale}</p>
          {recommended.tradeoff && <p className="small muted decision-tradeoff">{recommended.tradeoff}</p>}
          {recommended.summary.length > 0 && <ul className="small decision-summary">{recommended.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>}
          {card.recommendation.evidence.length > 0 && (
            <ul className="evidence small">{card.recommendation.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
          )}
        </div>
      )}

      {!textMode && others.length > 0 && (
        <ul className="decision-options" aria-label="다른 선택지">
          {others.map(o => (
            <li key={o.optionId} className="decision-option">
              <div className="decision-option-head"><span className="task-title">{o.label}</span></div>
              {o.tradeoff && <p className="small muted decision-tradeoff">{o.tradeoff}</p>}
              {o.summary.length > 0 && <ul className="small decision-summary">{o.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>}
            </li>
          ))}
        </ul>
      )}

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
      {textMode ? (
        <form className="decision-form" onSubmit={e => { e.preventDefault(); if (text.trim()) void send({ action: "answer", text: text.trim() }); }}>
          <label className="field">{answerChoices.length > 0 ? "직접 답하기" : "답변"}<textarea className="decision-text" value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="Agent에게 그대로 전달돼요" required disabled={pending} /></label>
          <div className="card-actions decision-actions">
            <button type="button" className="btn-outlined" disabled={pending} onClick={() => void send({ action: "reject" })}>보류</button>
            <button type="submit" className="btn-primary" disabled={pending || !text.trim()}>답변 보내기</button>
          </div>
        </form>
      ) : mode === "idle" && (
        <div className="card-actions decision-actions">
          <button type="button" className="btn-outlined" disabled={pending} onClick={() => void send({ action: "reject" })}>보류</button>
          {canEdit && <button type="button" className="btn-outlined" disabled={pending} onClick={() => setMode("edit")}>고쳐서 승인</button>}
          <button type="button" className="btn-tonal" disabled={pending || others.length === 0} onClick={() => { setChoice(""); setMode("choose"); }}>다른 안 선택</button>
          <button type="button" className="btn-primary" disabled={pending} onClick={() => void send({ action: "approve", optionId: card.recommendation.optionId })}>추천대로 진행</button>
        </div>
      )}

      {card.bundled && card.bundled.length > 0 && (
        <details className="decision-bundle">
          <summary>같이 정할 결정 <span className="num">{card.bundled.length}</span>건 더</summary>
          <div className="decision-list">
            {card.bundled.map(b => <DecisionRequestCard key={b.id} card={b} members={members} onDecide={onDecide} />)}
          </div>
        </details>
      )}
    </section>
  );
}
