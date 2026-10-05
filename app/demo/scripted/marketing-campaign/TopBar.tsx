'use client';

import { S27, STAGE_TITLE, type S27View, type StageNo } from '.';
import { useS27 } from './shared';

const STAGES: StageNo[] = [1, 2, 3, 4, 5];

export function TopBar({ view, notes, onToggleNotes, onOpenStatus, onNext }: {
  view: S27View; notes: boolean; onToggleNotes: () => void; onOpenStatus: () => void; onNext: () => void;
}) {
  const { dispatch } = useS27();
  const last = view.index === view.total - 1;
  return (
    <header className="s27-top">
      <button type="button" className="s27-brand" onClick={() => dispatch({ type: 'reset' })} aria-label="처음으로 (Home)" title="처음으로 (Home)">
        <span className="s27-brand-mark" aria-hidden="true">E</span>
        <span className="s27-team">{S27.team.name}</span>
      </button>
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
                aria-label={`${stage}단계: ${STAGE_TITLE[stage]}`}
                title={STAGE_TITLE[stage]}
                disabled={first < 0}
                onClick={() => dispatch({ type: 'goto', beat: first })}
              >
                <span className="s27-step-no">{stage}</span>
                {state === 'current' && <span className="s27-step-title">{STAGE_TITLE[stage]}</span>}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="s27-controls">
        <button type="button" className="s27-btn s27-btn-text" onClick={onOpenStatus}>구현 현황</button>
        <button type="button" className={`s27-btn s27-btn-text${notes ? ' is-on' : ''}`} aria-pressed={notes} onClick={onToggleNotes} title="발표 노트 (N)">
          발표 노트
        </button>
        <button type="button" className="s27-icon-btn" onClick={() => dispatch({ type: 'prev' })} disabled={!view.canPrev} aria-label="이전 (←)" title="이전 (←)">←</button>
        <span className="s27-counter num" aria-live="polite">{view.index + 1} / {view.total}</span>
        <button
          type="button"
          className={`s27-btn ${last ? 's27-btn-harmony' : 's27-btn-primary'} s27-btn-next`}
          onClick={onNext}
          aria-label={last ? '해자 정리 열기 (→)' : '다음 (→ 또는 스페이스)'}
          title={last ? '해자 정리 (→)' : '다음 (→ 또는 스페이스)'}
        >
          {last ? '해자 정리' : '다음'} →
        </button>
      </div>
    </header>
  );
}
