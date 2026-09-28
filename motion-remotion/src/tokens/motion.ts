import {Easing} from 'remotion';

export const FPS = 30;
export const ms = (v: number, fps = FPS) => Math.round((v / 1000) * fps);

export const duration = {instant: 100, xs: 160, sm: 240, md: 360, lg: 560, xl: 800, xxl: 1200} as const;

export const ease = {
  standard: Easing.bezier(0.2, 0, 0, 1),
  enter: Easing.bezier(0.05, 0.7, 0.1, 1),
  exit: Easing.bezier(0.3, 0, 0.8, 0.15),
  expressive: Easing.bezier(0.16, 1, 0.3, 1),
  inout: Easing.bezier(0.83, 0, 0.17, 1),
  overshoot: Easing.bezier(0.34, 1.56, 0.64, 1),
  linear: Easing.linear,
} as const;

// Base MOTION.md §9.3 springs, kept for anything not covered by the art-direction pass below.
export const springs = {
  smooth: {mass: 1, damping: 200, stiffness: 100},
  snappy: {mass: 1, damping: 26, stiffness: 260},
  pop: {mass: 1, damping: 14, stiffness: 200},
  heavy: {mass: 1.6, damping: 30, stiffness: 140},
} as const;

// Art-direction pass (jitter.video/templates + getdesign.md reference research, applied to S01-S04).
// Values marked [추정] in the brief — tune by eye with stills, this is the single place to retune.
export const ad = {
  springs: {
    // ~8-12% overshoot, settle ~14f — node pops (PM materialize, peripheral emphasis bumps)
    pop: {mass: 0.6, damping: 11, stiffness: 190},
    // no overshoot — text reveals, line draws
    smooth: {mass: 1, damping: 200, stiffness: 120},
    // ~30-40f settle, <1% overshoot — main camera moves
    camera: {mass: 1.2, damping: 28, stiffness: 70},
  },
  anticipation: {frames: 5, amount: 0.04}, // 4-6f opposite 3-4% before a move/pop
  stagger: {node: 2, headlineChar: 1, textLine: 3}, // frames
  trail: {samples: 9},
} as const;

export const stagger = {char: 25, word: 60, item: 80, group: 160, cap: 600} as const;

// sine loop helper for continuous, non-jank periodic motion (pulses, dashed slot breathing, ring rotation)
export const sineLoop = (frame: number, periodMs: number, fps = FPS) => {
  const periodFrames = (periodMs / 1000) * fps;
  const t = (frame % periodFrames) / periodFrames;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
};

// continuous (non-wrapping) linear progress for e.g. ring rotation degrees
export const linearLoopDeg = (frame: number, periodMs: number, fps = FPS) => {
  const periodFrames = (periodMs / 1000) * fps;
  return ((frame / periodFrames) % 1) * 360;
};
