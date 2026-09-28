// v3 §3 "소프트 3D 재질 — 클레이 아바타": radial-gradient tint/base/shade +
// inset highlight/shadow + drop shadow, filter-free. Circle for humans,
// radius-12 square for Agents, PM gets a rotating conic harmony ring.
import React from 'react';
import {harmonyGradientStops} from '../../tokens/video';
import {linearLoopDeg} from '../../../tokens/motion';

const conicHarmony = (fromDeg: number) =>
  `conic-gradient(from ${fromDeg}deg, ${harmonyGradientStops.map((s) => `${s.color} ${s.offset}`).join(', ')}, ${harmonyGradientStops[0].color} 100%)`;

function tint(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  const c = (i: number) => parseInt(h.slice(i, i + 2), 16);
  const mix = (v: number) => Math.max(0, Math.min(255, Math.round(v + (amt > 0 ? (255 - v) * amt : v * amt))));
  const [r, g, b] = [mix(c(0)), mix(c(2)), mix(c(4))];
  return `rgb(${r},${g},${b})`;
}

export interface ClayAvatarProps {
  kind: 'human' | 'agent' | 'pm';
  base: string;
  label: string; // initial letter or glyph char
  size?: number;
  frame?: number; // for PM ring rotation
  groundedShadow?: boolean; // risen-state contact ellipse
}

export const ClayAvatar: React.FC<ClayAvatarProps> = ({kind, base, label, size = 36, frame = 0, groundedShadow}) => {
  const radius = kind === 'human' ? '50%' : 12;
  const gradient = `radial-gradient(circle at 32% 28%, ${tint(base, 0.28)} 0%, ${base} 55%, ${tint(base, -0.18)} 100%)`;

  const core = (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: gradient,
        boxShadow: 'inset -3px -4px 8px rgba(0,0,0,.18), inset 3px 3px 6px rgba(255,255,255,.45), 0 6px 12px -4px rgba(23,59,48,.30)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#FFFFFF',
        fontFamily: 'Pretendard',
        fontWeight: 700,
        fontSize: size * 0.4,
        position: 'relative',
      }}
    >
      {label}
    </div>
  );

  return (
    <div style={{position: 'relative', width: size + (kind === 'pm' ? 6 : 0), height: size + (kind === 'pm' ? 6 : 0)}}>
      {kind === 'pm' ? (
        <div
          style={{
            width: size + 6,
            height: size + 6,
            borderRadius: '50%',
            padding: 3,
            background: conicHarmony(linearLoopDeg(frame, 3000)),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {core}
        </div>
      ) : (
        core
      )}
      {groundedShadow && (
        <div
          style={{
            position: 'absolute',
            left: '10%',
            bottom: -6,
            width: '80%',
            height: 8,
            borderRadius: '50%',
            background: 'radial-gradient(closest-side, rgba(23,59,48,.22), transparent)',
          }}
        />
      )}
    </div>
  );
};
