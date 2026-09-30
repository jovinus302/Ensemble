"use client";
import { useEffect, useState } from 'react';
import type { ViewModel } from '../lib/view-model';
import { MessageItem } from './Message';
import { RoadmapCard } from './Roadmap';
import { formatDate, formatTime } from './format';

export function Archives({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<{ id: string; title: string; archivedAt: string | null }[]>([]);
  const [view, setView] = useState<ViewModel>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    void fetch('/api/archives', { signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error(); setList(await response.json());
    }).catch(() => { if (!abort.signal.aborted) setError('보관 목록을 불러오지 못했습니다.'); }).finally(() => setLoading(false));
    return () => abort.abort();
  }, []);
  const open = async (id: string) => {
    setLoading(true); setError('');
    try { const response = await fetch(`/api/archives/${encodeURIComponent(id)}`); if (!response.ok) throw new Error(); setView(await response.json()); }
    catch { setError('보관된 프로젝트를 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  };
  return <section className="archives" aria-label="보관함">
    <header className="archive-header"><h1>{view ? view.project.title : '보관함'}</h1><span className="chip">읽기 전용</span>
      {view && <button className="btn-tonal" onClick={() => setView(undefined)}>목록</button>}
      <button className="btn-tonal" onClick={onClose}>현재 프로젝트로 돌아가기</button></header>
    {error && <p role="alert">{error}</p>}{loading && <p role="status">불러오는 중…</p>}
    {!view ? <ul className="archive-list">{list.map(item => <li key={item.id}><button className="btn-tonal" disabled={loading} onClick={() => void open(item.id)}>{item.title}</button><span>보관 {item.archivedAt ? `${formatDate(item.archivedAt)} ${formatTime(item.archivedAt)}` : '시각 미상'}</span></li>)}{!loading && !list.length && <li>보관된 프로젝트가 없습니다.</li>}</ul>
      : <><RoadmapCard roadmap={view.roadmap} deadline={view.project.deadline} members={view.members} me="" onSetAvailability={async () => ({ ok: true })} />
        <div className="timeline">{view.messages.map(message => <MessageItem key={message.id} message={message} author={view.members.find(m => m.id === message.authorId)} grouped={false} />)}</div></>}
  </section>;
}
