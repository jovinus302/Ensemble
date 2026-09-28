// v3 §2/§3 — wraps a board element that floats to a risen Z: emits its
// CastShadow (drawn on the resting plane, §6 대책2: shadow carries any
// opacity/blur, never the card) plus the card itself lifted via
// translateZ(px(z)). Card gets the rim highlight inset per §3.
import React from 'react';
import {px} from '../../tokens/video';
import {CastShadow} from '../../fx/CastShadow';

export interface RiserProps {
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  radius?: number;
  children: React.ReactNode;
  extraBoxShadow?: string;
  background?: string;
}

export const Riser: React.FC<RiserProps> = ({x, y, w, h, z, radius = 20, children, extraBoxShadow, background}) => {
  return (
    <>
      <CastShadow x={x} y={y} w={w} h={h} z={z} radius={radius} />
      <div
        style={{
          position: 'absolute',
          left: px(x),
          top: px(y),
          width: px(w),
          height: px(h),
          borderRadius: px(radius),
          transform: `translateZ(${px(z)}px)`,
          transformStyle: 'preserve-3d',
          background,
          boxShadow: extraBoxShadow ?? 'inset 0 1px 0 rgba(255,255,255,.9)',
        }}
      >
        {children}
      </div>
    </>
  );
};
