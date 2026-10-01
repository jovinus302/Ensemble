"use client";

import { useEffect, useState } from "react";
import type { VmMember, VmMessage, VmTaskDetail, VmWorkItem } from "../lib/view-model";
import { formatDate, formatTime } from "./format";
import { Avatar } from "./Message";
import { ScopeLists, TaskResolution, type ResolveTask } from "./TaskResolution";
import type { ActionResult, LoadTaskResult } from "./use-view-model";
import { WorkStatusChip } from "./WorkPanel";
import { waitingLabel } from "./work-view";

function when(iso: string): string {
  return `${formatDate(iso)} ${formatTime(iso)}`.trim();
}

/**
 * 작업 상세 서랍: 담당·라우팅 사유, 완료 조건, 범위, PM이 정리한 맥락, 출처, 활동 기록, 댓글.
 * 활동·댓글은 상태 폴링에 없으므로 열 때 `loadTask`로 가져온다. 그 전에는 작업 패널의 항목으로 먼저 그린다.
 */
export function WorkItemDetail({ taskId, items, members, me, messages, onClose, onLoad, onComment, onOpenTask, onJumpToMessage, onResolve }: {
  taskId: string; items: VmWorkItem[]; members: VmMember[]; me: string; messages: VmMessage[];
  onClose: () => void; onLoad: (taskId: string) => Promise<LoadTaskResult>;
  onComment: (taskId: string, text: string) => Promise<ActionResult>;
  onOpenTask: (taskId: string) => void; onJumpToMessage: (messageId: string) => void; onResolve?: ResolveTask;
}) {
  const [detail, setDetail] = useState<VmTaskDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    setLoadError(null);
    void onLoad(taskId).then(r => {
      if (!live) return;
      if (r.ok) setDetail(r.detail); else setLoadError(r.message);
    });
    return () => { live = false; };
  }, [taskId, onLoad, reload]);
  useEffect(() => { setDetail(null); setDraft(""); }, [taskId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const item = (detail?.item.id === taskId ? detail.item : undefined) ?? items.find(i => i.id === taskId);
  const nameOf = (id: string) => id === "pm" ? "PM" : members.find(m => m.id === id)?.displayName ?? "알 수 없음";
  const byId = new Map(items.map(i => [i.id, i]));
  const sourceText = (id: string) => messages.find(m => m.id === id)?.text;

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      const result = await onComment(taskId, text);
      if (result.ok) { setDraft(""); setReload(n => n + 1); }
    } finally { setSending(false); }
  };

  return (
    <div className="drawer-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={item ? `작업 상세: ${item.title}` : "작업 상세"}>
        <header className="drawer-head">
          <div className="drawer-title-wrap">
            {item?.parentId && byId.get(item.parentId) && (
              <button type="button" className="link-btn small" onClick={() => onOpenTask(item.parentId!)}>‹ {byId.get(item.parentId)!.title}</button>
            )}
            <h2 className="drawer-title">{item?.title ?? "작업"}</h2>
          </div>
          <button type="button" className="icon-btn" aria-label="작업 상세 닫기" onClick={onClose}>×</button>
        </header>

        {!item ? (
          <p className="muted">{loadError ?? "불러오는 중…"}</p>
        ) : (
          <div className="drawer-body">
            <section className="detail-owner" aria-label="담당">
              <Avatar member={members.find(m => m.id === item.ownerId) ?? { id: item.ownerId, kind: item.ownerKind, displayName: "?" }} size={32} />
              <div>
                <div className="member-name">{nameOf(item.ownerId)} {item.ownerKind === "agent" && <span className="badge badge-ai">AI</span>}</div>
                {item.routingNote && <div className="small muted">{item.routingNote}</div>}
              </div>
              <span className="detail-status">
                {item.status === "waiting_human" && item.waitingOn ? <span className="chip chip-needs">{waitingLabel(item, members, me)}</span> : <WorkStatusChip status={item.status} />}
              </span>
            </section>

            {item.resolution && onResolve && <TaskResolution task={item.resolution} onResolve={onResolve} />}

            {item.childIds.length > 0 && (
              <section aria-label="하위 작업">
                <h3 className="section-label">하위 작업</h3>
                <ul className="detail-list">
                  {item.childIds.map(id => byId.get(id)).filter((c): c is VmWorkItem => !!c).map(c => (
                    <li key={c.id}><button type="button" className="link-btn" onClick={() => onOpenTask(c.id)}>{c.title}</button> <WorkStatusChip status={c.status} /></li>
                  ))}
                </ul>
              </section>
            )}

            {(item.handoffConditions?.length ?? 0) > 0 && (
              <section aria-label="완료 조건">
                <h3 className="section-label">완료 조건</h3>
                <ul className="detail-list small">{item.handoffConditions!.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </section>
            )}
            {(item.exclusions?.length || item.limits?.length) ? (
              <section aria-label="범위">
                <h3 className="section-label">범위</h3>
                <ScopeLists exclusions={item.exclusions} limits={item.limits} />
              </section>
            ) : null}

            <section className="detail-brief" aria-label="PM이 정리한 맥락">
              <h3 className="section-label">PM이 정리한 맥락</h3>
              {item.brief ? (
                <>
                  <p className="card-text">{item.brief.why}</p>
                  {item.brief.sources.length > 0 && (
                    <div className="small"><span className="muted">원 대화</span>
                      <ul className="detail-list">{item.brief.sources.map(s => (
                        <li key={s.messageId}><button type="button" className="link-btn quote" onClick={() => onJumpToMessage(s.messageId)}>“{s.excerpt}”</button></li>
                      ))}</ul>
                    </div>
                  )}
                  {item.brief.decisions.length > 0 && (
                    <div className="small"><span className="muted">관련 결정</span>
                      <ul className="detail-list">{item.brief.decisions.map(d => <li key={d.id}>{d.summary}</li>)}</ul>
                    </div>
                  )}
                  {item.brief.attachments.length > 0 && (
                    <ul className="attachments">{item.brief.attachments.map(a => (
                      <li key={a.id}><a className="attachment" href={a.url} target="_blank" rel="noreferrer"><span className="attachment-icon" aria-hidden>📄</span><span className="attachment-name">{a.name}</span></a></li>
                    ))}</ul>
                  )}
                  {item.brief.constraints.length > 0 && (
                    <div className="small"><span className="muted">확정된 제약</span>
                      <ul className="detail-list">{item.brief.constraints.map((c, i) => <li key={i}>{c}</li>)}</ul>
                    </div>
                  )}
                </>
              ) : <p className="small muted">아직 정리된 맥락이 없어요.</p>}
            </section>

            {item.origin && (
              <section aria-label="출처">
                <h3 className="section-label">출처</h3>
                <p className="small">
                  {item.origin.createdByName}의 발언에서 생겼어요.{" "}
                  {item.origin.messageIds[0] && (
                    <button type="button" className="link-btn" onClick={() => onJumpToMessage(item.origin!.messageIds[0]!)}>이 대화에서 생김 →</button>
                  )}
                </p>
                {item.origin.messageIds[0] && sourceText(item.origin.messageIds[0]) && (
                  <blockquote className="detail-quote small">{sourceText(item.origin.messageIds[0])}</blockquote>
                )}
              </section>
            )}

            <section aria-label="활동 기록">
              <h3 className="section-label">활동 기록</h3>
              {!detail ? <p className="small muted">{loadError ?? "불러오는 중…"}</p> : detail.activity.length === 0 ? <p className="small muted">기록이 없어요.</p> : (
                <ol className="activity-log">
                  {detail.activity.map((a, i) => (
                    <li key={i}>
                      <time className="num muted small" dateTime={a.at}>{when(a.at)}</time>
                      <span className="small"><strong>{nameOf(a.actorId)}</strong> {a.text}</span>
                      {a.messageId && <button type="button" className="link-btn small" onClick={() => onJumpToMessage(a.messageId!)}>대화 보기</button>}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section aria-label="댓글">
              <h3 className="section-label">댓글</h3>
              {detail && detail.comments.length > 0 && (
                <ul className="comment-list">
                  {detail.comments.map(c => (
                    <li key={c.id} className="comment">
                      <span className="small"><strong>{nameOf(c.authorId)}</strong> <time className="muted num" dateTime={c.at}>{when(c.at)}</time></span>
                      <p className="card-text">{c.text}</p>
                    </li>
                  ))}
                </ul>
              )}
              <form className="comment-form" onSubmit={e => { e.preventDefault(); void send(); }}>
                <textarea className="comment-input" rows={2} value={draft} onChange={e => setDraft(e.target.value)} placeholder="이 작업에 댓글 남기기 — PM과 담당이 봐요" aria-label="댓글" disabled={sending}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
                <button type="submit" className="btn-primary btn-small" disabled={sending || !draft.trim()}>남기기</button>
              </form>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}
