import React from 'react';
import {interpolate, spring} from 'remotion';
import {ease, FPS, ad} from '../tokens/motion';

// Headline mask-reveal unit (overflow-hidden, text rises from below the mask).
// Shared by v3 KineticHeadline and v4 OpeningV4.
const EXIT_FRAMES = 8; // mask-out upward

const springProgress = (localFrame: number) => Math.min(spring({frame: Math.max(localFrame, 0), fps: FPS, config: ad.springs.smooth}), 1);

export const RevealUnit: React.FC<{
  children: React.ReactNode;
  enterStart: number; // frame (relative to headline-local time) this unit begins entering
  frame: number;
  exitStart: number;
  blurPx?: number; // if set, blur(px->0) over 14f alongside the enter
}> = ({children, enterStart, frame, exitStart, blurPx}) => {
  const enterP = springProgress(frame - enterStart);
  const translateYIn = (1 - enterP) * 100;
  const opacity = interpolate(enterP, [0, 0.6, 1], [0, 1, 1]);

  const exitP = interpolate(frame, [exitStart, exitStart + EXIT_FRAMES], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ease.exit,
  });
  const translateYOut = -exitP * 100;

  const blur = blurPx ? interpolate(frame - enterStart, [0, 14], [blurPx, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}) : 0;

  return (
    <span style={{display: 'inline-block', overflow: 'hidden', paddingBottom: '0.15em'}}>
      <span
        style={{
          display: 'inline-block',
          transform: `translateY(${translateYIn + translateYOut}%)`,
          opacity: opacity * (1 - exitP),
          filter: blur > 0.01 ? `blur(${blur}px)` : undefined,
        }}
      >
        {children}
      </span>
    </span>
  );
};
