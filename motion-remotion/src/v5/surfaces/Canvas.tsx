// 디자인: a design canvas. Left tool strip, dotted canvas, one launch-banner
// artboard with a selection frame and a comment pin (the pin is the anchor the
// thread reaches in SF-B). Neutral palette; geometry only.
import React from 'react';
import {colors} from '../../v3/tokens/video';
import {DESIGN} from '../content';
import {useFs} from './SurfaceFrame';

const ink = colors.onSurface;

const ToolIcon: React.FC<{kind: 'cursor' | 'rect' | 'circle' | 'text' | 'comment'; active?: boolean}> = ({kind, active}) => (
  <div
    style={{
      width: 44,
      height: 44,
      borderRadius: 12,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: active ? ink : 'transparent',
      color: active ? '#fff' : colors.onSurfaceVariant,
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

export const Canvas: React.FC = () => {
  const fs = useFs();
  const ART = {x: 126, y: 118, w: 528, h: 276};
  return (
    <div style={{position: 'absolute', inset: 0, background: colors.surfaceContainer}}>
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
          background: colors.surface,
          borderBottom: `1px solid ${colors.outlineVariant}`,
        }}
      >
        <span style={{fontSize: fs(26), fontWeight: 700}}>{DESIGN.file}</span>
        <span style={{marginLeft: 'auto', fontSize: fs(20), fontWeight: 600, color: colors.onSurfaceVariant}}>100%</span>
      </div>
      {/* tool strip */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 64,
          bottom: 0,
          width: 72,
          background: colors.surface,
          borderRight: `1px solid ${colors.outlineVariant}`,
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
          backgroundColor: colors.surfaceContainer,
          backgroundImage: 'radial-gradient(rgba(74,86,80,.28) 1.6px, transparent 1.7px)',
          backgroundSize: '26px 26px',
        }}
      >
        <div style={{position: 'absolute', left: ART.x - 24, top: ART.y - 46, fontSize: fs(20), fontWeight: 600, color: colors.onSurfaceVariant}}>{DESIGN.frameLabel}</div>
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
          }}
        >
          {/* abstract poster geometry */}
          <div style={{position: 'absolute', right: -60, top: -80, width: 300, height: 300, borderRadius: '50%', background: colors.surface, opacity: 0.8}} />
          <div style={{position: 'absolute', right: 40, bottom: 28, width: 120, height: 120, borderRadius: 26, background: colors.brandInk, opacity: 0.9, transform: 'rotate(12deg)'}} />
          <div style={{position: 'absolute', right: 150, bottom: 56, width: 62, height: 62, borderRadius: '50%', background: colors.outlineVariant}} />
          <div style={{position: 'absolute', left: 34, top: 44, fontSize: 62, fontWeight: 800, letterSpacing: '-0.02em', color: colors.brandInk, lineHeight: 1.05}}>{DESIGN.banner}</div>
          <div style={{position: 'absolute', left: 36, top: 126, fontSize: fs(30), fontWeight: 600, color: colors.onSurfaceVariant}}>{DESIGN.sub}</div>
          <div style={{position: 'absolute', left: 36, bottom: 34, width: 150, height: 14, borderRadius: 7, background: colors.brandInk, opacity: 0.55}} />
        </div>
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
        {/* comment pin (anchor for the thread) */}
        <div
          data-anchor="comment-pin"
          style={{
            position: 'absolute',
            left: ART.x + ART.w - 56,
            top: ART.y - 70,
            width: 52,
            height: 52,
            borderRadius: '50% 50% 50% 8%',
            background: ink,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: fs(30),
            fontWeight: 700,
            boxShadow: '0 4px 8px -2px rgba(23,59,48,.45)',
          }}
        >
          {DESIGN.pin}
        </div>
      </div>
    </div>
  );
};
