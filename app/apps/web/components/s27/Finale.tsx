'use client';

import { useEffect, useRef } from 'react';
import { S27 } from '../../lib/s27';

const MOATS = [
  { name: '경험적 해자', text: '채널·담당자가 바뀌어도 배경을 다시 설명하지 않는다.' },
  { name: '기술적 해자', text: '근거·결정·도구·결과물의 연결과 버전이 추적된다.' },
  { name: '축적 해자', text: '결정과 피드백이 다음 작업의 자산이 된다.' },
];

export function Finale({ onClose, onOpenStatus }: { onClose: () => void; onOpenStatus: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  return (
    <div className="s27-overlay s27-overlay-center" onClick={onClose}>
      <section className="s27-finale" role="dialog" aria-modal="true" aria-labelledby="s27-finale-title" onClick={(e) => e.stopPropagation()}>
        <header className="s27-drawer-head">
          <h2 id="s27-finale-title">쌓일수록 강해지는 해자</h2>
          <button ref={closeRef} type="button" className="s27-icon-btn" onClick={onClose} aria-label="해자 정리 닫기">✕</button>
        </header>

        <ul className="s27-moats">
          {MOATS.map((m) => (
            <li key={m.name} className="s27-moat">
              <strong>{m.name}</strong>
              <p>{m.text}</p>
            </li>
          ))}
        </ul>

        <div className="s27-metrics-head">
          <h3>기존 → 앙상블</h3>
          <span className="s27-assume-tag" role="note">시나리오 가정값 · 측정 결과 아님</span>
        </div>
        <ul className="s27-metrics">
          {S27.metrics.map((m) => (
            <li key={m.id} className="s27-metric">
              <span className="s27-metric-label">{m.label}</span>
              <span className="s27-metric-legacy">{m.legacy}</span>
              <span className="s27-metric-arrow" aria-label="에서">→</span>
              <span className="s27-metric-ens">{m.ensemble}</span>
            </li>
          ))}
        </ul>

        <details className="s27-fulltext">
          <summary>검증 방법</summary>
          <ul className="s27-verify">
            {S27.metrics.map((m) => <li key={m.id}><strong>{m.label}</strong> — {m.verification}</li>)}
          </ul>
        </details>

        <footer className="s27-finale-foot">
          <button type="button" className="s27-btn s27-btn-outlined" onClick={onOpenStatus}>구현 현황 보기</button>
          <button type="button" className="s27-btn s27-btn-primary" onClick={onClose}>닫기</button>
        </footer>
      </section>
    </div>
  );
}
