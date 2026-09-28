import React from 'react';
import {interpolate, spring} from 'remotion';
import {ease, FPS, ad} from '../tokens/motion';
import {colors} from '../tokens/colors';
import {FONT_FAMILY} from '../tokens/fonts';
import type {SceneMeta} from '../scenes/scenes';
import {getDarkAmount} from '../world/state';

function mixHex(a: string, b: string, t: number): string {
  const hex = (h: string) => ({r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16)});
  const pa = hex(a);
  const pb = hex(b);
  return `rgb(${Math.round(pa.r + (pb.r - pa.r) * t)}, ${Math.round(pa.g + (pb.g - pa.g) * t)}, ${Math.round(pa.b + (pb.b - pa.b) * t)})`;
}

// Headline mask reveal is the base mechanism for every scene (overflow-hidden unit,
// text rises from below the mask) — each scene layers a distinct secondary treatment
// on top per the art-direction pass, so headlines don't all read as the same fade-up.
const ENTER_PREROLL = 6; // next headline starts 6f before the previous camera settles
const EXIT_FRAMES = 8; // mask-out upward

const springProgress = (localFrame: number) => Math.min(spring({frame: Math.max(localFrame, 0), fps: FPS, config: ad.springs.smooth}), 1);

// Exported for src/v3/type/KineticHeadline.tsx reuse (v3 §7 step 8) — approved
// single-export addition, rest of this file is unmodified v2 code.
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

export const Headline: React.FC<{scene: SceneMeta; frame: number}> = ({scene, frame}) => {
  const visibleStart = scene.start - ENTER_PREROLL;
  const exitStart = scene.end - EXIT_FRAMES;
  const localFrame = frame - visibleStart;
  if (frame < visibleStart - 20 || frame > scene.end + 4) return null;

  // keep AA contrast during the S02 dark dip (paper ink would be near-invisible on ink bg)
  const textColor = mixHex(colors.onSurface, colors.darkOnSurface, getDarkAmount(frame));

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    top: 112,
    left: scene.align === 'center' ? 0 : 96,
    width: scene.align === 'center' ? 1920 : 1200,
    textAlign: scene.align,
    fontFamily: FONT_FAMILY,
    fontWeight: 700,
    fontSize: 76,
    letterSpacing: '-0.028em',
    lineHeight: 1.1,
    color: textColor,
    display: 'flex',
    justifyContent: scene.align === 'center' ? 'center' : 'flex-start',
    flexWrap: 'wrap',
  };

  if (scene.variant === 'perChar') {
    const chars = scene.headline.split('');
    return (
      <div style={{...baseStyle, gap: 0}}>
        {chars.map((c, i) => (
          <RevealUnit key={i} frame={localFrame} enterStart={i * ad.stagger.headlineChar} exitStart={exitStart - visibleStart}>
            {c === ' ' ? ' ' : c}
          </RevealUnit>
        ))}
      </div>
    );
  }

  const words = scene.headline.split(' ');
  return (
    <div style={{...baseStyle, gap: '0.32em'}}>
      {words.map((w, i) => {
        const isPmWord = scene.variant === 'pmSnap' && w.startsWith('PM');
        const enterStart = i * 6;
        const snap = isPmWord
          ? interpolate(localFrame - enterStart, [4, 12], [1.15, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease.standard})
          : 1;
        const content = isPmWord ? (
          <>
            <span style={{color: colors.primary, display: 'inline-block', transform: `scaleX(${snap})`, transformOrigin: 'left'}}>PM</span>
            {w.slice(2)}
          </>
        ) : (
          w
        );
        return (
          <RevealUnit key={i} frame={localFrame} enterStart={enterStart} exitStart={exitStart - visibleStart} blurPx={scene.variant === 'blur' ? 12 : undefined}>
            {content}
          </RevealUnit>
        );
      })}
    </div>
  );
};
