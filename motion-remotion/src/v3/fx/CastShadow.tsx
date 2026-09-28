// v3 §3 "부상 캐스트 섀도" + §6 filter-cost rule: drawn at 1/4 size then
// blur/4, then scale(4) back up. Placed as a plain (non-preserve-3d-breaking)
// sibling BEFORE the floating card in paint order, inside the Rig. No opacity
// is applied to the *card* itself — only this shadow div carries it, so the
// card's own preserve-3d subtree never flattens (§6 대책2).
//
// Round-3 fix: two bugs were compounding into a large grey rectangular smear
// on every style frame. (1) all inputs are LOGICAL board px, but this sits in
// the K=2-scaled board DOM like everything else in Board/Riser — they must be
// doubled via px() before use (this component was the one place that wasn't).
// (2) the 1/4-size trick requires the *wrapper* (the element the scale(4) is
// applied to) to itself be sized at 1/4 — it was previously sized at full
// (w,h) with only the inner blur box at 1/4, so scale(4) blew the shadow's
// footprint up 4x too large from its top-left anchor.
import React from 'react';
import {castShadowFor, px} from '../tokens/video';

export interface CastShadowProps {
  x: number; // logical px, top-left of the card footprint
  y: number;
  w: number;
  h: number;
  z: number; // risen height (logical)
  radius?: number;
}

export const CastShadow: React.FC<CastShadowProps> = ({x, y, w, h, z, radius = 20}) => {
  if (z <= 0) return null;
  const {dx, dy, blur, opacity} = castShadowFor(z);

  const X = px(x + dx);
  const Y = px(y + dy);
  const W = px(w);
  const H = px(h);
  const BLUR = px(blur);
  const R = px(radius);

  return (
    <div
      style={{
        position: 'absolute',
        left: X,
        top: Y,
        width: W / 4,
        height: H / 4,
        transform: 'scale(4)',
        transformOrigin: 'top left',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: R / 4,
          background: 'rgba(23,59,48,1)',
          opacity,
          filter: `blur(${BLUR / 4}px)`,
        }}
      />
    </div>
  );
};
