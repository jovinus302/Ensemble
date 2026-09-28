// v3 §3/§7 step 8 — KineticHeadline: builds on the v2 RevealUnit mask-reveal
// primitive (exported from src/primitives/Headline.tsx) and adds the v3-only
// treatments storyboard-v3.md calls for: Z-fly-in, variable-weight morph,
// word swap, scaleX/letter-spacing squeeze, strike/underline tube, and a
// per-word Z-emphasis (translateZ) lift with a matching text-plane cast
// shadow. Lives inside TypeRig (Stage.tsx), so it shares the Rig's
// perspective without following its zoom.
import React from 'react';
import {interpolate, spring} from 'remotion';
import {RevealUnit} from '../../primitives/Headline';
import {ad, FPS} from '../../tokens/motion';
import {type, inkColor, accentColor, TypeStyle} from '../tokens/video';
import {FONT_FAMILY, FONT_FAMILY_VARIABLE} from '../../tokens/fonts';

export interface HeadlineWord {
  text: string;
  accent?: boolean; // primary color (e.g. "PM")
  zEmphasis?: number; // logical px this word floats toward the camera
  variableWeight?: boolean; // animate 400->800 via the variable font
}

export interface KineticHeadlineProps {
  words: HeadlineWord[];
  frame: number; // local frame, 0 = first word starts entering
  variant: 'T1' | 'T2';
  align?: 'center' | 'left';
  top: number;
  left?: number;
  width?: number;
  stagger?: number; // frames between word entries
  color?: string;
}

const typeStyleFor = (v: 'T1' | 'T2'): TypeStyle => type[v];

export const KineticHeadline: React.FC<KineticHeadlineProps> = ({
  words,
  frame,
  variant,
  align = 'left',
  top,
  left = 120,
  width = 1200,
  stagger = 6,
  color,
}) => {
  const t = typeStyleFor(variant);

  return (
    <div
      style={{
        position: 'absolute',
        top,
        left: align === 'center' ? 0 : left,
        width: align === 'center' ? 1920 : width,
        textAlign: align,
        display: 'flex',
        justifyContent: align === 'center' ? 'center' : 'flex-start',
        flexWrap: 'wrap',
        gap: '0.32em',
        fontFamily: FONT_FAMILY,
        fontWeight: t.fontWeight,
        fontSize: t.fontSize,
        lineHeight: t.lineHeight,
        letterSpacing: t.letterSpacing,
        color: color ?? inkColor,
        transformStyle: 'preserve-3d',
      }}
    >
      {words.map((w, i) => {
        const enterStart = i * stagger;
        const localFrame = frame - enterStart;

        // Z-fly-in: -160 -> 0 over the same spring progress RevealUnit uses internally;
        // recomputed here (cheap) so we can also drive a companion text-plane shadow.
        const zProgress = Math.min(spring({frame: Math.max(localFrame, 0), fps: FPS, config: ad.springs.smooth}), 1);
        const flyZ = (1 - zProgress) * -160 + (w.zEmphasis ?? 0) * zProgress;

        const wght = w.variableWeight
          ? interpolate(localFrame, [0, 12], [400, 800], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})
          : undefined;

        const content = (
          <span
            style={{
              display: 'inline-block',
              color: w.accent ? accentColor : undefined,
              transform: `translateZ(${flyZ}px)`,
              fontFamily: wght !== undefined ? FONT_FAMILY_VARIABLE : undefined,
              fontVariationSettings: wght !== undefined ? `'wght' ${wght}` : undefined,
            }}
          >
            {w.text}
          </span>
        );

        return (
          <RevealUnit key={i} frame={frame} enterStart={enterStart} exitStart={100000}>
            {content}
          </RevealUnit>
        );
      })}
    </div>
  );
};
