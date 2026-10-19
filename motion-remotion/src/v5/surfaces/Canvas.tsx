// 디자인: a design canvas. Left tool strip, dotted canvas, one launch-banner
// artboard with a selection frame and a comment pin (the pin is the anchor the
// thread reaches in SF-B). Neutral palette; geometry only.
import React from 'react';
import {colors} from '../../v3/tokens/video';
import {DESIGN, B3COPY} from '../content';
import {useFs} from './SurfaceFrame';
import {useTheme} from './theme';
import {morphInStyle, morphOutStyle, useFilm} from './film';

const ToolIcon: React.FC<{kind: 'cursor' | 'rect' | 'circle' | 'text' | 'comment'; active?: boolean}> = ({kind, active}) => {
  const {pal: c} = useTheme();
  return (
  <div
    style={{
      width: 44,
      height: 44,
      borderRadius: 12,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: active ? c.onSurface : 'transparent',
      color: active ? c.onInk : c.onSurfaceVariant,
    }}
  >
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {kind === 'cursor' && <path d="M6 4l12 7-5 1.5L11 18z" fill="currentColor" />}
      {kind === 'rect' && <rect x="4.5" y="6" width="15" height="12" rx="2" />}
      {kind === 'circle' && <circle cx="12" cy="12" r="7.5" />}
      {kind === 'text' && <path d="M6 7V5.5h12V7M12 5.5V18.5M9.5 18.5h5" />}
      {kind === 'comment' && <path d="M5 6.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-6l-4 3.5v-3.5H7a2 2 0 0 1-2-2z" />}
    </svg>
  </div>
  );
};

/** banner date "10.30" -> "11.06": the three changing digits roll like an odometer */
const RollBanner: React.FC<{roll: number[]}> = ({roll}) => {
  const digit = (from: string, to: string, t: number, key: string) => (
    <span key={key} style={{position: 'relative', display: 'inline-block', overflow: 'hidden', height: '1.12em', verticalAlign: 'top'}}>
      <span style={{display: 'block', transform: `translateY(${-t * 100}%)`}}>{from}</span>
      <span style={{position: 'absolute', left: 0, top: 0, display: 'block', transform: `translateY(${(1 - t) * 100}%)`}}>{to}</span>
    </span>
  );
  return (
    <>
      1{digit('0', '1', roll[0], 'a')}.{digit('3', '0', roll[1], 'b')}
      {digit('0', '6', roll[2], 'c')} 출시
    </>
  );
};

export const Canvas: React.FC = () => {
  const fs = useFs();
  const {pal: c, state} = useTheme();
  const film = useFilm();
  const D = film?.D;
  const ink = c.onSurface;
  const themed = state !== undefined; // v6 frames use a compact artboard so the comment card fits under it
  const b7 = state === 'B7';
  const b3 = state === 'B3' || b7; // PM Agent comment card present
  const showCard = b3 || !!film; // film: the card is always laid out (anchors stay put) and revealed by D.card
  const ART = {x: 126, y: themed ? 66 : 118, w: 528, h: 276};
  return (
    <div style={{position: 'absolute', inset: 0, background: c.surfaceContainer}}>
      {/* top bar */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: 64,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '0 22px',
          background: c.surface,
          borderBottom: `1px solid ${c.outlineVariant}`,
        }}
      >
        <span style={{fontSize: fs(26), fontWeight: 700}}>{DESIGN.file}</span>
        <span style={{marginLeft: 'auto', fontSize: fs(20), fontWeight: 600, color: c.onSurfaceVariant}}>100%</span>
      </div>
      {/* tool strip */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 64,
          bottom: 0,
          width: 72,
          background: c.surface,
          borderRight: `1px solid ${c.outlineVariant}`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          paddingTop: 14,
        }}
      >
        <ToolIcon kind="cursor" active />
        <ToolIcon kind="rect" />
        <ToolIcon kind="circle" />
        <ToolIcon kind="text" />
        <ToolIcon kind="comment" />
      </div>
      {/* dotted canvas */}
      <div
        style={{
          position: 'absolute',
          left: 72,
          right: 0,
          top: 64,
          bottom: 0,
          backgroundColor: c.surfaceContainer,
          backgroundImage: 'radial-gradient(rgba(74,86,80,.28) 1.6px, transparent 1.7px)',
          backgroundSize: '26px 26px',
        }}
      >
        <div style={{position: 'absolute', left: ART.x - 24, top: ART.y - 46, fontSize: fs(20), fontWeight: 600, color: c.onSurfaceVariant}}>{DESIGN.frameLabel}</div>
        {/* artboard */}
        <div
          style={{
            position: 'absolute',
            left: ART.x - 24,
            top: ART.y - 4,
            width: ART.w,
            height: ART.h,
            borderRadius: 6,
            background: colors.secondaryContainer,
            overflow: 'hidden',
            boxShadow: '0 1px 2px rgba(23,59,48,.2), 0 10px 22px -8px rgba(23,59,48,.28)',
            ...(D ? {transformOrigin: '50% 0', transform: `scaleY(${0.04 + 0.96 * D.unfold})`, opacity: Math.min(1, D.unfold * 4)} : {}),
          }}
        >
          {/* abstract poster geometry */}
          <div style={{position: 'absolute', right: -60, top: -80, width: 300, height: 300, borderRadius: '50%', background: colors.surface, opacity: 0.8}} />
          <div style={{position: 'absolute', right: 40, bottom: 28, width: 120, height: 120, borderRadius: 26, background: colors.brandInk, opacity: 0.9, transform: 'rotate(12deg)'}} />
          <div style={{position: 'absolute', right: 150, bottom: 56, width: 62, height: 62, borderRadius: '50%', background: colors.outlineVariant}} />
          {(state === 'B3' || D) && (
            <div
              data-anchor="d-ring"
              style={{
                position: 'absolute',
                left: 22,
                top: 36,
                width: 186,
                height: 78,
                borderRadius: 14,
                border: `4px solid ${colors.warning}`,
                background: colors.warningContainer,
                boxSizing: 'border-box',
                ...(D ? {opacity: Math.min(1, D.ring * 1.6), transform: `scale(${0.8 + 0.2 * D.ring + 0.04 * D.ringBreath})`, boxShadow: `0 0 ${12 * D.ringBreath}px rgba(154,91,0,${0.45 * D.ringBreath})`} : {}),
              }}
            />
          )}
          <div style={{position: 'absolute', left: 34, top: 44, fontSize: 62, fontWeight: 800, letterSpacing: '-0.02em', color: colors.brandInk, lineHeight: 1.05}}>{D && D.roll[0] > 0 && D.roll[2] < 1 ? <RollBanner roll={D.roll} /> : b7 || (D && D.roll[2] >= 1) ? DESIGN.bannerNew : DESIGN.banner}</div>
          <div style={{position: 'absolute', left: 36, top: 126, fontSize: fs(30), fontWeight: 600, color: colors.onSurfaceVariant}}>{DESIGN.sub}</div>
          <div style={{position: 'absolute', left: 36, bottom: 34, width: 150, height: 14, borderRadius: 7, background: colors.brandInk, opacity: 0.55}} />
        </div>
        {/* a collaborator's cursor drifting over the artboard (film micro motion) */}
        {D && D.cursor.a > 0 && (
          <div style={{position: 'absolute', left: ART.x + 190 + D.cursor.x + (ART.x + 211 - (ART.x + 190 + D.cursor.x)) * D.cursor.toBanner, top: ART.y + ART.h - 112 + D.cursor.y + (ART.y + 86 - (ART.y + ART.h - 112 + D.cursor.y)) * D.cursor.toBanner, opacity: D.cursor.a, pointerEvents: 'none'}}>
            <svg width="34" height="34" viewBox="0 0 24 24"><path d="M5 3l13 7-6 1.8L9.6 18z" fill="#2B6A52" stroke="#FFFFFF" strokeWidth="1.6" strokeLinejoin="round" /></svg>
            <div style={{position: 'absolute', left: 24, top: 26, padding: '2px 12px', borderRadius: 10, background: '#2B6A52', color: '#FFFFFF', fontSize: fs(20), fontWeight: 700, whiteSpace: 'nowrap'}}>서연</div>
          </div>
        )}
        {/* selection frame + handles */}
        <div
          style={{
            position: 'absolute',
            left: ART.x - 24 - 4,
            top: ART.y - 8,
            width: ART.w + 8,
            height: ART.h + 8,
            border: `2px solid ${ink}`,
            borderRadius: 4,
            pointerEvents: 'none',
            ...(D ? {opacity: D.sel} : {}),
          }}
        >
          {[
            [-7, -7],
            [ART.w - 1, -7],
            [-7, ART.h - 1],
            [ART.w - 1, ART.h - 1],
          ].map(([x, y], i) => (
            <div key={i} style={{position: 'absolute', left: x, top: y, width: 12, height: 12, background: '#fff', border: `2px solid ${ink}`, borderRadius: 3}} />
          ))}
        </div>
        {/* B3: PM Agent comment card under the artboard; the pin is the thread anchor */}
        {showCard && (
          <div
            data-anchor="d-card"
            style={{
              ...(D ? {clipPath: `inset(0 ${(1 - D.card) * 100}% 0 0 round 16px)`, opacity: D.card > 0 ? 1 : 0} : {}),
              position: 'absolute',
              left: 24,
              top: ART.y + ART.h + 16,
              width: 600,
              height: 88,
              borderRadius: 16,
              background: c.surface,
              boxShadow: `inset 0 0 0 1.5px ${c.outlineVariant}, 0 6px 14px -8px rgba(0,0,0,.35)`,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '0 14px',
            }}
          >
            <div
              data-anchor="comment-pin"
              style={{
                flexShrink: 0,
                width: 62,
                height: 62,
                borderRadius: '50% 50% 50% 8%',
                background: c.primary,
                color: c.onPrimary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: fs(20),
                fontWeight: 800,
                ...(D ? {transform: `scale(${0.4 + 0.6 * D.cardPin})`, opacity: Math.min(1, D.cardPin * 2)} : {}),
              }}
            >
              {B3COPY.pmInitial}
            </div>
            <div style={{flex: 1, position: 'relative', fontSize: fs(22), fontWeight: 600, lineHeight: 1.22, color: c.onSurface}}>
              <div style={D ? {...morphOutStyle(D.chipMorph), visibility: D.chipMorph.out >= 1 ? 'hidden' : 'visible'} : undefined}>{b7 ? B3COPY.pinTextB7 : B3COPY.pinText}</div>
              {D && D.chipMorph.in > 0 && <div style={{position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)'}}><div style={morphInStyle(D.chipMorph)}>{B3COPY.pinTextB7}</div></div>}
            </div>
            <div style={{flexShrink: 0, padding: '4px 14px', borderRadius: 999, background: c.primaryContainer, color: c.onPrimaryContainer, fontSize: fs(20), fontWeight: 700, position: 'relative', ...(D ? {opacity: Math.min(1, D.cardChip * 2), transform: `scale(${0.8 + 0.2 * D.cardChip})`} : {})}}>
              <span style={D ? {...morphOutStyle(D.chipMorph), display: 'inline-block', visibility: D.chipMorph.out >= 1 ? 'hidden' : 'visible'} : undefined}>{b7 ? B3COPY.reflected : B3COPY.delivered}</span>
              {D && D.chipMorph.in > 0 && <span style={{...morphInStyle(D.chipMorph), position: 'absolute', left: 14, top: 4}}>{B3COPY.reflected}</span>}
            </div>
          </div>
        )}
        {/* comment pin */}
        {!b3 && (!D || D.pin1 > 0) && <div
          data-anchor={D ? 'comment-pin1' : 'comment-pin'}
          style={{
            position: 'absolute',
            left: ART.x + ART.w - 56,
            top: ART.y - 70,
            width: 52,
            height: 52,
            borderRadius: '50% 50% 50% 8%',
            background: ink,
            color: c.onInk,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: fs(30),
            fontWeight: 700,
            boxShadow: '0 4px 8px -2px rgba(23,59,48,.45)',
            ...(D ? {opacity: D.pin1, transform: `scale(${0.7 + 0.3 * D.pin1})`} : {}),
          }}
        >
          {DESIGN.pin}
        </div>}
      </div>
    </div>
  );
};
