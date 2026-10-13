// film (PitchV5) only: animated meeting tile + caption band. Final states equal
// the B1 / B3 style frames (tile order, PM tile dashed/empty -> harmony ring + avatar).
import React from 'react';
import {MEETING, B3COPY} from '../content';
import {useFs} from './SurfaceFrame';
import {HARMONY_RING, useTheme} from './theme';
import {chipStyle, useFilm} from './film';

export const FilmTile: React.FC<{t: (typeof MEETING.tiles)[number]; i: number}> = ({t, i}) => {
  const fs = useFs();
  const {pal: c} = useTheme();
  const film = useFilm()!;
  const M = film.M;
  const labelBg = c.dark ? 'rgba(14,19,17,.82)' : 'rgba(255,255,255,.92)';
  const tileTones = [c.surfaceContainerHigh, c.secondaryContainer, c.surfaceContainer];
  const pop = M.tile[i] ?? 1;
  const popStyle: React.CSSProperties = {width: '100%', height: '100%', transform: `scale(${0.86 + 0.14 * Math.min(1, pop)})`, opacity: Math.min(1, pop * 2.2), minHeight: 0};
  if (!t.empty) {
    const sh = M.shimmer[i] ?? 2;
    return (
      <div style={popStyle}>
        <div
          style={{
            position: 'relative',
            borderRadius: 16,
            overflow: 'hidden',
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            background: tileTones[i % tileTones.length],
            boxShadow: c.dark ? `inset 0 0 0 1px ${c.outlineVariant}` : 'inset 0 0 0 1px rgba(201,209,203,.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
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
          {(M.speaker[i] ?? 0) > 0.02 && <div style={{position: 'absolute', inset: 0, borderRadius: 16, boxShadow: `inset 0 0 0 3px rgba(43,106,82,${0.6 * M.speaker[i]})`, pointerEvents: 'none'}} />}
          {sh <= 1 && <div style={{position: 'absolute', top: 0, bottom: 0, width: '46%', left: `${-46 + 146 * sh}%`, background: 'linear-gradient(105deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.5) 50%, rgba(255,255,255,0) 100%)', pointerEvents: 'none'}} />}
          <div style={{position: 'absolute', left: 10, bottom: 10, padding: '3px 14px', borderRadius: 10, background: labelBg, color: c.onSurface, fontSize: fs(22), fontWeight: 600, lineHeight: 1.3}}>{t.name}</div>
        </div>
      </div>
    );
  }
  // PM Agent tile: dark/empty until the motif entry, then a harmony ring + avatar
  const pm = M.pm;
  return (
    <div style={popStyle}>
      <div data-anchor="pm-tile" style={{position: 'relative', borderRadius: 16, padding: 2.5 * pm, boxSizing: 'border-box', width: '100%', height: '100%', minHeight: 0}}>
        <div style={{position: 'absolute', inset: 0, borderRadius: 16, background: HARMONY_RING, opacity: pm}} />
        {M.pmPulse > 0 && M.pmPulse < 1 && <div style={{position: 'absolute', inset: -2 - 18 * M.pmPulse, borderRadius: 16 + 18 * M.pmPulse, border: '3px solid #3DBE8B', opacity: 0.8 * (1 - M.pmPulse), pointerEvents: 'none'}} />}
        <div
          style={{
            position: 'relative',
            borderRadius: 16 - 2 * pm,
            overflow: 'hidden',
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            background: pm > 0.5 ? c.primaryContainer : c.dark ? 'rgba(255,255,255,.04)' : 'rgba(229,232,227,.35)',
            border: pm > 0.5 ? undefined : `2.5px dashed ${c.outlineVariant}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {pm > 0 && (
            <div style={{width: 84, height: 84, borderRadius: 22, background: c.primary, color: c.onPrimary, fontSize: 36, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${0.5 + 0.5 * M.pmAvatar})`, opacity: Math.min(1, M.pmAvatar * 2)}}>
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
              background: pm > 0.5 ? labelBg : c.dark ? 'rgba(14,19,17,.5)' : 'rgba(255,255,255,.55)',
              color: pm > 0.5 ? c.primary : c.outline,
              fontSize: fs(22),
              fontWeight: pm > 0.5 ? 700 : 600,
              lineHeight: 1.3,
            }}
          >
            {t.name}
          </div>
        </div>
      </div>
    </div>
  );
};

/** B2: the meeting's live-caption band; decision chips pop in here and fold into the capsule */
export const CaptionBand: React.FC = () => {
  const fs = useFs();
  const film = useFilm()!;
  const {band, chip1, chip2} = film.M;
  if (band <= 0) return null;
  const chip = (text: string, tag: string, a: typeof chip1, key: string) => (
    <div key={key} style={{...chipStyle(a), display: 'flex', alignItems: 'center', gap: 10, padding: '8px 18px', borderRadius: 999, background: '#FFFFFF', color: '#18201C', fontSize: fs(22), fontWeight: 700, whiteSpace: 'nowrap', boxShadow: '0 2px 6px rgba(0,0,0,.25)'}}>
      <span style={{color: '#2B6A52'}}>{tag}</span>
      <span style={{clipPath: `inset(0 ${(1 - (a.type ?? 1)) * 100}% 0 0)`}}>{text}</span>
    </div>
  );
  return (
    <div
      data-anchor="cap-band"
      style={{
        position: 'absolute',
        left: 18,
        right: 18,
        bottom: 92,
        height: 64,
        borderRadius: 16,
        background: 'rgba(14,19,17,.9)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 12px',
        transform: `translateY(${(1 - band) * 28}px)`,
        opacity: Math.min(1, band * 2),
      }}
    >
      {chip('출시일 11/6', '결정', chip1, 'c1')}
      {chip('인증 심사 지연', '이유', chip2, 'c2')}
    </div>
  );
};
