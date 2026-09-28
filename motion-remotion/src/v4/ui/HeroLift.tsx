// v4 layer 3 — the hero card. Rendered inside the board body (so it shares
// the rig transform), at `translateZ(z) scale(sc)` about its own center, with
// a blurred shadow left on the board plane (offset (8,16), blur 24 logical at
// full rise, design-v4 §2). The card must have its own opaque surface (v3
// round-4 lesson: a lifted element without one turns its shadow into a smear).
//
// `children` are laid out relative to the card box. `boardChildren` are
// laid out in board-logical coordinates (for re-using v3 renderers that
// position themselves absolutely on the board, e.g. MessageRenderer).
// projectV4.heroPointToBoard() mirrors this transform for callout anchors.
import React from 'react';
import {px} from '../../v3/tokens/video';
import {HERO_LIFT} from '../config';
import {heroScale, heroZ} from '../stage/projectV4';
import type {Rect} from '../stage/projectV4';

export interface HeroLiftProps {
  card: Rect; // board-logical
  rise: number; // 0..1
  radius?: number; // logical
  children?: React.ReactNode;
  boardChildren?: React.ReactNode;
  under?: React.ReactNode; // board-plane decoration under the card (e.g. AI glow), DOM px
}

export const HeroLift: React.FC<HeroLiftProps> = ({card, rise, radius = 20, children, boardChildren, under}) => {
  const {dx, dy, blur, color} = HERO_LIFT.shadow;
  return (
    <>
      {under}
      {/* shadow on the board plane; filter blur(σ) with σ = blur/2 matches a box-shadow blur radius of `blur` */}
      {rise > 0 && (
        <div
          style={{
            position: 'absolute',
            left: px(card.x + dx * rise),
            top: px(card.y + dy * rise),
            width: px(card.w),
            height: px(card.h),
            borderRadius: px(radius),
            background: color,
            opacity: rise,
            filter: `blur(${px(blur / 2)}px)`,
            pointerEvents: 'none',
          }}
        />
      )}
      <div
        data-v4="hero"
        style={{
          position: 'absolute',
          left: px(card.x),
          top: px(card.y),
          width: px(card.w),
          height: px(card.h),
          transformOrigin: '50% 50%',
          transform: `translateZ(${px(heroZ(rise))}px) scale(${heroScale(rise)})`,
        }}
      >
        {boardChildren && <div style={{position: 'absolute', left: -px(card.x), top: -px(card.y), width: 0, height: 0}}>{boardChildren}</div>}
        {children}
      </div>
    </>
  );
};
