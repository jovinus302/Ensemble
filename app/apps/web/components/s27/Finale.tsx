'use client';

import { useEffect, useRef } from 'react';
import { S27 } from '../../lib/s27';

const MOATS = [
  { name: '경험적 해자', text: '채널·담당자가 바뀌어도 아무도 배경을 다시 설명하지 않는다. 에이전트가 기존 결정과 최신 결과물을 스스로 이어받는다.' },
  { name: '기술적 해자', text: '대화·근거·결정·도구 실행·결과물의 연결 관계가 보존되고, 결과물의 버전·출처·결정 근거를 추적할 수 있다.' },
  { name: '축적 해자', text: '결정 이력과 피드백이 다음 작업의 자산이 된다. v1.1이 법무 피드백과 v1을 함께 이어받았다.' },
];

export function Finale({ onClose, onOpenStatus }: { onClose: () => void; onOpenStatus: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  return (
    <div className="s27-overlay s27-overlay-center" onClick={onClose}>
      <section className="s27-finale" role="dialog" aria-modal="true" aria-labelledby="s27-finale-title" onClick={(e) => e.stopPropagation()}>
        <header className="s27-drawer-head">
          <div>
            <div className="s27-eyebrow">S27 데모 정리</div>
            <h2 id="s27-finale-title">해자 정리</h2>
          </div>
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

        <div className="s27-assumption" role="note">
          <strong>시나리오 가정값 · 측정 결과 아님</strong>
          <span>아래 수치와 비교는 이 시연 시나리오의 가정입니다. 오른쪽 열의 방법으로 실제 검증이 필요합니다.</span>
        </div>

        <div className="s27-metrics-wrap">
          <table className="s27-metrics">
            <thead>
              <tr><th scope="col">지표</th><th scope="col">기존 방식</th><th scope="col">앙상블 시나리오 <span className="s27-assume-tag">가정</span></th><th scope="col">검증 방법</th></tr>
            </thead>
            <tbody>
              {S27.metrics.map((m) => (
                <tr key={m.id}>
                  <th scope="row" data-col="지표">{m.label}</th>
                  <td data-col="기존 방식">{m.legacy}</td>
                  <td data-col="앙상블 시나리오 (가정)" className="s27-metric-ens">{m.ensemble}</td>
                  <td data-col="검증 방법">{m.verification}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="s27-finale-foot">
          <button type="button" className="s27-btn s27-btn-outlined" onClick={onOpenStatus}>구현 현황 보기</button>
          <button type="button" className="s27-btn s27-btn-primary" onClick={onClose}>닫기</button>
        </footer>
      </section>
    </div>
  );
}
