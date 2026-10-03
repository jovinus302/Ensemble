'use client';

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { S27, initialS27, reduceS27, viewS27, type Surface } from '../../lib/s27';
import { AvailabilityTag, CapabilityStrip, StatusDrawer } from './Capability';
import { Finale } from './Finale';
import { HubPane } from './HubPane';
import { MeetingPane } from './MeetingPane';
import { MessengerPane } from './MessengerPane';
import { TopBar } from './TopBar';
import { S27Context, capabilityById, useMediaQuery, type S27Ctx } from './shared';
import './s27.css';

const TABS: { surface: Surface; label: string; capability?: string }[] = [
  { surface: 'meeting', label: '녹스 미팅 (시뮬레이션)', capability: 'cap-meeting' },
  { surface: 'slack', label: '슬랙 (시뮬레이션)', capability: 'cap-slack' },
  { surface: 'hub', label: 'Ensemble 허브' },
];

/** Channel the left pane keeps showing while the hub has focus: the latest channel any beat so far brought forward. */
function lastChannel(beatIndex: number): Exclude<Surface, 'hub'> {
  for (let i = beatIndex; i >= 0; i--) {
    const beat = S27.beats[i];
    if (!beat) continue;
    if (beat.focus !== 'hub') return beat.focus;
    for (const id of [...beat.lines].reverse()) {
      const line = S27.lines.find((l) => l.id === id);
      if (line) return line.surface;
    }
  }
  return 'meeting';
}

export function S27Demo() {
  const [state, dispatch] = useReducer(reduceS27, undefined, initialS27);
  const view = useMemo(() => viewS27(state), [state]);
  const wide = useMediaQuery('(min-width: 1100px)', true);
  const [drawer, setDrawer] = useState(false);
  const [finale, setFinale] = useState(false);
  const isLast = view.index === view.total - 1;

  useEffect(() => { if (!isLast) setFinale(false); }, [isLast]);

  const openNode = useCallback((id: string) => {
    dispatch({ type: 'select_node', id });
    if (!wide) dispatch({ type: 'show_surface', surface: 'hub' });
  }, [wide]);
  const ctx = useMemo<S27Ctx>(() => ({ dispatch, wide, openNode }), [wide, openNode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (drawer || finale) {
        if (e.key === 'Escape') { setDrawer(false); setFinale(false); }
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'ArrowRight' || (e.key === ' ' && !target?.closest('button'))) {
        e.preventDefault();
        dispatch({ type: 'next' });
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        dispatch({ type: 'prev' });
      } else if (e.key === 'Home') {
        e.preventDefault();
        dispatch({ type: 'reset' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer, finale]);

  const fresh = useMemo(() => new Set(view.freshLineIds), [view.freshLineIds]);
  const left = view.surface === 'hub' ? lastChannel(view.index) : view.surface;
  const showMeeting = wide ? left === 'meeting' : view.surface === 'meeting';
  const showSlack = wide ? left === 'slack' : view.surface === 'slack';
  const showHub = wide || view.surface === 'hub';

  return (
    <S27Context.Provider value={ctx}>
      <div className={`s27${wide ? ' is-wide' : ' is-narrow'}${view.surface === 'hub' ? ' is-hub-focus' : ''}`}>
        <TopBar view={view} onOpenStatus={() => setDrawer(true)} onOpenFinale={() => setFinale(true)} />

        {view.beat === null ? (
          <main className="s27-title">
            <div className="s27-title-card">
              <div className="s27-eyebrow">로컬 스크립트형 시연 · 실제 연동 호출 없음</div>
              <h1>{S27.team.name}</h1>
              <p className="s27-title-goal">{S27.team.goal}</p>
              <p className="s27-positioning">
                앙상블은 팀의 컨텍스트, 도구, 의사결정과 결과물을 연결해 사람과 에이전트가 협업을 이어갈 수 있게 하는 <strong>공유 업무 기반</strong>입니다.
              </p>
              <p className="s27-muted">협업은 미팅·메신저 등 팀이 일하는 채널에서 시작하고, 근거·결정·결과물은 앙상블에 연결되어 다음 작업에 쓰입니다.</p>
              <div className="s27-title-cast" aria-label="등장인물">
                {S27.actors.map((a) => (
                  <span key={a.id} className="s27-cast"><strong>{a.name}</strong> {a.role}</span>
                ))}
              </div>
              <button type="button" className="s27-btn s27-btn-primary s27-btn-lg" onClick={() => dispatch({ type: 'next' })} autoFocus>시작</button>
              <p className="s27-muted s27-small">키보드: → / 스페이스 다음 · ← 이전 · Home 처음으로</p>
            </div>
          </main>
        ) : (
          <main className="s27-stage">
            <CapabilityStrip capabilities={view.capabilities} />
            <div className="s27-tabs" role="tablist" aria-label="화면 선택">
              {TABS.map((t) => {
                const cap = t.capability ? capabilityById.get(t.capability) : undefined;
                const selected = view.surface === t.surface;
                return (
                  <button
                    key={t.surface}
                    type="button"
                    role="tab"
                    id={`s27-tab-${t.surface}`}
                    aria-selected={selected}
                    aria-controls={`s27-panel-${t.surface}`}
                    className={`s27-tab${selected ? ' is-active' : ''}${wide && t.surface === left && !selected ? ' is-left' : ''}`}
                    onClick={() => dispatch({ type: 'show_surface', surface: t.surface })}
                  >
                    <span>{t.label}</span>
                    {t.capability && <AvailabilityTag availability={cap?.availability ?? 'planned'} small />}
                  </button>
                );
              })}
            </div>
            <div className="s27-surfaces">
              {(showMeeting || showSlack) && (
                <div
                  className="s27-panel s27-panel-channel"
                  role="tabpanel"
                  id={`s27-panel-${showMeeting ? 'meeting' : 'slack'}`}
                  aria-labelledby={`s27-tab-${showMeeting ? 'meeting' : 'slack'}`}
                >
                  {showMeeting
                    ? <MeetingPane lines={view.meeting} fresh={fresh} />
                    : <MessengerPane lines={view.slack} fresh={fresh} />}
                </div>
              )}
              {showHub && (
                <div className="s27-panel s27-panel-hub" role="tabpanel" id="s27-panel-hub" aria-labelledby="s27-tab-hub">
                  <HubPane view={view} artifactVersionId={state.artifactVersionId} />
                </div>
              )}
            </div>
          </main>
        )}

        {drawer && <StatusDrawer onClose={() => setDrawer(false)} />}
        {finale && <Finale onClose={() => setFinale(false)} onOpenStatus={() => { setFinale(false); setDrawer(true); }} />}
      </div>
    </S27Context.Provider>
  );
}
