// v5 B2: a dashed line leaves the capsule toward another surface, never arrives
// (it grows to `reach`), hangs, then breaks: the outer piece detaches, falls and
// goes dark; the stub left on the capsule side loses its light. Pure function of
// the progress values passed in.
import React from 'react';

type Pt = {x: number; y: number};
const bez = (a: Pt, b: Pt, c: Pt, d: Pt, t: number): Pt => {
  const m = 1 - t;
  return {x: m * m * m * a.x + 3 * m * m * t * b.x + 3 * m * t * t * c.x + t * t * t * d.x, y: m * m * m * a.y + 3 * m * m * t * b.y + 3 * m * t * t * c.y + t * t * t * d.y};
};

export interface DashBreakProps {
  from: Pt;
  to: Pt;
  c1: Pt;
  c2: Pt;
  grow: number; // 0..1 growth toward `reach`
  fall: number; // 0..1 after the break
  reach?: number; // fraction of the path that is ever drawn
  cut?: number; // break point as a fraction of the drawn part
  scale?: number;
  phase?: number; // dash marching (frame)
}

export const DashBreak: React.FC<DashBreakProps> = ({from, to, c1, c2, grow, fall, reach = 0.6, cut = 0.5, scale = 1, phase = 0}) => {
  if (grow <= 0.004) return null;
  const end = reach * grow;
  const pts = (a: number, b: number) => {
    const n = Math.max(4, Math.round(40 * (b - a)));
    return Array.from({length: n + 1}, (_, i) => bez(from, c1, c2, to, a + ((b - a) * i) / n));
  };
  const path = (p: Pt[]) => 'M ' + p.map((q) => `${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' L ');
  const tc = end * cut;
  const dash = `${15 * scale} ${12 * scale}`;
  const sw = 6.5 * scale;
  const color = '#BEECD6';
  const broken = fall > 0;
  const inner = pts(0, broken ? tc : end);
  const outer = broken ? pts(tc, end) : [];
  const g = fall * fall;
  const stubOpacity = broken ? Math.max(0, 0.9 - 1.0 * fall) : 0.9;
  const tipPt = inner[inner.length - 1];
  return (
    <svg style={{position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none'}} width={1920} height={1080}>
      <path d={path(inner)} stroke="#3DBE8B" strokeWidth={sw * 2.6} fill="none" strokeLinecap="round" opacity={stubOpacity * 0.16} />
      <path d={path(inner)} stroke={color} strokeWidth={sw} strokeDasharray={dash} strokeDashoffset={-phase * 0.7} strokeLinecap="round" fill="none" opacity={stubOpacity} />
      {!broken && <circle cx={tipPt.x} cy={tipPt.y} r={5.5 * scale} fill={color} opacity={0.95} />}
      {broken && fall < 0.6 && <circle cx={tipPt.x} cy={tipPt.y} r={4.5 * scale * (1 - fall)} fill={color} opacity={0.8 * (1 - fall / 0.6)} />}
      {broken && outer.length > 1 && (
        <g transform={`translate(${tipPt.x} ${tipPt.y}) rotate(${fall * 38}) translate(${-tipPt.x} ${-tipPt.y}) translate(${fall * 10}, ${g * 190 * scale})`} opacity={Math.max(0, 1 - fall * 1.15) * 0.9}>
          <path d={path(outer)} stroke={color} strokeWidth={sw} strokeDasharray={dash} strokeDashoffset={-phase * 0.7} strokeLinecap="round" fill="none" />
        </g>
      )}
    </svg>
  );
};
