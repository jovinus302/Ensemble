// v3 §3 "튜브" — SVG path, screen-space 14px harmony tube with a highlight
// stroke and an offset (filter-free) shadow path. Round caps. Used for the
// handoff / context-transfer connectors (M10 header line, C3.1 evidence pill
// trail).
import React from 'react';
import {harmonyGradientStops} from '../tokens/video';

export interface TubeProps {
  d: string; // svg path, in the same 2D overlay coordinate space as the caller
  width?: number;
  gradientId: string;
  drawProgress?: number; // 0-1, for dash-offset reveal
}

export const Tube: React.FC<TubeProps> = ({d, width = 14, gradientId, drawProgress = 1}) => {
  return (
    <svg style={{position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none'}} width="100%" height="100%">
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          {harmonyGradientStops.map((s) => (
            <stop key={s.offset} offset={s.offset} stopColor={s.color} />
          ))}
        </linearGradient>
      </defs>
      {/* shadow path, no filter — offset + translucent */}
      <path
        d={d}
        stroke="rgba(23,59,48,.18)"
        strokeWidth={width}
        fill="none"
        strokeLinecap="round"
        transform="translate(6,10)"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - drawProgress}
      />
      <path
        d={d}
        stroke={`url(#${gradientId})`}
        strokeWidth={width}
        fill="none"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - drawProgress}
      />
      {/* highlight, offset -3px perpendicular-ish via a slightly thinner white stroke on top */}
      <path
        d={d}
        stroke="rgba(255,255,255,.6)"
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
        transform="translate(0,-3)"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - drawProgress}
      />
    </svg>
  );
};
