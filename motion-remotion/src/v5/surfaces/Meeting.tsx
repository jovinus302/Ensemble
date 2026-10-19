// 미팅: 2x2 participant grid + control bar. The PM Agent tile is deliberately
// empty and dimmed in B1 (name tag only); in B3 it is lit with a harmony ring
// (the thread starts here).
import React from 'react';
import {MEETING, B3COPY} from '../content';
import {useFs} from './SurfaceFrame';
import {HARMONY_RING, useTheme} from './theme';
import {useFilm} from './film';
import {CaptionBand, FilmTile} from './MeetingFilm';

const Ctl: React.FC<{children: React.ReactNode; wide?: boolean}> = ({children, wide}) => {
  const {pal: c} = useTheme();
  return (
    <div
      style={{
        width: wide ? 84 : 56,
        height: 56,
        borderRadius: 28,
        background: c.surfaceContainerHigh,
        color: c.onSurface,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </div>
  );
};

const sv = {width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const};

export const Meeting: React.FC = () => {
  const fs = useFs();
  const {pal: c, state} = useTheme();
  const film = useFilm();
  const lit = state === 'B3' || state === 'B7';
  const tileTones = [c.surfaceContainerHigh, c.secondaryContainer, c.surfaceContainer];
  const labelBg = c.dark ? 'rgba(14,19,17,.82)' : 'rgba(255,255,255,.92)';
  return (
    <div style={{position: 'absolute', inset: 0, background: c.surfaceContainerLow, display: 'flex', flexDirection: 'column'}}>
      <div style={{height: 64, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '0 24px', background: c.surface, borderBottom: `1px solid ${c.outlineVariant}`}}>
        <div style={{width: 14, height: 14, borderRadius: 7, background: c.onSurfaceVariant}} />
        <span style={{fontSize: fs(26), fontWeight: 700}}>{MEETING.title}</span>
        <span style={{marginLeft: 'auto', fontSize: fs(20), fontWeight: 600, color: c.onSurfaceVariant}}>00:42</span>
      </div>
      <div style={{flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 14, padding: '16px 18px 8px'}}>
        {(state ? [MEETING.tiles[0], MEETING.tiles[3], MEETING.tiles[1], MEETING.tiles[2]] : MEETING.tiles).map((t, i) => {
          if (film) return <FilmTile key={t.name} t={t} i={i} />;
          const isLit = t.empty && lit;
          const tile = (
            <div
              key={t.name}
              style={{
                position: 'relative',
                borderRadius: isLit ? 14 : 16,
                overflow: 'hidden',
                width: '100%',
                height: '100%',
                boxSizing: 'border-box',
                background: isLit ? c.primaryContainer : t.empty ? (c.dark ? 'rgba(255,255,255,.04)' : 'rgba(229,232,227,.35)') : tileTones[i % tileTones.length],
                boxShadow: t.empty ? undefined : c.dark ? `inset 0 0 0 1px ${c.outlineVariant}` : 'inset 0 0 0 1px rgba(201,209,203,.8)',
                border: t.empty && !isLit ? `2.5px dashed ${c.outlineVariant}` : undefined,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {!t.empty && (
                <div
                  style={{
                    width: 84,
                    height: 84,
                    borderRadius: 84,
                    background: `linear-gradient(160deg, ${c.surface} 0%, ${c.surfaceContainerLow} 100%)`,
                    color: c.onSurfaceVariant,
                    fontSize: 38,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: c.dark ? '0 3px 8px -2px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.08)' : '0 3px 8px -2px rgba(23,59,48,.28), inset 0 1px 0 #fff',
                  }}
                >
                  {t.initial}
                </div>
              )}
              {isLit && (
                <div style={{width: 84, height: 84, borderRadius: 22, background: c.primary, color: c.onPrimary, fontSize: 36, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                  {B3COPY.pmInitial}
                </div>
              )}
              <div
                style={{
                  position: 'absolute',
                  left: 10,
                  bottom: 10,
                  padding: '3px 14px',
                  borderRadius: 10,
                  background: isLit ? labelBg : t.empty ? (c.dark ? 'rgba(14,19,17,.5)' : 'rgba(255,255,255,.55)') : labelBg,
                  color: isLit ? c.primary : t.empty ? c.outline : c.onSurface,
                  fontSize: fs(22),
                  fontWeight: isLit ? 700 : 600,
                  lineHeight: 1.3,
                }}
              >
                {t.name}
              </div>
            </div>
          );
          if (!isLit) return tile;
          return (
            <div key={t.name} data-anchor="pm-tile" style={{borderRadius: 16, padding: 2.5, background: HARMONY_RING, boxSizing: 'border-box', minHeight: 0}}>
              {tile}
            </div>
          );
        })}
      </div>
      {film && <CaptionBand />}
      <div data-anchor="m-bar" style={{height: 82, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16}}>
        <Ctl>
          <svg {...sv}>
            <rect x="9" y="3.5" width="6" height="11" rx="3" />
            <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
          </svg>
        </Ctl>
        <Ctl>
          <svg {...sv}>
            <rect x="3.5" y="6.5" width="11" height="11" rx="2.5" />
            <path d="M14.5 10.5l6-3v9l-6-3" />
          </svg>
        </Ctl>
        <Ctl>
          <svg {...sv}>
            <rect x="3.5" y="5" width="17" height="11" rx="2" />
            <path d="M9 20h6M12 16v4" />
          </svg>
        </Ctl>
        <Ctl wide>
          <svg {...sv}>
            <path d="M4 13.5c4.5-4 11.5-4 16 0l-2.5 2.2-3-1.2v-2.3c-2-.6-3.5-.6-5 0v2.3l-3 1.2z" />
          </svg>
        </Ctl>
      </div>
    </div>
  );
};
