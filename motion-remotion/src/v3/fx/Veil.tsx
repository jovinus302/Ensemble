// v3 §3 "초점 밖 처리(DOF)" default treatment: a flat rgba veil over an
// out-of-focus area (sidebar / main / panel unit), SMOOTH 0<->.55 (bumped to
// up to .8 for the headline-legibility band per round-3 feedback).
// IMPORTANT: this must NOT be applied as opacity on a preserve-3d ancestor —
// it is its own opaque-color overlay div sized to the region, painted above
// it, so it never triggers the preserve-3d flattening rule (§6 대책2/4).
//
// Round-3 fix: inputs are logical board px like everything else in the K=2
// board DOM — this component was missing the px() doubling (same class of
// bug as CastShadow/GlowField/EmbossChip).
import React from 'react';
import {px} from '../tokens/video';

export interface VeilProps {
  x: number;
  y: number;
  w: number;
  h: number;
  amount: number; // 0-1, current SMOOTH-interpolated veil strength
  maxOpacity?: number; // default .55 (region DOF); pass .8 for headline bands
  feather?: boolean; // fade top/bottom edges instead of a hard rectangle
}

export const Veil: React.FC<VeilProps> = ({x, y, w, h, amount, maxOpacity = 0.55, feather}) => {
  if (amount <= 0.001) return null;
  const a = maxOpacity * amount;
  const bg = feather
    ? `linear-gradient(180deg, transparent 0%, rgba(244,241,234,${a}) 18%, rgba(244,241,234,${a}) 82%, transparent 100%)`
    : `rgba(244,241,234,${a})`;
  return (
    <div
      style={{
        position: 'absolute',
        left: px(x),
        top: px(y),
        width: px(w),
        height: px(h),
        background: bg,
        pointerEvents: 'none',
      }}
    />
  );
};
