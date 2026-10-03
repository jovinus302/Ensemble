'use client';

import { useEffect, useRef, useState } from 'react';
import { AVAILABILITY_LABEL, S27, type Availability, type Capability } from '../../lib/s27';

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

/** The current beat's capabilities. Hover, focus or tap a badge to read what is real vs simulated. */
export function CapabilityStrip({ capabilities }: { capabilities: Capability[] }) {
  const [pinned, setPinned] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const activeId = hover ?? pinned;
  const active = capabilities.find((c) => c.id === activeId) ?? null;
  const key = capabilities.map((c) => c.id).join(',');
  useEffect(() => { setPinned(null); setHover(null); }, [key]);

  if (capabilities.length === 0) return null;
  return (
    <div className="s27-capstrip">
      <div className="s27-capstrip-row">
        <span className="s27-capstrip-label">이 장면의 기능</span>
        {capabilities.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`s27-cap s27-avail-${c.availability}${c.id === activeId ? ' is-active' : ''}`}
            aria-expanded={c.id === activeId}
            aria-controls="s27-cap-detail"
            onClick={() => setPinned(pinned === c.id ? null : c.id)}
            onMouseEnter={() => setHover(c.id)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(c.id)}
            onBlur={() => setHover(null)}
          >
            <span className="s27-cap-status"><span aria-hidden="true">{AVAILABILITY_MARK[c.availability]}</span> {AVAILABILITY_LABEL[c.availability]}</span>
            <span className="s27-cap-label">{c.label}</span>
          </button>
        ))}
      </div>
      <div id="s27-cap-detail" className={`s27-cap-detail${active ? ` is-open s27-avail-border-${active.availability}` : ''}`} aria-live="polite">
        {active && (
          <>
            <strong>{active.label}</strong> · {AVAILABILITY_LABEL[active.availability]}
            <CapabilityDetail cap={active} />
          </>
        )}
      </div>
    </div>
  );
}

export function StatusDrawer({ onClose }: { onClose: () => void }) {
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
