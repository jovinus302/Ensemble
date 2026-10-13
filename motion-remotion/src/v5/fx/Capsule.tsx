// v5 decision capsule (storyboard-v5.md §1): a small pill riding the thread.
// Three icons (결정 · 이유 · 출처) and "출시일 11/6". A screen-space overlay element
// positioned by the caller (projected world point); size follows the camera scale.
// Harmony ring = PM Agent's shared element color role.
import React from 'react';
import {AttachIcon, CheckCircleIcon, HourglassIcon} from '../../ui/icons';
import {FONT_FAMILY} from '../../tokens/fonts';
import {HARMONY_RING} from '../surfaces/theme';

export const CAPSULE_W = 384;
export const CAPSULE_H = 78;

export interface CapsuleProps {
  x: number; // screen center
  y: number;
  scale: number; // perspective x camera scale
  appear: number; // 0..1 (spring, may overshoot a little)
  stretch?: number; // 0..1 elongation along the travel direction (leading edge snappy)
  angle?: number; // deg, travel direction
  absorb?: number; // 0..1 sucked into the tile: shrinks
  shimmer?: number; // 0..1 micro motion highlight sweep
}

export const Capsule: React.FC<CapsuleProps> = ({x, y, scale, appear, stretch = 0, angle = 0, absorb = 0, shimmer = 0}) => {
  if (appear <= 0.01 || absorb >= 1) return null;
  const k = scale * (0.84 + 0.16 * appear) * (1 - 0.72 * absorb * absorb);
  const sx = 1 + 0.16 * stretch;
  const sy = 1 - 0.06 * stretch;
  const icon = (node: React.ReactNode, key: string) => (
    <div key={key} style={{width: 40, height: 40, borderRadius: 20, background: '#D3EBDD', color: '#2B6A52', display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: key === 'i0' ? 0 : -8, boxShadow: '0 0 0 2.5px #FFFFFF'}}>
      {node}
    </div>
  );
  return (
    <div
      style={{
        position: 'absolute',
        left: x - CAPSULE_W / 2,
        top: y - CAPSULE_H / 2,
        width: CAPSULE_W,
        height: CAPSULE_H,
        opacity: Math.min(1, appear * 2.5) * (1 - 0.6 * absorb),
        transform: `rotate(${angle}deg) scale(${k * sx}, ${k * sy}) rotate(${-angle}deg)`,
        transformOrigin: '50% 50%',
        pointerEvents: 'none',
      }}
    >
      <div style={{position: 'absolute', inset: 0, borderRadius: CAPSULE_H, padding: 4, background: HARMONY_RING, boxShadow: '0 10px 26px rgba(0,0,0,.45)'}}>
        <div style={{position: 'relative', width: '100%', height: '100%', borderRadius: CAPSULE_H, background: '#FFFFFF', display: 'flex', alignItems: 'center', gap: 16, padding: '0 22px 0 16px', overflow: 'hidden', fontFamily: FONT_FAMILY}}>
          <div style={{display: 'flex', alignItems: 'center'}}>
            {icon(<CheckCircleIcon size={26} />, 'i0')}
            {icon(<HourglassIcon size={24} />, 'i1')}
            {icon(<AttachIcon size={24} />, 'i2')}
          </div>
          <span style={{fontSize: 32, fontWeight: 800, color: '#18201C', letterSpacing: '-0.02em', whiteSpace: 'nowrap'}}>출시일 11/6</span>
          {shimmer > 0 && shimmer < 1 && <div style={{position: 'absolute', top: 0, bottom: 0, width: '34%', left: `${-34 + 134 * shimmer}%`, background: 'linear-gradient(105deg, rgba(255,255,255,0), rgba(190,236,214,.6) 50%, rgba(255,255,255,0))'}} />}
        </div>
      </div>
    </div>
  );
};
