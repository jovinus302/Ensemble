// v3 §4/§7 step 6 — camera pose table (storyboard-v3.md §4) + getCamera(frame).
// Full beat-by-beat motion is NOT implemented yet (spec §7 step 11: stills only,
// stop after SF1-3). This keyframe table exists so PitchV3 (registered per spec
// step 10) doesn't crash across its full 1710f duration, and so StyleFrameV3 can
// share one pose source. Poses used by the three approved style frames are
// hard-pinned to the exact values storyboard-v3.md gives for f185/f505/f1305 —
// see STYLE_FRAME_POSES below — so getCamera()'s inter-keyframe easing (an
// approximation, not a spring re-implementation) never affects the deliverable.
import {interpolate, Easing} from 'remotion';
import type {CameraPose} from '../tokens/video';
import {P0, P0_5, P1} from '../tokens/video';

export interface CameraKeyframe {
  frame: number;
  pose: CameraPose;
}

// Keyframes transcribed from storyboard-v3.md §4 "카메라 from -> to" column.
// Frames chosen at the "arrival" point of each named move; poses in between
// are approximated with an ease-standard interpolation (not a real spring
// chain) — acceptable because full motion is out of scope for this pass.
export const CAMERA_KEYFRAMES: CameraKeyframe[] = [
  {frame: 0, pose: P0},
  {frame: 60, pose: P0},
  {frame: 150, pose: P0_5},
  {frame: 210, pose: P1},
  {frame: 390, pose: {tx: 212, ty: 480, s: 2.0, rx: 6, ry: 22, rz: -1, ax: 760, ay: 560, dz: 0}},
  {frame: 470, pose: {tx: 692, ty: 450, s: 1.55, rx: 8, ry: 12, rz: -1, ax: 820, ay: 580, dz: 0}},
  {frame: 530, pose: {tx: 692, ty: 560, s: 1.7, rx: 8, ry: 12, rz: -1, ax: 820, ay: 580, dz: 0}},
  {frame: 630, pose: {tx: 692, ty: 560, s: 1.7, rx: 8, ry: 12, rz: -1, ax: 820, ay: 580, dz: 0}},
  {frame: 700, pose: {tx: 692, ty: 571, s: 1.5, rx: 7, ry: -12, rz: 1, ax: 1040, ay: 560, dz: 0}},
  {frame: 750, pose: {tx: 212, ty: 520, s: 1.3, rx: 6, ry: -4, rz: 0, ax: 760, ay: 560, dz: 0}},
  {frame: 840, pose: {tx: 212, ty: 520, s: 1.3, rx: 6, ry: -4, rz: 0, ax: 760, ay: 560, dz: 0}},
  {frame: 960, pose: {tx: 692, ty: 264, s: 1.8, rx: 8, ry: -10, rz: 0, ax: 900, ay: 600, dz: 0}},
  {frame: 975, pose: {tx: 692, ty: 511, s: 1.7, rx: 8, ry: -10, rz: 0, ax: 900, ay: 540, dz: 0}},
  {frame: 1110, pose: {tx: 692, ty: 511, s: 1.7, rx: 8, ry: -10, rz: 0, ax: 900, ay: 540, dz: 0}},
  {frame: 1150, pose: {tx: 1232, ty: 384, s: 2.0, rx: 6, ry: -22, rz: 1, ax: 1180, ay: 560, dz: 0}},
  {frame: 1170, pose: {tx: 692, ty: 686, s: 1.6, rx: 7, ry: -14, rz: 0, ax: 960, ay: 560, dz: 0}},
  {frame: 1250, pose: {tx: 1232, ty: 384, s: 2.0, rx: 6, ry: -22, rz: 1, ax: 1180, ay: 560, dz: 0}},
  {frame: 1350, pose: {tx: 1232, ty: 384, s: 2.0, rx: 6, ry: -22, rz: 1, ax: 1180, ay: 560, dz: 0}},
  {frame: 1420, pose: {tx: 692, ty: 596, s: 1.35, rx: 12, ry: -8, rz: 0, ax: 1000, ay: 600, dz: 0}},
  {frame: 1530, pose: {tx: 692, ty: 596, s: 1.35, rx: 12, ry: -8, rz: 0, ax: 1000, ay: 600, dz: 0}},
  {frame: 1600, pose: {tx: 720, ty: 450, s: 0.78, rx: 12, ry: -16, rz: 2, ax: 1080, ay: 600, dz: 0}},
  {frame: 1710, pose: {tx: 720, ty: 450, s: 0.78, rx: 12, ry: -16, rz: 2, ax: 1080, ay: 600, dz: -400}},
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const getCamera = (frame: number): CameraPose => {
  const kfs = CAMERA_KEYFRAMES;
  if (frame <= kfs[0].frame) return kfs[0].pose;
  if (frame >= kfs[kfs.length - 1].frame) return kfs[kfs.length - 1].pose;
  let i = 0;
  while (i < kfs.length - 1 && kfs[i + 1].frame < frame) i++;
  const a = kfs[i];
  const b = kfs[i + 1];
  const t = interpolate(frame, [a.frame, b.frame], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.2, 0, 0, 1),
  });
  return {
    tx: lerp(a.pose.tx, b.pose.tx, t),
    ty: lerp(a.pose.ty, b.pose.ty, t),
    s: lerp(a.pose.s, b.pose.s, t),
    rx: lerp(a.pose.rx, b.pose.rx, t),
    ry: lerp(a.pose.ry, b.pose.ry, t),
    rz: lerp(a.pose.rz, b.pose.rz, t),
    ax: lerp(a.pose.ax, b.pose.ax, t),
    ay: lerp(a.pose.ay, b.pose.ay, t),
    dz: lerp(a.pose.dz, b.pose.dz, t),
  };
};

// Hold-drift, §4 "정지(hold) 구간에서도 멈추지 않는다": ry += 0.6*sin, tx += 6px linear.
// Applied as a small additive on top of getCamera() by callers that want it;
// the three approved style frames intentionally do NOT use drift (they pin an
// exact documented pose for reviewability).
export const holdDrift = (frame: number, periodFrames = 240): Pick<CameraPose, 'ry' | 'tx'> => {
  const t = (frame % periodFrames) / periodFrames;
  return {
    ry: 0.6 * Math.sin(2 * Math.PI * t),
    tx: 6 * ((frame % periodFrames) / periodFrames),
  };
};

// ---- §5 exact style-frame poses (verbatim from storyboard-v3.md) ----
export const STYLE_FRAME_POSES: Record<'SF1' | 'SF2' | 'SF3', CameraPose> = {
  // SF1 f185: P0.5<->P1 interpolated pose t~=0.7, given directly by spec.
  SF1: {tx: 720, ty: 450, s: 0.8, rx: 12, ry: 22, rz: -2, ax: 980, ay: 660, dz: -120},
  SF2: {tx: 692, ty: 450, s: 1.55, rx: 8, ry: 12, rz: -1, ax: 820, ay: 580, dz: 0},
  SF3: {tx: 1232, ty: 384, s: 2.0, rx: 6, ry: -22, rz: 1, ax: 1180, ay: 560, dz: 0},
};
