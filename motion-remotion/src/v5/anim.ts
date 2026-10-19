// v5 animation helpers: every value is a pure function of the frame number.
import {Easing, spring} from 'remotion';
import {FPS} from './timing';

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** linear progress 0..1 of `frame` over [start, start + dur] */
export const prog = (frame: number, start: number, dur: number) => clamp01((frame - start) / Math.max(1, dur));

export const EASE = {
  out: Easing.bezier(0.16, 1, 0.3, 1), // expressive: fast start, long settle
  inout: Easing.bezier(0.45, 0, 0.2, 1), // camera
  soft: Easing.bezier(0.33, 0, 0.2, 1),
  in: Easing.bezier(0.4, 0, 0.9, 0.6),
  linear: (t: number) => t,
};

/** fraction of the window at which EASE.out has visibly landed (>= .98): windows are stretched so this is the event frame */
export const LAND = (() => {
  let t = 0;
  while (t < 1 && EASE.out(t) < 0.98) t += 0.001;
  return t;
})();

export const eased = (frame: number, start: number, dur: number, ease: (t: number) => number = EASE.out) => ease(prog(frame, start, dur));

// springs (tokens/motion.ts values; durationInFrames stretches them to a fixed length)
export const SPR = {
  snappy: {mass: 1, damping: 26, stiffness: 260},
  smooth: {mass: 1, damping: 200, stiffness: 100},
  pop: {mass: 0.6, damping: 11, stiffness: 190},
  soft: {mass: 1, damping: 22, stiffness: 120},
} as const;

export const sp = (frame: number, start: number, config: (typeof SPR)[keyof typeof SPR], dur?: number) =>
  frame < start ? 0 : spring({frame: frame - start, fps: FPS, config, durationInFrames: dur});

/** the beat grid in frames (15f = one beat @120bpm/30fps) */
export const BEAT = 15;
/** 0..1, 1 on each beat and decaying to ~0 before the next (kick-shaped micro motion) */
export const beatKick = (frame: number, period = BEAT) => Math.exp(-(((frame % period) + period) % period) / (period * 0.28));
/** slow 0..1 breathing; one cycle per `period` frames */
export const breathe = (frame: number, period = 60, phase = 0) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (frame - phase)) / period);
/** square blink, one cycle per `period` frames (cursor) */
export const blink = (frame: number, period = 30) => (((frame % period) + period) % period < period / 2 ? 1 : 0);

export const mixRgb = (a: [number, number, number], b: [number, number, number], t: number) => `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], t))).join(',')})`;
