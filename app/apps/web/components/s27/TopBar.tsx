'use client';

import { S27, STAGE_TITLE, type S27View, type StageNo } from '../../lib/s27';
import { useS27 } from './shared';

const STAGES: StageNo[] = [1, 2, 3, 4, 5];

export function TopBar({ view, onOpenStatus, onOpenFinale }: { view: S27View; onOpenStatus: () => void; onOpenFinale: () => void }) {
  const { dispatch } = useS27();
  const last = view.index === view.total - 1;
  return (
    <header className="s27-top">
      <div className="s27-top-row">
        <div className="s27-brand">
          <span className="s27-brand-mark" aria-hidden="true">E</span>
          <div className="s27-brand-text">
            <div className="s27-team">{S27.team.name}</div>
            <div className="s27-goal">{S27.team.goal}</div>
          </div>
        </div>
        <div className="s27-controls">
          <button type="button" className="s27-btn s27-btn-text" onClick={onOpenStatus}>구현 현황</button>
          {last && <button type="button" className="s27-btn s27-btn-harmony" onClick={onOpenFinale}>해자 정리</button>}
          <button type="button" className="s27-icon-btn" onClick={() => dispatch({ type: 'reset' })} aria-label="처음으로 (Home)" title="처음으로 (Home)">↺</button>
          <button type="button" className="s27-icon-btn" onClick={() => dispatch({ type: 'prev' })} disabled={!view.canPrev} aria-label="이전 (←)" title="이전 (←)">←</button>
          <span className="s27-counter num" aria-live="polite">{view.index + 1} / {view.total}</span>
          <button type="button" className="s27-btn s27-btn-primary s27-btn-next" onClick={() => dispatch({ type: 'next' })} disabled={!view.canNext} aria-label="다음 (→ 또는 스페이스)" title="다음 (→ 또는 스페이스)">다음 →</button>
        </div>
      </div>
      <ol className="s27-stepper" aria-label="시연 단계">
        {STAGES.map((stage) => {
          const first = S27.beats.findIndex((b) => b.stage === stage);
          const state = view.stage === stage ? 'current' : view.stage !== null && stage < view.stage ? 'done' : 'todo';
          return (
            <li key={stage}>
              <button
                type="button"
                className={`s27-step is-${state}`}
                aria-current={state === 'current' ? 'step' : undefined}
                disabled={first < 0}
                onClick={() => dispatch({ type: 'goto', beat: first })}
              >
                <span className="s27-step-no">{stage}</span>
                <span className="s27-step-title">{STAGE_TITLE[stage]}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {view.beat && (
        <p className="s27-caption" aria-live="polite">
          <span className="s27-caption-tag">발표 포인트</span>
          <span><strong>{view.beat.title}</strong> — {view.beat.caption}</span>
        </p>
      )}
    </header>
  );
}
