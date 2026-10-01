"use client";

import { useRef, useState, type FormEvent } from "react";

export function FreeStart({ onStart, onCancel }: { onStart: (goal: string, deadline?: string) => Promise<void>; onCancel?: () => void }) {
  const [goal, setGoal] = useState("");
  const [deadline, setDeadline] = useState("");
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!goal.trim() || submitting.current) return;
    submitting.current = true;
    setPending(true);
    try {
      // 날짜 입력은 서울 기준 그날 자정으로 보낸다.
      await onStart(goal.trim(), deadline ? `${deadline}T00:00:00+09:00` : undefined);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  return (
    <div className="free-start">
      <form className="card free-card" onSubmit={submit}>
        <h2 className="free-title">새 프로젝트 시작</h2>
        <p className="muted">목표와 기한을 적으면 PM이 첫 계획을 제안해요.</p>
        <label className="field">
          <span>목표</span>
          <input value={goal} onChange={e => setGoal(e.target.value)} placeholder="예: 2주 안에 고객 반응 확인" required />
        </label>
        <label className="field">
          <span>기한 (선택)</span>
          <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} />
        </label>
        <div className="card-actions">
          {onCancel && <button type="button" className="btn-text" onClick={onCancel}>취소</button>}
          <button type="submit" className="btn-primary" disabled={pending || !goal.trim()}>시작</button>
        </div>
      </form>
    </div>
  );
}
