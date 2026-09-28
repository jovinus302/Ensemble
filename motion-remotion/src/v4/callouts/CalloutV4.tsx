// v4 callout: a 2D overlay whose anchor is the Z-inclusive projection of a
// board point — through the hero transform when the point is on the lifted
// hero card (projectV4.projectAnchor), then v3's rig + perspective. Visual
// language follows v3's Callout (dot, 40px stub, short diagonal ending under
// the chip's near edge, embossed pill), with the chip font as a prop so a
// chip can be fitted into the empty space it is placed on.
import React from 'react';
import type {CameraPose} from '../../v3/tokens/video';
import {FONT_FAMILY} from '../../tokens/fonts';
import {px} from '../../v3/tokens/video';
import {projectAnchor} from '../stage/projectV4';
import type {Rect} from '../stage/projectV4';

export interface CalloutV4Props {
  pose: CameraPose;
  anchor: {x: number; y: number; z?: number}; // board-logical
  hero?: {card: Rect; rise: number}; // set when the anchor sits on the hero card
  label: string;
  dotColor?: string;
  side?: 'left' | 'right';
  chipDx: number; // screen px from anchor to the chip's near edge
  chipDy: number; // screen px from anchor to the chip's vertical center
  fontSize?: number;
  chipHeight?: number;
}

export const CalloutV4: React.FC<CalloutV4Props> = ({pose, anchor, hero, label, dotColor = '#2B6A52', side = 'right', chipDx, chipDy, fontSize = 36, chipHeight = 64}) => {
  const p = projectAnchor(pose, anchor, hero);
  const dir = side === 'right' ? 1 : -1;
  const stubX = p.x + dir * 40;
  const chipX = p.x + dir * chipDx;
  const chipY = p.y + chipDy;
  return (
    <>
      <svg style={{position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none'}} width={1920} height={1080}>
        <path d={`M ${p.x} ${p.y} L ${stubX} ${p.y} L ${chipX + dir * 8} ${chipY}`} stroke="rgba(23,59,48,.55)" strokeWidth={3} strokeLinecap="round" fill="none" />
        <circle cx={p.x} cy={p.y} r={6} fill="#FFFFFF" />
        <circle data-v4="callout-dot" cx={p.x} cy={p.y} r={4} fill={dotColor} />
      </svg>
      <div
        data-v4="callout-chip"
        style={{
          position: 'absolute',
          left: dir === 1 ? chipX : undefined,
          right: dir === -1 ? 1920 - chipX : undefined,
          top: chipY - chipHeight / 2,
          height: chipHeight,
          padding: `0 ${Math.round(chipHeight * 0.4)}px`,
          display: 'flex',
          alignItems: 'center',
          borderRadius: 9999,
          background: 'linear-gradient(180deg, #FFFFFF 0%, #F3F1EC 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,.8), inset 0 -1px 0 rgba(0,0,0,.06), 0 2px 4px rgba(23,59,48,.12), 0 8px 16px -6px rgba(23,59,48,.18)',
          whiteSpace: 'nowrap',
          gap: 10,
        }}
      >
        <span style={{width: 14, height: 14, borderRadius: '50%', background: dotColor, flexShrink: 0}} />
        <span style={{fontFamily: FONT_FAMILY, fontSize, fontWeight: 700, color: '#173B30'}}>{label}</span>
      </div>
    </>
  );
};

// ---- projection debug (design-v4 §5: overlay 3D point and its 2D projection) ----

// Rendered INSIDE the 3D tree at the anchor: in a HeroLift's card box (card-
// relative coords) when the anchor is on the hero, else in the board body.
export const DebugDot3D: React.FC<{x: number; y: number; z?: number}> = ({x, y, z = 0}) => (
  <div
    data-v4="debug-3d"
    style={{
      position: 'absolute',
      left: px(x) - 12,
      top: px(y) - 12,
      width: 24,
      height: 24,
      borderRadius: '50%',
      background: '#FF00FF',
      transform: z ? `translateZ(${px(z)}px)` : undefined,
    }}
  />
);

// Rendered in the 2D overlay at the projected point (ring; the 3D dot shows through it).
export const DebugRing2D: React.FC<{pose: CameraPose; anchor: {x: number; y: number; z?: number}; hero?: {card: Rect; rise: number}}> = ({pose, anchor, hero}) => {
  const p = projectAnchor(pose, anchor, hero);
  return (
    <div
      data-v4="debug-2d"
      style={{position: 'absolute', left: p.x - 20, top: p.y - 20, width: 40, height: 40, borderRadius: '50%', border: '3px solid #00C8FF', boxSizing: 'border-box'}}
    >
      <div style={{position: 'absolute', left: 16.5, top: -43, width: 1, height: 120, background: '#00C8FF'}} />
      <div style={{position: 'absolute', top: 16.5, left: -43, height: 1, width: 120, background: '#00C8FF'}} />
    </div>
  );
};
