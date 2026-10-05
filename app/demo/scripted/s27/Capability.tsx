'use client';

import { useEffect, useRef } from 'react';
import { AVAILABILITY_LABEL, S27, type Availability, type Capability } from '.';

const AVAILABILITY_ORDER: Availability[] = ['implemented', 'demoable', 'planned'];
const AVAILABILITY_MARK: Record<Availability, string> = { implemented: '●', demoable: '◐', planned: '○' };

export function AvailabilityTag({ availability, small }: { availability: Availability; small?: boolean }) {
  return (
    <span className={`s27-avail s27-avail-${availability}${small ? ' is-small' : ''}`}>
      <span aria-hidden="true">{AVAILABILITY_MARK[availability]}</span> {AVAILABILITY_LABEL[availability]}
    </span>
  );
}

function CapabilityDetail({ cap }: { cap: Capability }) {
  return (
    <>
      <p className="s27-cap-note">{cap.note}</p>
      {cap.evidence && cap.evidence.length > 0 && (
        <div className="s27-evidence">
          <span className="s27-evidence-label">코드 근거</span>
          {cap.evidence.map((p) => <code key={p}>{p}</code>)}
        </div>
      )}
    </>
  );
}

export function StatusDrawer({ onClose, current = [] }: { onClose: () => void; current?: string[] }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  return (
    <div className="s27-overlay" onClick={onClose}>
      <aside className="s27-drawer" role="dialog" aria-modal="true" aria-labelledby="s27-drawer-title" onClick={(e) => e.stopPropagation()}>
        <header className="s27-drawer-head">
          <div>
            <h2 id="s27-drawer-title">구현 현황</h2>
            <p className="s27-muted s27-small">이 시연에 등장하는 기능 {S27.capabilities.length}개를 실제 구현 정도별로 나눴습니다.</p>
          </div>
          <button ref={closeRef} type="button" className="s27-icon-btn" onClick={onClose} aria-label="구현 현황 닫기">✕</button>
        </header>
        {AVAILABILITY_ORDER.map((a) => {
          const caps = S27.capabilities.filter((c) => c.availability === a);
          if (caps.length === 0) return null;
          return (
            <section key={a} className="s27-drawer-group">
              <h3><AvailabilityTag availability={a} /> <span className="s27-muted">{caps.length}개</span></h3>
              <ul>
                {caps.map((c) => (
                  <li key={c.id} className={`s27-drawer-item s27-avail-border-${a}`}>
                    <strong>{c.label}</strong>
                    {current.includes(c.id) && <span className="s27-here">이 장면</span>}
                    <CapabilityDetail cap={c} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </aside>
    </div>
  );
}
