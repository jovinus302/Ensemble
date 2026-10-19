// v5 thread (pattern: v3 Tube.tsx): a screen-space harmony tube drawn in the 2D
// overlay between projected surface anchors. The tube is a filled, tapered
// ribbon sampled from a cubic bezier (width w0 at the PM tile -> w1 at the
// target) instead of a constant stroke, so branches do not read as neon tubes.
// Layers, bottom to top: halo (the persistent light the thread casts, wide +
// blurred), own cast shadow, glow (the f600 breathing pulse), the ribbon, a thin
// highlight, then end caps (a dot at the origin, a docking ring at the anchor).
// The gradient runs in user space from the start anchor to the end anchor so
// every branch shows the full harmony sweep regardless of its bounding box.
import React from 'react';
import {harmonyGradientStops} from '../../v3/tokens/video';

type Pt = {x: number; y: number};

export interface ThreadProps {
  p0: Pt;
  p1: Pt; // bezier control points (absolute screen px)
  p2: Pt;
  p3: Pt;
  gradientId: string;
  w0?: number;
  w1?: number;
  glow?: number; // 0..1, the pulse layer (stroke 28, opacity .35 x glow, blur 8)
  halo?: number; // opacity of the persistent halo (width 56, blur 20)
  shadowColor?: string;
  alpha?: number; // overall opacity (afterglow threads)
  caps?: boolean;
  occluders?: string[]; // screen-space polygons ("x,y x,y ...") of faces in front of the thread: it passes behind them
}

const bez = (a: Pt, b: Pt, c: Pt, d: Pt, t: number): Pt => {
  const m = 1 - t;
  return {
    x: m * m * m * a.x + 3 * m * m * t * b.x + 3 * m * t * t * c.x + t * t * t * d.x,
    y: m * m * m * a.y + 3 * m * m * t * b.y + 3 * m * t * t * c.y + t * t * t * d.y,
  };
};
const dbez = (a: Pt, b: Pt, c: Pt, d: Pt, t: number): Pt => {
  const m = 1 - t;
  return {
    x: 3 * m * m * (b.x - a.x) + 6 * m * t * (c.x - b.x) + 3 * t * t * (d.x - c.x),
    y: 3 * m * m * (b.y - a.y) + 6 * m * t * (c.y - b.y) + 3 * t * t * (d.y - c.y),
  };
};

/** closed polygon around the bezier with half-width fn(t) */
export const ribbon = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, half: (t: number) => number, n = 72) => {
  const L: Pt[] = [];
  const R: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const c = bez(p0, p1, p2, p3, t);
    const d = dbez(p0, p1, p2, p3, t);
    const len = Math.hypot(d.x, d.y) || 1;
    const nx = -d.y / len;
    const ny = d.x / len;
    const h = half(t);
    L.push({x: c.x + nx * h, y: c.y + ny * h});
    R.push({x: c.x - nx * h, y: c.y - ny * h});
  }
  const pts = [...L, ...R.reverse()];
  return 'M ' + pts.map((q) => `${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' L ') + ' Z';
};

export const bezierPoints = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 100) => Array.from({length: n + 1}, (_, i) => bez(p0, p1, p2, p3, i / n));

export const OccluderMask: React.FC<{id: string; polys?: string[]}> = ({id, polys}) => (
  <mask id={id} maskUnits="userSpaceOnUse" x={-200} y={-200} width={2320} height={1480}>
    <rect x={-200} y={-200} width={2320} height={1480} fill="white" />
    {(polys ?? []).map((q, i) => (
      <polygon key={i} points={q} fill="black" />
    ))}
  </mask>
);

export const Thread: React.FC<ThreadProps> = ({p0, p1, p2, p3, gradientId, w0 = 14, w1 = 10, glow = 0, halo = 0, shadowColor = 'rgba(0,0,0,.4)', alpha = 1, caps = true, occluders}) => {
  const blurId = `${gradientId}-b8`;
  const haloId = `${gradientId}-b20`;
  const grad = `url(#${gradientId})`;
  const dx = p3.x === p0.x ? 0.01 : 0;
  const d = `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`;
  const ease = (t: number) => t * t * (3 - 2 * t);
  const half = (k: number) => (t: number) => ((w0 + (w1 - w0) * ease(t)) / 2) * k;
  const endColor = harmonyGradientStops[harmonyGradientStops.length - 1].color;
  return (
    <svg style={{position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', opacity: alpha}} width={1920} height={1080}>
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={p0.x} y1={p0.y} x2={p3.x + dx} y2={p3.y}>
          {harmonyGradientStops.map((s) => (
            <stop key={s.offset} offset={s.offset} stopColor={s.color} />
          ))}
        </linearGradient>
        <filter id={blurId} filterUnits="userSpaceOnUse" x={-200} y={-200} width={2320} height={1480}>
          <feGaussianBlur stdDeviation={8} />
        </filter>
        {occluders && <OccluderMask id={`${gradientId}-m`} polys={occluders} />}
        <filter id={haloId} filterUnits="userSpaceOnUse" x={-200} y={-200} width={2320} height={1480}>
          <feGaussianBlur stdDeviation={20} />
        </filter>
      </defs>
      <g mask={occluders ? `url(#${gradientId}-m)` : undefined}>
      {halo > 0 && <path d={d} stroke={grad} strokeWidth={56} fill="none" strokeLinecap="round" opacity={halo} filter={`url(#${haloId})`} />}
      <path d={ribbon(p0, p1, p2, p3, half(1))} fill={shadowColor} transform="translate(5,9)" />
      {glow > 0 && <path d={d} stroke={grad} strokeWidth={26} fill="none" strokeLinecap="round" opacity={0.28 * glow} filter={`url(#${blurId})`} />}
      <path d={ribbon(p0, p1, p2, p3, half(1))} fill={grad} />
      <path d={ribbon(p0, p1, p2, p3, (t) => half(0.16)(t) + 0.4)} fill="rgba(255,255,255,.5)" transform="translate(0,-2.5)" />
      {caps && (
        <>
          <circle cx={p0.x} cy={p0.y} r={w0 * 0.5} fill="#3DBE8B" stroke="rgba(255,255,255,.8)" strokeWidth={1.6} />
          <circle cx={p3.x} cy={p3.y} r={w1 * 0.5 + 5} fill="rgba(14,19,17,.55)" stroke="rgba(255,255,255,.75)" strokeWidth={2} />
          <circle cx={p3.x} cy={p3.y} r={w1 * 0.5 + 0.5} fill={endColor} />
        </>
      )}
      </g>
    </svg>
  );
};

/** B7: a hairline from a context-view row to its source surface */
export const SourceLine: React.FC<{id: string; from: Pt; to: Pt; c1: Pt; c2: Pt; alpha?: number; occluders?: string[]}> = ({id, from, to, c1, c2, alpha = 0.6, occluders}) => (
  <svg style={{position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none'}} width={1920} height={1080}>
    <defs>{occluders && <OccluderMask id={`${id}-m`} polys={occluders} />}</defs>
    <g mask={occluders ? `url(#${id}-m)` : undefined}>
    <path d={`M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`} stroke="#C0EBD5" strokeWidth={1.6} fill="none" opacity={alpha} strokeLinecap="round" />
    <circle cx={from.x} cy={from.y} r={3.2} fill="#C0EBD5" opacity={Math.min(1, alpha + 0.2)} />
    <circle cx={to.x} cy={to.y} r={4} fill="none" stroke="#C0EBD5" strokeWidth={1.6} opacity={alpha} />
    </g>
  </svg>
);
