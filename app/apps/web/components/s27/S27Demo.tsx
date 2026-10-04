'use client';

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { S27, initialS27, reduceS27, viewS27, type Surface } from '../../lib/s27';
import { StatusDrawer } from './Capability';
import { ConnectedRail } from './ConnectedRail';
import { Finale } from './Finale';
import { HeadlineStage } from './HeadlineStage';
import { HubPane } from './HubPane';
import { MeetingPane } from './MeetingPane';
import { MessengerPane } from './MessengerPane';
import { TopBar } from './TopBar';
import { Avatar, S27Context, type S27Ctx } from './shared';
import './s27.css';

const TABS: { surface: Surface; label: string }[] = [
  { surface: 'meeting', label: '미팅' },
  { surface: 'slack', label: '메신저' },
  { surface: 'hub', label: '앙상블 허브' },
];

const humans = S27.actors.filter((a) => a.kind === 'human');

export function S27Demo() {
  const [state, dispatch] = useReducer(reduceS27, undefined, initialS27);
  const view = useMemo(() => viewS27(state), [state]);
  const [drawer, setDrawer] = useState(false);
  const [finale, setFinale] = useState(false);
  const [notes, setNotes] = useState(false);
  const isLast = view.index === view.total - 1;

  useEffect(() => { if (!isLast) setFinale(false); }, [isLast]);

  // Hub is never on screen beside a channel, so opening a node always brings it forward.
  const openNode = useCallback((id: string) => {
    dispatch({ type: 'select_node', id });
    dispatch({ type: 'show_surface', surface: 'hub' });
  }, []);
  const ctx = useMemo<S27Ctx>(() => ({ dispatch, openNode }), [openNode]);

  const next = useCallback(() => {
    if (isLast) setFinale(true);
    else dispatch({ type: 'next' });
  }, [isLast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (drawer || finale) {
        if (e.key === 'Escape') { setDrawer(false); setFinale(false); }
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'ArrowRight' || (e.key === ' ' && !target?.closest('button, summary'))) {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        dispatch({ type: 'prev' });
      } else if (e.key === 'Home') {
        e.preventDefault();
        dispatch({ type: 'reset' });
      } else if (e.key === 'n' || e.key === 'N' || e.key === 'ㅜ') {
        e.preventDefault();
        setNotes((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer, finale, next]);

  const fresh = useMemo(() => new Set(view.freshLineIds), [view.freshLineIds]);
  const freshNodes = useMemo(() => new Set(view.freshNodeIds), [view.freshNodeIds]);

  return (
    <S27Context.Provider value={ctx}>
      <div className={`s27 is-surface-${view.surface}${view.beat ? '' : ' is-title'}`}>
        <TopBar view={view} notes={notes} onToggleNotes={() => setNotes((v) => !v)} onOpenStatus={() => setDrawer(true)} onNext={next} />

        {view.beat === null ? (
          <main className="s27-title">
            <div className="s27-title-card">
              <div className="s27-eyebrow">{S27.team.name} · 로컬 시연</div>
              <h1 className="s27-positioning">
                팀의 맥락·도구·결정·결과물을 잇는 <strong>공유 업무 기반</strong>, 앙상블
              </h1>
              <ul className="s27-title-cast" aria-label="등장인물">
                {humans.map((a) => (
                  <li key={a.id} className="s27-cast">
                    <Avatar actorId={a.id} size="xl" label />
                    <strong>{a.name}</strong>
                  </li>
                ))}
              </ul>
              <button type="button" className="s27-btn s27-btn-primary s27-btn-lg" onClick={() => dispatch({ type: 'next' })} autoFocus>시작</button>
              <p className="s27-muted s27-small">→ / 스페이스 다음 · ← 이전 · N 발표 노트</p>
            </div>
          </main>
        ) : (
          <main className="s27-stage">
            <HeadlineStage view={view} notes={notes} onOpenStatus={() => setDrawer(true)} />
            <div className="s27-toolbar">
              <div className="s27-tabs" role="tablist" aria-label="화면 선택">
                {TABS.map((t) => {
                  const selected = view.surface === t.surface;
                  return (
                    <button
                      key={t.surface}
                      type="button"
                      role="tab"
                      id={`s27-tab-${t.surface}`}
                      aria-selected={selected}
                      aria-controls="s27-panel"
                      className={`s27-tab${selected ? ' is-active' : ''}`}
                      onClick={() => dispatch({ type: 'show_surface', surface: t.surface })}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
              <ConnectedRail key={view.index} nodes={view.nodes} fresh={freshNodes} active={view.surface === 'hub'} />
            </div>
            <div className="s27-panel" role="tabpanel" id="s27-panel" aria-labelledby={`s27-tab-${view.surface}`}>
              {view.surface === 'meeting' && <MeetingPane lines={view.meeting} fresh={fresh} nodes={view.nodes} freshNodes={freshNodes} />}
              {view.surface === 'slack' && <MessengerPane lines={view.slack} fresh={fresh} />}
              {view.surface === 'hub' && <HubPane view={view} artifactVersionId={state.artifactVersionId} />}
            </div>
          </main>
        )}

        {drawer && <StatusDrawer onClose={() => setDrawer(false)} current={view.beat?.capabilities} />}
        {finale && <Finale onClose={() => setFinale(false)} onOpenStatus={() => { setFinale(false); setDrawer(true); }} />}
      </div>
    </S27Context.Provider>
  );
}
