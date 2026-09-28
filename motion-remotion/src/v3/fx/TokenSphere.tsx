// v3 §3 "토큰 구체" — 36px (screen) sphere: conic harmony base + specular
// highlight + shading via layered radial-gradients (no filters). Optional
// 4-point comet trail (opacity .5 -> .14).
import React from 'react';
import {harmonyGradient} from '../tokens/video';

export interface TokenSphereProps {
  x: number; // screen px, center
  y: number;
  size?: number;
  trail?: boolean;
  trailDx?: number; // direction of travel, per-point offset
  trailDy?: number;
}

export const TokenSphere: React.FC<TokenSphereProps> = ({x, y, size = 36, trail, trailDx = -18, trailDy = 0}) => {
  const sphere = (opacity: number, s: number, tx: number, ty: number, key: string) => (
    <div
      key={key}
      style={{
        position: 'absolute',
        left: tx - s / 2,
        top: ty - s / 2,
        width: s,
        height: s,
        borderRadius: '50%',
        background: harmonyGradient,
        opacity,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background:
            'radial-gradient(circle at 35% 30%, #fff 0 6%, transparent 14%), radial-gradient(circle, transparent 50%, rgba(0,0,0,.25) 100%)',
        }}
      />
    </div>
  );

  return (
    <div style={{position: 'absolute', inset: 0, pointerEvents: 'none'}}>
      {trail &&
        [1, 2, 3, 4].map((i) => sphere(0.5 - (0.5 - 0.14) * (i / 4), size * 0.6, x + trailDx * i, y + trailDy * i, `trail${i}`))}
      {sphere(1, size, x, y, 'main')}
    </div>
  );
};
