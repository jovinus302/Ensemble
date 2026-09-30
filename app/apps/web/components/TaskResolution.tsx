"use client";

import { useState } from 'react';
import type { ActionResult } from './use-view-model';
export type ResolveTask = (taskId: string, action: 'accept' | 'retry' | 'recheck', note?: string) => Promise<ActionResult>;

export function ScopeLists({ exclusions, limits }: { exclusions?: string[]; limits?: string[] }) {
  return <>{!!exclusions?.length && <ul className="small">{exclusions.map((s, i) => <li key={i}>제외: {s}</li>)}</ul>}{!!limits?.length && <ul className="small">{limits.map((s, i) => <li key={i}>범위: {s}</li>)}</ul>}</>;
}

export function TaskResolution({ task, onResolve }: { task: { taskId: string; actions: ('accept' | 'retry' | 'recheck')[] }; onResolve: ResolveTask }) {
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const resolve = async (action: 'accept' | 'retry' | 'recheck') => {
    setPending(true);
    try { const result = await onResolve(task.taskId, action, note); if (result.ok) { setEditing(false); setNote(''); } }
    finally { setPending(false); }
  };
  if (!task.actions.length) return null;
  return <div className="activity-actions">
    {task.actions.includes('accept') && <button type="button" disabled={pending} className="btn-tonal btn-small" onClick={() => void resolve('accept')}>이대로 확인</button>}
    {task.actions.includes('retry') && <button type="button" disabled={pending} className="btn-outlined btn-small" onClick={() => setEditing(!editing)}>다시 맡기기</button>}
    {task.actions.includes('recheck') && <button type="button" disabled={pending} className="btn-outlined btn-small" onClick={() => void resolve('recheck')}>다시 검토</button>}
    {editing && <form onSubmit={e => { e.preventDefault(); void resolve('retry'); }}>
      <label>보완 메모 <input value={note} onChange={e => setNote(e.target.value)} disabled={pending} placeholder="어떻게 보완하면 될까요?" /></label>
      <button type="submit" disabled={pending} className="btn-primary btn-small">메모와 함께 맡기기</button>
    </form>}
  </div>;
}
