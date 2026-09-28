// PitchV4 headlines. Entrance is v3's KineticHeadline, unchanged, so a
// settled headline renders exactly like the StyleFrameV4 stills. v4 adds:
//  - HeadlineExit: an 8f exit (rise + fade), so a headline is gone before the
//    next camera move (storyboard-v4 §3);
//  - an optional strike through part of one word (beat ④ "'시작해'"),
//    positioned from canvas text metrics of the same font.
import React from 'react';
import {Easing, interpolate} from 'remotion';
import {KineticHeadline} from '../../v3/type/KineticHeadline';
import {type as typeScale, colors} from '../../v3/tokens/video';
import {FONT_FAMILY} from '../../tokens/fonts';

export const EXIT_FRAMES = 8;

export const HeadlineExit: React.FC<{frame: number; at?: number; children: React.ReactNode}> = ({frame, at, children}) => {
  if (at === undefined || frame < at) return <>{children}</>;
  const p = interpolate(frame, [at, at + EXIT_FRAMES], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.3, 0, 0.8, 0.15)});
  if (p >= 1) return null;
  return <div style={{position: 'absolute', inset: 0, transform: `translateY(${-24 * p}px)`, opacity: 1 - p}}>{children}</div>;
};

const measure = (text: string, variant: 'T1' | 'T2') => {
  const t = typeScale[variant];
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = `${t.fontWeight} ${t.fontSize}px ${FONT_FAMILY}`;
  if (t.letterSpacing) (ctx as unknown as {letterSpacing: string}).letterSpacing = `${parseFloat(t.letterSpacing) * t.fontSize}px`;
  return ctx.measureText(text).width;
};

export interface BeatHeadlineProps {
  copy: string; // words split on spaces
  accent?: string[];
  variant: 'T1' | 'T2';
  enter: number;
  exit?: number;
  frame: number;
  align?: 'left' | 'center';
  top: number;
  left?: number;
  // strike through `part` inside word #wordIndex, drawn over `drawFrames` from `from`
  strike?: {wordIndex: number; part: string; from: number; drawFrames?: number};
}

export const BeatHeadline: React.FC<BeatHeadlineProps> = ({copy, accent = [], variant, enter, exit, frame, align = 'left', top, left = 120, strike}) => {
  if (frame < enter) return null;
  const words = copy.split(' ');
  let strikeEl: React.ReactNode = null;
  if (strike && frame >= strike.from && align === 'left') {
    const t = typeScale[variant];
    const gap = 0.32 * t.fontSize;
    const x0 = left + words.slice(0, strike.wordIndex).reduce((a, w) => a + measure(w, variant) + gap, 0);
    const word = words[strike.wordIndex];
    const offset = measure(word.slice(0, word.indexOf(strike.part)), variant);
    const w = measure(strike.part, variant);
    const p = interpolate(frame, [strike.from, strike.from + (strike.drawFrames ?? 12)], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.2, 0, 0, 1)});
    strikeEl = (
      <div
        style={{
          position: 'absolute',
          left: x0 + offset - 6,
          top: top + t.fontSize * t.lineHeight * 0.52,
          width: (w + 12) * p,
          height: 8,
          borderRadius: 4,
          background: colors.primary,
        }}
      />
    );
  }
  return (
    <HeadlineExit frame={frame} at={exit}>
      <KineticHeadline words={words.map((text) => ({text, accent: accent.includes(text)}))} frame={frame - enter} variant={variant} align={align} top={top} left={left} width={1680} />
      {strikeEl}
    </HeadlineExit>
  );
};
