"use client";

import { useEffect, useRef, useState } from "react";
import type { VmMember, VmRoadmap, VmRoadmapTask } from "../lib/view-model";
import { availabilityLabel, formatDate, formatDays, formatHourRange, formatHours, spanLabel, statusInfo } from "./format";
import type { ActionResult } from "./use-view-model";

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
            <span className="bar-label" title={t.title}>{t.title}{t.stopped && ' · 멈춤'}</span>
            <span className="bar-days num">{spanLabel(roadmap.origin, start, min, max)}</span>
            <div className="bar-track">
              <span className={`bar bar-${tone}`} style={{ left: pct(start), width: pct(Math.max(min - start, 0)) }} />
              {max > min && <span className={`bar bar-range bar-${tone}`} style={{ left: pct(min), width: pct(max - min) }} />}
            </div>
          </div>
        );
      })}
      <div className="bar-legend"><span className="legend-solid" /> 예상 최소 <span className="legend-range" /> 늦어질 수 있는 범위</div>
    </div>
  );
}

type SaveState = "idle" | "saving" | "saved" | "failed";

function AvailabilityRow({ member, editable, onSave }: { member: VmMember; editable: boolean; onSave: (h: number) => Promise<ActionResult> }) {
  const [draft, setDraft] = useState(String(member.weeklyHours ?? ""));
  const [save, setSave] = useState<SaveState>("idle");
  const inFlight = useRef<number | null>(null);
  useEffect(() => { setDraft(String(member.weeklyHours ?? "")); }, [member.weeklyHours]);
  useEffect(() => {
    if (save !== "saved") return;
    const timer = setTimeout(() => setSave("idle"), 2500);
    return () => clearTimeout(timer);
  }, [save]);
  // Enter와 칸 벗어남이 겹쳐도 같은 값은 한 번만 저장한다.
  const commit = async () => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n) || n < 0 || n > 168) { setDraft(String(member.weeklyHours ?? "")); return; }
    if (n === member.weeklyHours || n === inFlight.current) return;
    inFlight.current = n; setSave("saving");
    try {
      const result = await onSave(n);
      setSave(result.ok ? "saved" : "failed");
    } finally { inFlight.current = null; }
  };
  return (
    <li className="avail-row">
      <span>
        {member.displayName}{editable && <span className="me-tag">나</span>}
        {editable && member.weeklyHoursThisWeek !== undefined && <span className="avail-week">{availabilityLabel(member.weeklyHours, member.weeklyHoursThisWeek)}</span>}
      </span>
      {editable ? (
        <span className="avail-edit">
          <span className={`save-state save-${save}`} role="status" aria-live="polite">
            {save === "saving" ? "저장 중…" : save === "saved" ? "✓ 저장됨" : save === "failed" ? "저장 못 함" : ""}
          </span>
          <label className="avail-input">
            <input
              type="number" min={0} max={168} step={0.5} inputMode="decimal" value={draft}
              aria-label={`${member.displayName} 기본 주간 가용 시간`}
              onChange={e => { setDraft(e.target.value); if (save !== "saving") setSave("idle"); }}
              onBlur={() => void commit()}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void commit(); } }}
            />
            <span>시간/주</span>
          </label>
        </span>
      ) : (
        <span className="num muted">{availabilityLabel(member.weeklyHours, member.weeklyHoursThisWeek)}</span>
      )}
    </li>
  );
}

function TaskRow({ task }: { task: VmRoadmapTask }) {
  const conditions = task.handoffConditions ?? [];
  return (
    <li>
      <div className="task-row">
        <span className="task-title">{task.title}</span>
        <span className="muted small">{task.assigneeName}</span>
        <StatusChip status={task.status} />
        {task.stopped && <span className="chip chip-failed">멈춤</span>}
      </div>
      {(task.hours || conditions.length > 0) && (
        <details className="task-details small">
          <summary>{task.hours ? `추정 ${formatHourRange(task.hours.min, task.hours.max)}` : "자세히"}{conditions.length > 0 ? ` · 인계 조건 ${conditions.length}개` : ""}</summary>
          {conditions.length > 0 && <ul>{conditions.map((c, i) => <li key={i}>{c}</li>)}</ul>}
        </details>
      )}
    </li>
  );
}

export function RoadmapCard({ roadmap, deadline, members, me, onSetAvailability }: {
  roadmap: VmRoadmap; deadline?: string; members: VmMember[]; me: string;
  onSetAvailability: (memberId: string, weeklyHours: number) => Promise<ActionResult>;
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
        {f?.uncertainty && <p className="late-note" role="alert">⚠ {f.uncertainty.warning} ({f.uncertainty.stoppedTaskIds.map(titleOf).join(', ')})</p>}
        {f === null ? (
          <p className="muted">아직 예측할 계획이 없어요.</p>
        ) : f.ok ? (
          <>
            <div className="forecast-line">
              <span className="muted small">{f.uncertainty ? '멈춤 해소 후 예상 종료' : '예상 종료'}</span>
              <strong className="num">{formatDate(f.finishMin)}{formatDate(f.finishMax) !== formatDate(f.finishMin) && ` – ${formatDate(f.finishMax)}`}</strong>
            </div>
            <div className="forecast-line">
              <span className="muted small">기한</span>
              <strong className="num">{formatDate(f.deadline ?? deadline) || "없음"}</strong>
            </div>
            {late && <p className="late-note"><span aria-hidden>⚠</span> 기한을 최대 {formatDays(f.lateDaysMax ?? 0)} 넘길 수 있어요</p>}
            {f.shortage.length > 0 && (
              <ul className="shortage">
                {f.shortage.map(s => <li key={s.memberName}>{s.memberName} <strong className="num">{formatHours(s.hours)}</strong> 부족</li>)}
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
          {roadmap.tasks.map(t => <TaskRow key={t.id} task={t} />)}
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
