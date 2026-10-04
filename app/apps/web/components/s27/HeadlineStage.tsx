'use client';

import type { S27View } from '../../lib/s27';
import { AvailabilityTag } from './Capability';

/** The one big message of the beat, a single capability badge, and the presenter note when toggled. */
export function HeadlineStage({ view, notes, onOpenStatus }: { view: S27View; notes: boolean; onOpenStatus: () => void }) {
  const beat = view.beat;
  if (!beat) return null;
  const cap = view.capabilities[0];
  return (
    <section className="s27-headline" aria-live="polite">
      <div className="s27-headline-row">
        <span className="s27-headline-no" aria-label={`${beat.stage}단계`}>{beat.stage}</span>
        <h1 key={beat.id} className="s27-headline-text">{beat.headline}</h1>
        {cap && (
          <button type="button" className={`s27-cap s27-avail-${cap.availability}`} onClick={onOpenStatus} title={cap.note} aria-label={`${cap.label} — ${cap.note} 구현 현황 열기`}>
            <AvailabilityTag availability={cap.availability} small />
            <span className="s27-cap-label">{cap.label}</span>
          </button>
        )}
      </div>
      {notes && (
        <p className="s27-notes" role="note">
          <span className="s27-notes-tag">발표 노트</span>
          <span><strong>{beat.title}</strong> — {beat.caption}</span>
        </p>
      )}
    </section>
  );
}
