"use client";

import { useEffect, useState } from "react";
import type { VmMember, VmRoadmap } from "../lib/view-model";
import { formatDate, statusInfo } from "./format";

const TONE_ICON = { done: "✓", working: "◐", needs: "✋", failed: "!", queued: "◷" } as const;

export function StatusChip({ status }: { status: string }) {
  const s = statusInfo(status);
  return <span className={`chip chip-${s.tone}`}><span aria-hidden>{TONE_ICON[s.tone]}</span> {s.label}</span>;
}

function ScheduleBars({ roadmap }: { roadmap: VmRoadmap }) {
  const tasks = roadmap.tasks.filter(t => t.startDay !== undefined);
  if (tasks.length === 0) return null;
  const span = Math.max(1, ...tasks.map(t => t.endDayMax ?? t.endDayMin ?? (t.startDay ?? 0) + 1));
  const pct = (d: number) => `${(d / span) * 100}%`;
  return (
    <div className="bars" role="img" aria-label="작업 일정 막대">
      {tasks.map(t => {
        const start = t.startDay ?? 0;
        const min = t.endDayMin ?? start + 1;
        const max = Math.max(min, t.endDayMax ?? min);
        const tone = statusInfo(t.status).tone;
        return (
          <div key={t.id} className="bar-row">
            <span className="bar-label">{t.title}</span>
            <div className="bar-track">
              <span className={`bar bar-${tone}`} style={{ left: pct(start), width: pct(min - start) }} />
              {max > min && <span className={`bar bar-range bar-${tone}`} style={{ left: pct(min), width: pct(max - min) }} />}
            </div>
            <span className="bar-days num">D{start}–{min === max ? max : `${min}~${max}`}</span>
          </div>
        );
      })}
      <div className="bar-legend"><span className="legend-solid" /> 예상 최소 <span className="legend-range" /> 늦어질 수 있는 범위</div>
    </div>
  );
}

function AvailabilityRow({ member, editable, onSave }: { member: VmMember; editable: boolean; onSave: (h: number) => Promise<void> }) {
  const [draft, setDraft] = useState(String(member.weeklyHours ?? ""));
  useEffect(() => { setDraft(String(member.weeklyHours ?? "")); }, [member.weeklyHours]);
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n) || n < 0 || n > 168) { setDraft(String(member.weeklyHours ?? "")); return; }
    if (n !== member.weeklyHours) void onSave(n);
  };
  return (
    <li className="avail-row">
      <span>{member.displayName}{editable && <span className="me-tag">나</span>}</span>
      {editable ? (
        <label className="avail-input">
          <input
            type="number" min={0} max={168} step={1} inputMode="numeric" value={draft}
            aria-label={`${member.displayName} 주간 가용 시간`}
            onChange={e => setDraft(e.target.value)} onBlur={commit}
            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          />
          <span>시간/주</span>
        </label>
      ) : (
        <span className="num muted">{member.weeklyHours !== undefined ? `${member.weeklyHours}시간/주` : "미입력"}</span>
      )}
    </li>
  );
}

export function RoadmapCard({ roadmap, deadline, members, me, onSetAvailability }: {
  roadmap: VmRoadmap; deadline?: string; members: VmMember[]; me: string;
  onSetAvailability: (memberId: string, weeklyHours: number) => Promise<void>;
}) {
  const f = roadmap.forecast;
  const late = f?.ok === true && (f.lateDaysMax ?? 0) > 0;
  const titleOf = (id: string) => roadmap.tasks.find(t => t.id === id)?.title ?? id;

  return (
    <div className="roadmap">
      <div className="roadmap-top">
        <span className="plan-version">{roadmap.planVersion === null ? "계획 없음" : `계획 v${roadmap.planVersion}`}</span>
        {roadmap.lastChange && <span className="muted small">마지막 변경 v{roadmap.lastChange.version}: {roadmap.lastChange.reason}</span>}
      </div>

      <section className={`forecast${late ? " forecast-late" : ""}`} aria-label="예상 종료">
        {f === null ? (
          <p className="muted">아직 예측할 계획이 없어요.</p>
        ) : f.ok ? (
          <>
            <div className="forecast-line">
              <span className="muted small">예상 종료</span>
              <strong className="num">{formatDate(f.finishMin)}{f.finishMax !== f.finishMin && ` – ${formatDate(f.finishMax)}`}</strong>
            </div>
            <div className="forecast-line">
              <span className="muted small">기한</span>
              <strong className="num">{formatDate(f.deadline ?? deadline) || "없음"}</strong>
            </div>
            {late && <p className="late-note"><span aria-hidden>⚠</span> 기한을 최대 {f.lateDaysMax}일 넘길 수 있어요</p>}
            {f.shortage.length > 0 && (
              <ul className="shortage">
                {f.shortage.map(s => <li key={s.memberName}>{s.memberName} <strong className="num">{s.hours}시간</strong> 부족</li>)}
              </ul>
            )}
          </>
        ) : (
          <>
            <p className="late-note"><span aria-hidden>?</span> 예상 날짜를 계산할 수 없어요</p>
            <ul className="reasons">{f.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </>
        )}
      </section>

      <section aria-label="작업 목록">
        <h3 className="section-label">작업</h3>
        <ul className="task-list">
          {roadmap.tasks.map(t => (
            <li key={t.id}>
              <span className="task-title">{t.title}</span>
              <span className="muted small">{t.assigneeName}</span>
              <StatusChip status={t.status} />
            </li>
          ))}
        </ul>
        <ScheduleBars roadmap={roadmap} />
      </section>

      {roadmap.blocked.length > 0 && (
        <section aria-label="막힌 작업">
          <h3 className="section-label">막힌 작업</h3>
          <ul className="blocked-list">
            {roadmap.blocked.map(b => (
              <li key={b.taskId}>
                <strong>{titleOf(b.taskId)}</strong> — {b.reason}
                {b.unblockByName && <span className="unblock">풀 사람: {b.unblockByName}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="주간 가용 시간">
        <h3 className="section-label">주간 가용 시간</h3>
        <ul className="avail-list">
          {members.filter(m => m.kind === "human").map(m => (
            <AvailabilityRow key={m.id} member={m} editable={m.id === me} onSave={h => onSetAvailability(m.id, h)} />
          ))}
        </ul>
      </section>
    </div>
  );
}
