// v5 thread being drawn (storyboard-v5.md §7 "캡슐·실 끝 스프링"): the leading
// tip follows a snappy spring (`head`), the body behind it a smooth spring
// (`body`). Between the two the ribbon is a thin filament that thickens as the
// body catches up, so the thread stretches out and then settles. Same visual
// language as fx/Thread.tsx (halo, shadow, glow pulse, tapered ribbon, highlight,
// docking caps), drawn only up to the tip.
import React from 'react';
import {harmonyGradientStops} from '../../v3/tokens/video';

type Pt = {x: number; y: number};

const bez = (a: Pt, b: Pt, c: Pt, d: Pt, t: number): Pt => {
  const m = 1 - t;
  return {x: m * m * m * a.x + 3 * m * m * t * b.x + 3 * m * t * t * c.x + t * t * t * d.x, y: m * m * m * a.y + 3 * m * m * t * b.y + 3 * m * t * t * c.y + t * t * t * d.y};
};
const dbez = (a: Pt, b: Pt, c: Pt, d: Pt, t: number): Pt => {
  const m = 1 - t;
  return {x: 3 * m * m * (b.x - a.x) + 6 * m * t * (c.x - b.x) + 3 * t * t * (d.x - c.x), y: 3 * m * m * (b.y - a.y) + 6 * m * t * (c.y - b.y) + 3 * t * t * (d.y - c.y)};
};
const smooth = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** harmony gradient color at 0..1 */
const harmonyAt = (t: number) => {
  const stops = harmonyGradientStops.map((s) => ({o: parseFloat(s.offset) / 100, c: hexRgb(s.color)}));
  const x = clamp01(t);
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i].o) {
      const k = (x - stops[i - 1].o) / (stops[i].o - stops[i - 1].o);
      return `rgb(${stops[i - 1].c.map((v, j) => Math.round(v + (stops[i].c[j] - v) * k)).join(',')})`;
    }
  }
  return harmonyGradientStops[harmonyGradientStops.length - 1].color;
};

export interface ThreadDrawProps {
  p0: Pt;
  p1: Pt;
  p2: Pt;
  p3: Pt;
  id: string;
  head: number; // 0..1 leading tip (snappy spring; may overshoot slightly, clamped)
  body: number; // 0..1 trailing body (smooth spring)
  w0?: number;
  w1?: number;
  glow?: number; // 0..1 pulse
  halo?: number; // persistent halo opacity
  dock?: number; // 0..1 docking ring at the target once the tip has arrived
  shadowColor?: string;
  scale?: number; // widths scale with the camera zoom
  alpha?: number; // overall opacity (threads fade into the afterglow)
}

export const ThreadDraw: React.FC<ThreadDrawProps> = ({p0, p1, p2, p3, id, head: headIn, body, w0 = 14, w1 = 10, glow = 0, halo = 0, dock = 0, shadowColor = 'rgba(0,0,0,.45)', scale = 1, alpha = 1}) => {
  const head = clamp01(headIn);
  if (head <= 0.004 || alpha <= 0.003) return null;
  const n = Math.max(10, Math.round(72 * head));
  const half = (t: number) => {
    const taper = (w0 + (w1 - w0) * smooth(t)) / 2;
    const z = (body - t) / 0.2 + smooth(clamp01((body - 0.85) / 0.15));
    return taper * scale * (0.3 + 0.7 * smooth(clamp01(z)));
  };
  const L: Pt[] = [];
  const R: Pt[] = [];
  const HL: Pt[] = [];
  const HR: Pt[] = [];
  const C: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * head;
    const c = bez(p0, p1, p2, p3, t);
    const d = dbez(p0, p1, p2, p3, t);
    const len = Math.hypot(d.x, d.y) || 1;
    const nx = -d.y / len;
    const ny = d.x / len;
    const h = half(t);
    L.push({x: c.x + nx * h, y: c.y + ny * h});
    R.push({x: c.x - nx * h, y: c.y - ny * h});
    const h2 = h * 0.16 + 0.4;
    HL.push({x: c.x + nx * h2, y: c.y + ny * h2});
    HR.push({x: c.x - nx * h2, y: c.y - ny * h2});
    C.push(c);
  }
  const poly = (pts: Pt[]) => 'M ' + pts.map((q) => `${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' L ');
  const ribbon = poly([...L, ...R.reverse()]) + ' Z';
  const highlight = poly([...HL, ...HR.reverse()]) + ' Z';
  const center = poly(C);
  const grad = `url(#${id})`;
  const tip = C[C.length - 1];
  const dx = p3.x === p0.x ? 0.01 : 0;
  const arrived = dock > 0;
  const endColor = harmonyGradientStops[harmonyGradientStops.length - 1].color;
  return (
    <svg style={{position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', opacity: alpha}} width={1920} height={1080}>
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={p0.x} y1={p0.y} x2={p3.x + dx} y2={p3.y}>
          {harmonyGradientStops.map((s) => (
            <stop key={s.offset} offset={s.offset} stopColor={s.color} />
          ))}
        </linearGradient>
        <filter id={`${id}-b8`} filterUnits="userSpaceOnUse" x={-200} y={-200} width={2320} height={1480}>
          <feGaussianBlur stdDeviation={8} />
        </filter>
        <filter id={`${id}-b20`} filterUnits="userSpaceOnUse" x={-200} y={-200} width={2320} height={1480}>
          <feGaussianBlur stdDeviation={20} />
        </filter>
      </defs>
      {halo > 0 && <path d={center} stroke={grad} strokeWidth={56 * scale} fill="none" strokeLinecap="round" opacity={halo} filter={`url(#${id}-b20)`} />}
      <path d={ribbon} fill={shadowColor} transform="translate(5,9)" />
      {glow > 0 && <path d={center} stroke={grad} strokeWidth={26 * scale} fill="none" strokeLinecap="round" opacity={0.28 * glow} filter={`url(#${id}-b8)`} />}
      <path d={ribbon} fill={grad} />
      <path d={highlight} fill="rgba(255,255,255,.5)" transform="translate(0,-2.5)" />
      <circle cx={p0.x} cy={p0.y} r={(w0 * scale) * 0.5} fill="#3DBE8B" stroke="rgba(255,255,255,.8)" strokeWidth={1.6} />
      {!arrived && head < 0.999 && <circle cx={tip.x} cy={tip.y} r={(w0 * scale) * 0.62} fill={harmonyAt(head)} stroke="rgba(255,255,255,.9)" strokeWidth={1.8} />}
      {arrived && (
        <g transform={`translate(${p3.x} ${p3.y}) scale(${0.6 + 0.4 * dock}) translate(${-p3.x} ${-p3.y})`} opacity={Math.min(1, dock * 2)}>
          <circle cx={p3.x} cy={p3.y} r={w1 * scale * 0.5 + 5} fill="rgba(14,19,17,.55)" stroke="rgba(255,255,255,.75)" strokeWidth={2} />
          <circle cx={p3.x} cy={p3.y} r={w1 * scale * 0.5 + 0.5} fill={endColor} />
        </g>
      )}
    </svg>
  );
};

/** B7 hairline source line drawn from a context-view row to its source surface (progress 0..1) */
export const SourceDraw: React.FC<{id: string; from: Pt; to: Pt; c1: Pt; c2: Pt; p: number; alpha?: number; occluders?: string[]}> = ({id, from, to, c1, c2, p, alpha = 0.6, occluders}) => {
  if (p <= 0.003) return null;
  return (
    <svg style={{position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none'}} width={1920} height={1080}>
      <defs>
        {occluders && (
          <mask id={`${id}-m`} maskUnits="userSpaceOnUse" x={-200} y={-200} width={2320} height={1480}>
            <rect x={-200} y={-200} width={2320} height={1480} fill="white" />
            {occluders.map((q, i) => (
              <polygon key={i} points={q} fill="black" />
            ))}
          </mask>
        )}
      </defs>
      <g mask={occluders ? `url(#${id}-m)` : undefined}>
        <path d={`M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - p} stroke="#C0EBD5" strokeWidth={1.6} fill="none" opacity={alpha} strokeLinecap="round" />
        <circle cx={from.x} cy={from.y} r={3.2} fill="#C0EBD5" opacity={Math.min(1, alpha + 0.2)} />
        {p > 0.98 && <circle cx={to.x} cy={to.y} r={4} fill="none" stroke="#C0EBD5" strokeWidth={1.6} opacity={alpha} />}
      </g>
    </svg>
  );
};
