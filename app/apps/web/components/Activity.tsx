"use client";

import { useEffect, useState } from "react";
import type { VmActivity } from "../lib/view-model";
import { formatElapsed } from "./format";
import type { ActionResult } from "./use-view-model";
import { TaskResolution, type ResolveTask } from './TaskResolution';

/** 서버가 지금 하는 일을 채널 아래 한 줄로. 멈췄으면 이유와 다시 시도·건너뛰기를 보여 준다. */
export function ActivityLine({ activity, busy, onRetry, onSkip, onResolve }: {
  activity?: VmActivity; busy: boolean; onRetry: () => Promise<ActionResult>; onSkip: () => Promise<ActionResult>;
  onResolve?: ResolveTask;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState(false);
  const ticking = !!activity && (activity.kind !== "idle" || !!activity.stalled);
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking, activity?.since]);

  const since = activity ? Date.parse(activity.since) : NaN;
  const elapsed = Number.isFinite(since) ? formatElapsed(now - since) : null;
  const act = async (fn: () => Promise<ActionResult>) => { setPending(true); try { await fn(); } finally { setPending(false); } };

  if (activity?.stalled) {
    const { reason, canRetry, canSkip } = activity.stalled;
    return (
      <div className="activity activity-stalled" role="alert">
        <span className="activity-text"><span aria-hidden>⚠</span> {reason}{elapsed && <span className="muted num"> · {elapsed}째</span>}</span>
        {onResolve && activity.stalled.tasks?.map(task => <div key={task.taskId}><span className="small">{task.title}</span><TaskResolution task={task} onResolve={onResolve} /></div>)}
        {(canRetry || canSkip) && (
          <span className="activity-actions">
            {canRetry && <button type="button" className="btn-tonal btn-small" disabled={pending} onClick={() => void act(onRetry)}>다시 시도</button>}
            {canSkip && <button type="button" className="btn-outlined btn-small" disabled={pending} onClick={() => void act(onSkip)}>건너뛰기</button>}
          </span>
        )}
      </div>
    );
  }
  if (activity && activity.kind !== "idle") {
    const label = /[….]$/.test(activity.label) ? activity.label : `${activity.label}…`;
    return (
      <div className="activity" role="status">
        <span className="shimmer" aria-hidden /> <span className="activity-text">{label}{elapsed && <span className="muted num"> · {elapsed}</span>}</span>
      </div>
    );
  }
  // 서버가 activity를 아직 주지 않으면 예전 busy 표시로 대신한다.
  if (!activity && busy) {
    return <div className="activity" role="status"><span className="shimmer" aria-hidden /> <span className="activity-text">PM·Agent가 처리 중…</span></div>;
  }
  return null;
}
