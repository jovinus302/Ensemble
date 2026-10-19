// 맥락 뷰 V (storyboard-v5.md §3 B7): an auxiliary view, four rows grown from the
// decision capsule. Each row carries a [data-anchor="v-row-N"] at its left edge
// where the hairline source line starts (목표 -> D, 결정 -> M, 반영 -> A, 다음 -> P).
import React from 'react';
import {CONTEXT_VIEW, B7COPY} from '../content';
import {useFs} from './SurfaceFrame';
import {useTheme} from './theme';
import {useFilm} from './film';

export const ContextView: React.FC = () => {
  const fs = useFs();
  const {pal: c} = useTheme();
  const V = useFilm()?.V;
  return (
    <div style={{position: 'absolute', inset: 0, background: c.surface, display: 'flex', flexDirection: 'column'}}>
      <div style={{height: 60, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 24px', borderBottom: `1px solid ${c.outlineVariant}`}}>
        <div style={{width: 12, height: 12, borderRadius: 6, background: c.primary}} />
        <span style={{fontSize: fs(24), fontWeight: 700}}>{CONTEXT_VIEW.title}</span>
      </div>
      <div style={{flex: 1, display: 'flex', flexDirection: 'column'}}>
        {CONTEXT_VIEW.rows.map((r, i) => (
          <div
            key={r.key}
            style={{
              flex: V ? `${V.rows[i]} 1 0px` : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '0 24px',
              borderTop: i ? `1px solid ${c.outlineVariant}` : undefined,
              ...(V ? {overflow: 'hidden', minHeight: 0, opacity: i === 1 ? V.decision : Math.min(1, V.rows[i] * 2.5)} : {}),
            }}
          >
            <span data-anchor={`v-row-${i}`} style={{width: fs(20) * 2 + 14, flexShrink: 0, fontSize: fs(20), fontWeight: 700, color: c.primary}}>
              {r.key}
            </span>
            {i === 2 ? (
              <div style={{display: 'flex', gap: 8, flexWrap: 'nowrap'}}>
                {CONTEXT_VIEW.reflect.map((x) => (
                  <span
                    key={x.item}
                    style={{
                      padding: '2px 12px',
                      borderRadius: 999,
                      fontSize: fs(20),
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                      background: x.done ? c.primaryContainer : c.warning,
                      color: x.done ? c.onPrimaryContainer : '#FFFFFF',
                    }}
                  >
                    {x.item} {x.done ? '✓' : B7COPY.waiting.slice(3)}
                  </span>
                ))}
              </div>
            ) : (
              <span style={{fontSize: fs(22), fontWeight: 600, whiteSpace: 'nowrap'}}>{r.value}</span>
            )}
            <span data-anchor={`v-end-${i}`} style={{marginLeft: 'auto', width: 1, height: 1}} />
          </div>
        ))}
      </div>
    </div>
  );
};
