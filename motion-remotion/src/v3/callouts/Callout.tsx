// v3 §3 "콜아웃" + §7 step 9 — 2D overlay callout: projects a 3D board anchor
// through the same Rig matrix (project.ts), draws an anchor dot, a leader
// line (40px horizontal then diagonal to the chip), then the label chip.
// Must live OUTSIDE the Rig (spec §3 "콜아웃·노이즈는 2D 오버레이(3D 밖)").
import React from 'react';
import type {CameraPose} from '../tokens/video';
import {projectPoint} from '../stage/project';
import {FONT_FAMILY} from '../../tokens/fonts';
import {px} from '../tokens/video';

export interface CalloutProps {
  pose: CameraPose;
  anchor: {x: number; y: number; z: number}; // board-logical coords + risen z
  label: string;
  dotColor?: string;
  side?: 'left' | 'right';
  chipOffsetX?: number; // how far past the 40px horizontal stub the chip sits
  chipOffsetY?: number;
}

export const Callout: React.FC<CalloutProps> = ({
  pose,
  anchor,
  label,
  dotColor = '#2B6A52',
  side = 'right',
  chipOffsetX = 160,
  chipOffsetY = -40,
}) => {
  const p = projectPoint(pose, anchor.x, anchor.y, anchor.z);
  const dir = side === 'right' ? 1 : -1;
  const stubX = p.x + dir * 40;
  const chipX = p.x + dir * chipOffsetX;
  const chipY = p.y + chipOffsetY;

  return (
    <>
      <svg style={{position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none'}} width="100%" height="100%">
        <path
          // Round-8 fix: the leader used to stop 60px short of the chip and read as
          // disconnected; end it just under the chip's near edge (the chip paints on top).
          d={`M ${p.x} ${p.y} L ${stubX} ${p.y} L ${chipX + dir * 8} ${chipY}`}
          stroke="rgba(23,59,48,.55)"
          strokeWidth={3}
          strokeLinecap="round"
          fill="none"
        />
        <circle cx={p.x} cy={p.y} r={6} fill="#FFFFFF" />
        <circle cx={p.x} cy={p.y} r={4} fill={dotColor} />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: dir === 1 ? chipX : undefined,
          right: dir === -1 ? 1920 - chipX : undefined,
          top: chipY - 32,
          height: 64,
          padding: '0 28px',
          display: 'flex',
          alignItems: 'center',
          borderRadius: 9999,
          background: 'linear-gradient(180deg, #FFFFFF 0%, #F3F1EC 100%)',
          boxShadow:
            'inset 0 1px 0 rgba(255,255,255,.8), inset 0 -1px 0 rgba(0,0,0,.06), 0 2px 4px rgba(23,59,48,.12), 0 8px 16px -6px rgba(23,59,48,.18)',
          whiteSpace: 'nowrap',
          gap: 10,
        }}
      >
        <span style={{width: 14, height: 14, borderRadius: '50%', background: dotColor, flexShrink: 0}} />
        <span style={{fontFamily: FONT_FAMILY, fontSize: 36, fontWeight: 700, color: '#173B30'}}>{label}</span>
      </div>
    </>
  );
};

// Debug-only: a small 3D dot meant to be rendered *inside* the Rig at the same
// anchor, so a reviewer can compare it against Callout's projected 2D dot and
// confirm the DOMMatrix order matches the CSS transform order (§6 "콜아웃 투영").
export const DebugAnchorDot3D: React.FC<{x: number; y: number; z: number; color?: string}> = ({x, y, z, color = '#F08BB4'}) => (
  <div
    style={{
      position: 'absolute',
      left: px(x) - 6,
      top: px(y) - 6,
      width: 12,
      height: 12,
      borderRadius: '50%',
      background: color,
      transform: `translateZ(${px(z)}px)`,
      boxShadow: '0 0 0 2px #fff',
    }}
  />
);
