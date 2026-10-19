// 문서: a press-release draft with a campaign schedule table. The "광고 집행
// 11/1" row is the stale-date target (amber in B3).
import React from 'react';
import {DocCheckIcon} from '../../ui/icons';
import {DOC, B7COPY} from '../content';
import {useFs} from './SurfaceFrame';
import {useTheme} from './theme';
import {morphInStyle, morphOutStyle, useFilm} from './film';

export const Doc: React.FC = () => {
  const fs = useFs();
  const {pal: c, state} = useTheme();
  const film = useFilm();
  const P = film?.P;
  const b3 = state === 'B3';
  const b7 = state === 'B7';
  const Line: React.FC<{w: string; strong?: boolean}> = ({w, strong}) => (
    <div style={{height: 12, width: w, borderRadius: 6, background: strong ? c.outlineVariant : c.surfaceContainerHigh}} />
  );
  return (
    <div style={{position: 'absolute', inset: 0, background: c.surfaceContainer, display: 'flex', flexDirection: 'column'}}>
      <div style={{height: 64, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 22px', background: c.surface, borderBottom: `1px solid ${c.outlineVariant}`}}>
        <DocCheckIcon size={30} color={c.onSurfaceVariant} />
        <span style={{fontSize: fs(26), fontWeight: 700}}>{DOC.title}</span>
        <span style={{marginLeft: 'auto', fontSize: fs(20), fontWeight: 600, padding: '2px 12px', borderRadius: 10, background: c.surfaceContainerHigh, color: c.onSurfaceVariant}}>{DOC.badge}</span>
      </div>
      <div style={{flex: 1, padding: '22px 26px 0'}}>
        {/* the page */}
        <div
          style={{
            height: '100%',
            borderRadius: '10px 10px 0 0',
            background: c.surface,
            boxShadow: c.dark ? `0 -1px 0 ${c.outlineVariant}` : '0 -1px 0 rgba(201,209,203,.8), 0 2px 10px -2px rgba(23,59,48,.18)',
            padding: '28px 30px 0',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            ...(P ? {transform: `translate(${(1 - P.page) * 90}px, ${(1 - P.page) * 40}px)`, opacity: Math.min(1, P.page * 3)} : {}),
          }}
        >
          <div style={{fontSize: fs(34), fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 6}}>{DOC.title}</div>
          <Line w="100%" strong />
          <Line w="92%" />
          <Line w="97%" />
          <Line w="64%" />
          <div style={{fontSize: fs(24), fontWeight: 700, marginTop: 22, marginBottom: 2}}>{DOC.scheduleTitle}</div>
          <div style={{borderRadius: 12, boxShadow: `inset 0 0 0 1.5px ${c.outlineVariant}`, overflow: 'hidden'}}>
            {DOC.rows.map((r, i) => {
              const amber = (b3 && r.item === '광고 집행') || (b7 && r.item === '보도자료 배포');
              const date = b7 && r.item === '광고 집행' ? '11/6' : r.date;
              const ad = r.item === '광고 집행';
              const bo = r.item === '보도자료 배포';
              return (
                <div
                  key={r.item}
                  data-anchor={P && ad ? 'doc-ad' : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '8px 18px',
                    fontSize: fs(22),
                    fontWeight: 500,
                    background: amber ? c.warningContainer : i % 2 ? c.surfaceContainerLow : c.surface,
                    boxShadow: amber ? `inset 0 0 0 2.5px ${c.warning}` : undefined,
                    borderTop: i ? `1px solid ${c.outlineVariant}` : undefined,
                    ...(P ? {position: 'relative' as const, isolation: 'isolate' as const, transform: `translateX(${(1 - (P.rows[i] ?? 1)) * 46}px)`, opacity: Math.min(1, (P.rows[i] ?? 1) * 3)} : {}),
                  }}
                >
                  {P && ad && P.ring > 0 && (
                    <div style={{position: 'absolute', inset: 0, zIndex: -1, background: c.warningContainer, boxShadow: `inset 0 0 0 2.5px ${c.warning}, 0 0 ${12 * P.ringBreath}px rgba(154,91,0,${0.45 * P.ringBreath})`, opacity: Math.min(1, P.ring * 1.6), transform: `scale(${0.94 + 0.06 * P.ring})`}} />
                  )}
                  {P && bo && P.boRing > 0 && (
                    <div style={{position: 'absolute', inset: 0, zIndex: -1, background: c.warningContainer, boxShadow: `inset 0 0 0 2.5px ${c.warning}`, opacity: Math.min(1, P.boRing * 1.6), transform: `scale(${0.94 + 0.06 * P.boRing})`}} />
                  )}
                  <span style={{flex: 1, whiteSpace: 'nowrap'}}>{r.item}</span>
                  {P && ad && (P.adRoll <= 0 || P.adRoll >= 1) ? (
                    <span style={{fontWeight: 700, fontVariantNumeric: 'tabular-nums'}}>{P.adRoll >= 1 ? '11/6' : r.date}</span>
                  ) : P && bo && P.boChip >= 0.999 && P.boMorph.out >= 1 && P.boMorph.in >= 0.999 ? (
                    <span data-anchor="doc-row" style={{padding: '1px 12px', borderRadius: 999, background: c.warning, color: '#FFFFFF', fontSize: fs(20), fontWeight: 700, whiteSpace: 'nowrap'}}>{B7COPY.waiting}</span>
                  ) : P && ad ? (
                    <span style={{position: 'relative', display: 'inline-block', overflow: 'hidden', fontWeight: 700, fontVariantNumeric: 'tabular-nums', height: '1.3em'}}>
                      <span style={{display: 'block', transform: `translateY(${-P.adRoll * 100}%)`}}>{r.date}</span>
                      <span style={{position: 'absolute', left: 0, top: 0, display: 'block', transform: `translateY(${(1 - P.adRoll) * 100}%)`}}>11/6</span>
                    </span>
                  ) : P && bo ? (
                    <span style={{position: 'relative', display: 'inline-flex', justifyContent: 'flex-end', minWidth: 64}}>
                      <span style={{fontWeight: 700, fontVariantNumeric: 'tabular-nums', opacity: 1 - Math.min(1, P.boChip * 3)}}>{date}</span>
                      {P.boChip > 0 && (
                        <span data-anchor="doc-row" style={{position: 'absolute', right: 0, top: '50%', transform: `translateY(-50%) scale(${0.8 + 0.2 * Math.min(1, P.boChip)})`, opacity: Math.min(1, P.boChip * 2), padding: '1px 12px', borderRadius: 999, background: c.warning, color: '#FFFFFF', fontSize: fs(20), fontWeight: 700, whiteSpace: 'nowrap'}}>
                          {P.boMorph.out < 1 && <span style={{display: 'inline-block', ...morphOutStyle(P.boMorph)}}>전달됨 · 반영 대기</span>}
                          {P.boMorph.in > 0 && <span style={{...morphInStyle(P.boMorph), ...(P.boMorph.out < 1 ? {position: 'absolute', right: 12, top: 1} : {})}}>{B7COPY.waiting}</span>}
                        </span>
                      )}
                    </span>
                  ) : b7 && amber ? (
                    <span data-anchor="doc-row" style={{padding: '1px 12px', borderRadius: 999, background: c.warning, color: '#FFFFFF', fontSize: fs(20), fontWeight: 700, whiteSpace: 'nowrap'}}>{B7COPY.waiting}</span>
                  ) : (
                    <span style={{fontWeight: 700, fontVariantNumeric: 'tabular-nums'}}>{date}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
