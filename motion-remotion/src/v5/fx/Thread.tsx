// v5 thread (pattern: v3 Tube.tsx): a screen-space harmony tube drawn in the 2D
// overlay between projected surface anchors. Layers, bottom to top: halo (the
// persistent light the thread casts, wide + blurred), own cast shadow, glow
// (the f600 breathing pulse, stroke 28), the tube itself, a thin highlight.
// The gradient runs in user space from the start anchor to the end anchor so
// every branch shows the full harmony sweep regardless of its bounding box.
import React from 'react';
import {harmonyGradientStops} from '../../v3/tokens/video';

export interface ThreadProps {
  d: string;
  from: {x: number; y: number};
  to: {x: number; y: number};
  gradientId: string;
  width?: number;
  glow?: number; // 0..1, the pulse layer (stroke 28, opacity .35 x glow, blur 8)
  halo?: number; // opacity of the persistent halo (width 56, blur 20)
  shadowColor?: string;
  drawProgress?: number;
}

export const Thread: React.FC<ThreadProps> = ({d, from, to, gradientId, width = 12, glow = 0, halo = 0, shadowColor = 'rgba(0,0,0,.4)', drawProgress = 1}) => {
  const dash = {pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - drawProgress};
  const blurId = `${gradientId}-b8`;
  const haloId = `${gradientId}-b20`;
  const grad = `url(#${gradientId})`;
  const dx = to.x === from.x ? 0.01 : 0;
  return (
    <svg style={{position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none'}} width={1920} height={1080}>
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={from.x} y1={from.y} x2={to.x + dx} y2={to.y}>
          {harmonyGradientStops.map((s) => (
            <stop key={s.offset} offset={s.offset} stopColor={s.color} />
          ))}
        </linearGradient>
        <filter id={blurId} filterUnits="userSpaceOnUse" x={-200} y={-200} width={2320} height={1480}>
          <feGaussianBlur stdDeviation={8} />
        </filter>
        <filter id={haloId} filterUnits="userSpaceOnUse" x={-200} y={-200} width={2320} height={1480}>
          <feGaussianBlur stdDeviation={20} />
        </filter>
      </defs>
      {halo > 0 && <path d={d} stroke={grad} strokeWidth={56} fill="none" strokeLinecap="round" opacity={halo} filter={`url(#${haloId})`} {...dash} />}
      <path d={d} stroke={shadowColor} strokeWidth={width} fill="none" strokeLinecap="round" transform="translate(5,9)" {...dash} />
      {glow > 0 && <path d={d} stroke={grad} strokeWidth={28} fill="none" strokeLinecap="round" opacity={0.35 * glow} filter={`url(#${blurId})`} {...dash} />}
      <path d={d} stroke={grad} strokeWidth={width} fill="none" strokeLinecap="round" {...dash} />
      <path d={d} stroke="rgba(255,255,255,.55)" strokeWidth={2} fill="none" strokeLinecap="round" transform="translate(0,-3)" {...dash} />
    </svg>
  );
};
