// v3 §3 "AI glow" — filter-free: 4 overlapping radial gradients, one AI signal
// on screen at a time. Sits behind the card (z-2), 48px larger on each side.
//
// Round-3 fix: the previous version sized each gradient's radius as a
// percentage of the *container's* farthest-corner distance ("transparent
// 42%"), which coincidentally matched the container's own edge for some box
// sizes and read as a hard-edged pastel rectangle instead of a soft halo.
// Now each blob has an explicit, container-independent pixel radius, so the
// fade-to-transparent point never depends on (and can't coincide with) the
// container's edge. Callers should size the container generously bigger than
// `radius` (see `pad`) so the blob has room to fully fade before any edge.
import React from 'react';
import {sineLoop} from '../../tokens/motion';

export interface GlowFieldProps {
  x: number; // card left (logical)
  y: number; // card top (logical)
  w: number;
  h: number;
  frame: number;
  pad?: number; // extra size beyond the card, per side (spec: +48 larger)
  radius?: number; // fixed px radius per blob — independent of container size
}

const STOPS = [
  {color: '#3DBE8B', pos: '25% 55%'},
  {color: '#4C8DF6', pos: '45% 35%'},
  {color: '#9B7BF7', pos: '65% 60%'},
  {color: '#F08BB4', pos: '82% 40%'},
];

export const GlowField: React.FC<GlowFieldProps> = ({x, y, w, h, frame, pad = 48, radius = 170}) => {
  const t = sineLoop(frame, 2400);
  const opacity = 0.22 + (0.4 - 0.22) * t;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - pad,
        top: y - pad,
        width: w + pad * 2,
        height: h + pad * 2,
        pointerEvents: 'none',
        opacity,
      }}
    >
      {STOPS.map((s, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(circle ${radius}px at ${s.pos}, rgba(${hexToRgb(s.color)},.5) 0%, rgba(${hexToRgb(s.color)},.18) 40%, transparent 100%)`,
          }}
        />
      ))}
    </div>
  );
};

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r},${g},${b}`;
}
