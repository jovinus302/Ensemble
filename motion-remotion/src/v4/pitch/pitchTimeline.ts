// PitchV4 timeline (storyboard-v4.md §1–§4, 1834f @30fps). Everything after
// the opening (f0–388, opening.ts) lives here: camera keys, scroll, product
// stage, message clock, hero windows, callout windows, headline windows.
// All held poses are frontal (asserted in PitchV4); every camera move is 24f
// and nothing moves while a headline is being read.
import {Easing, interpolate} from 'remotion';
import type {CameraPose} from '../../v3/tokens/video';
import {STILL_POSES, FEATURE_ZOOM} from '../config';
import type {StageId} from '../stateV4';
import {OPENING} from '../opening';

export const PITCH_TOTAL = 1834;
export const OPENING_END = OPENING.end; // 388

const frontal = (tx: number, boardTop: number, s = FEATURE_ZOOM): CameraPose => ({tx, ty: (540 - boardTop) / s, s, rx: 0, ry: 0, rz: 0, ax: 960, ay: 540, dz: 0});

// Held poses, in order. Each is reached by a 24f move that starts at `move`.
export interface CameraKey {
  id: string;
  move: number; // move start; the pose is held from move + 24
  pose: CameraPose;
  scroll: number;
}
export const MOVE_FRAMES = 24;
const CLOSING_POSE: CameraPose = {tx: 720, ty: 450, s: 0.62, rx: 0, ry: 0, rz: 0, ax: 960, ay: 600, dz: 0};
export const CAMERA_KEYS: CameraKey[] = [
  {id: 'O', move: -MOVE_FRAMES, pose: STILL_POSES.SF1b, scroll: 0}, // opening's landed pose
  {id: '①', move: 388, pose: frontal(668, -83), scroll: 0},
  {id: '②', move: 556, pose: STILL_POSES.SF2, scroll: 40},
  {id: '③', move: 778, pose: frontal(692, 200), scroll: 1342},
  {id: '④', move: 976, pose: frontal(692, 200), scroll: 1692},
  {id: '⑤', move: 1234, pose: STILL_POSES.SF3, scroll: 1692},
  {id: '⑥', move: 1468, pose: frontal(692, 200), scroll: 2292},
  {id: 'C', move: 1654, pose: CLOSING_POSE, scroll: 2292},
];
// closing shrink (frontal): s 0.62 -> 0.4 while the board fades out
// (starts after the closing line's 55f read: 1674 + 58 = 1732)
export const CLOSING_SHRINK = {from: 1732, to: 1760, s: 0.4};

const MOVE_EASE = Easing.bezier(0.65, 0, 0.35, 1);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const cameraAt = (frame: number): {pose: CameraPose; scroll: number; moving: boolean; key: string} => {
  let i = 0;
  while (i < CAMERA_KEYS.length - 1 && frame >= CAMERA_KEYS[i + 1].move) i++;
  const cur = CAMERA_KEYS[i];
  const prev = CAMERA_KEYS[Math.max(0, i - 1)];
  const t = i === 0 ? 1 : interpolate(frame, [cur.move, cur.move + MOVE_FRAMES], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: MOVE_EASE});
  let pose: CameraPose =
    t >= 1
      ? cur.pose
      : {
          tx: lerp(prev.pose.tx, cur.pose.tx, t),
          ty: lerp(prev.pose.ty, cur.pose.ty, t),
          s: lerp(prev.pose.s, cur.pose.s, t),
          rx: 0,
          ry: 0,
          rz: 0,
          ax: lerp(prev.pose.ax, cur.pose.ax, t),
          ay: lerp(prev.pose.ay, cur.pose.ay, t),
          dz: 0,
        };
  const scroll = t >= 1 ? cur.scroll : lerp(prev.scroll, cur.scroll, t);
  let moving = t > 0 && t < 1;
  if (frame >= CLOSING_SHRINK.from) {
    const u = interpolate(frame, [CLOSING_SHRINK.from, CLOSING_SHRINK.to], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: MOVE_EASE});
    pose = {...pose, s: lerp(CLOSING_POSE.s, CLOSING_SHRINK.s, u)};
    moving = u > 0 && u < 1;
  }
  return {pose, scroll, moving, key: cur.id};
};

// Held poses (every frame outside a move): for the report / assertion.
export const heldPoses = () =>
  CAMERA_KEYS.map((k) => ({id: k.id, from: Math.max(OPENING_END, k.move + MOVE_FRAMES), rot: [k.pose.rx, k.pose.ry, k.pose.rz], tx: k.pose.tx, ty: +k.pose.ty.toFixed(1), s: k.pose.s}));

// ---- product stage over time (stateV4) ----
const STAGE_KEYS: [number, StageId][] = [
  [0, 'replied'],
  [758, 'approved'], // ② "계획 승인" pressed (after SF2's callouts)
  [790, 'deciding'], // ③ M5–M9 arrive during the move: research/interviews done, D1 decided
  [914, 'decided'], // ③ handoff reaches 이서연 (her row POPs 대기 -> 작업 중)
  [1008, 'submitted'], // ④ M11 draft submitted; C1.1/C2.1 verified, C3.1 보고됨
  [1099, 'started'], // ④ M13: 프로토타입 Agent 대기 -> 작업 중, nobody said "start"
  [1339, 'verified'], // ⑤ C3.1 verified by evidence (M14 approved)
  [1468, 'goalCheck'], // ⑥ C4.1 verified during the move, 4/5
];
export const stageAt = (frame: number): StageId => {
  let s: StageId = STAGE_KEYS[0][1];
  for (const [f, id] of STAGE_KEYS) if (frame >= f) s = id;
  return s;
};

// ---- message clock (v4 frames; v3 content's appearFrame is the v3 clock) ----
export const APPEAR_AT: Record<string, number> = {
  divider: 0,
  M1: 0,
  M2: 586,
  M3: 764,
  M4: 780,
  M5: 784,
  M6: 787,
  M7: 790,
  M8: 793,
  M9: 796,
  M10: 804,
  M11: 1008,
  M12: 1054,
  M13: 1099,
  M14: 1250,
  M15: 1496,
};
export const REVEAL_FRAMES = 10;
export const revealAt = (frame: number): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [id, f] of Object.entries(APPEAR_AT)) {
    if (f <= 0) continue;
    out[id] = interpolate(frame, [f, f + REVEAL_FRAMES], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.2, 0, 0, 1)});
  }
  return out;
};

// ---- hero windows: message/row drawn in the hero layer; rise 0 -> 1 -> 0 ----
export interface HeroWindow {
  id: string; // message id or criterion id
  kind: 'message' | 'criterion';
  from: number; // excluded from the flat board from here (drawn in the hero layer)
  riseFrom: number;
  riseTo: number;
  landFrom: number; // back to rise 0 by landFrom + 12, returned to the board after it
}
export const HERO_WINDOWS: HeroWindow[] = [
  {id: 'M2', kind: 'message', from: 586, riseFrom: 594, riseTo: 614, landFrom: 778},
  {id: 'M10', kind: 'message', from: 804, riseFrom: 812, riseTo: 832, landFrom: 976},
  {id: 'C3.1', kind: 'criterion', from: 1258, riseFrom: 1339, riseTo: 1359, landFrom: 1468},
  {id: 'M15', kind: 'message', from: 1496, riseFrom: 1504, riseTo: 1524, landFrom: 1654},
];
export const LAND_FRAMES = 12;
export const heroAt = (frame: number): {w: HeroWindow; rise: number} | null => {
  const w = HERO_WINDOWS.find((h) => frame >= h.from && frame < h.landFrom + LAND_FRAMES);
  if (!w) return null;
  const up = interpolate(frame, [w.riseFrom, w.riseTo], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.2, 0, 0, 1)});
  const down = interpolate(frame, [w.landFrom, w.landFrom + LAND_FRAMES], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.2, 0, 0, 1)});
  return {w, rise: up * down};
};

// ---- headlines (storyboard-v4 §1: enter .. exit; exit is 8f before the next move) ----
export interface HeadlineWindow {
  id: string;
  copy: string;
  accent?: string[];
  enter: number;
  exit: number;
  top: number;
  left?: number;
  strike?: {wordIndex: number; part: string; from: number};
}
export const HEADLINES: HeadlineWindow[] = [
  // ①: the timeline's empty area under M1b (a top band would cut the team rows)
  {id: '①', copy: '사람과 Agent, 한 채널에', enter: 414, exit: 548, top: 330, left: 560},
  {id: '②', copy: '목표만 말하면, 배정은 PM이', accent: ['PM이'], enter: 584, exit: 770, top: 72},
  {id: '③', copy: '맥락은 통째로 넘어간다', enter: 808, exit: 968, top: 72},
  {id: '④', copy: "아무도 '시작해'라고 안 했다", enter: 1024, exit: 1226, top: 72, strike: {wordIndex: 1, part: "'시작해'", from: 1164}},
  {id: '⑤', copy: '판정은 보고가 아닌 증거로', enter: 1264, exit: 1460, top: 72},
  {id: '⑥', copy: '일이 끝나도, 목표를 본다', enter: 1498, exit: 1646, top: 72},
];

// ---- veils over out-of-focus units, per held beat (0..1, eased across moves) ----
type VeilSet = {sidebar: number; main: number; panel: number};
const VEILS: Record<string, VeilSet> = {
  O: {sidebar: 0, main: 0, panel: 0},
  '①': {sidebar: 0, main: 1, panel: 1},
  '②': {sidebar: 1, main: 0, panel: 1},
  '③': {sidebar: 0, main: 0, panel: 1},
  '④': {sidebar: 1, main: 0, panel: 1},
  '⑤': {sidebar: 1, main: 1, panel: 0},
  '⑥': {sidebar: 1, main: 0, panel: 1},
  C: {sidebar: 0, main: 0, panel: 0},
};
export const veilsAt = (frame: number): VeilSet => {
  let i = 0;
  while (i < CAMERA_KEYS.length - 1 && frame >= CAMERA_KEYS[i + 1].move) i++;
  const cur = CAMERA_KEYS[i];
  const prev = CAMERA_KEYS[Math.max(0, i - 1)];
  const t = i === 0 ? 1 : interpolate(frame, [cur.move, cur.move + MOVE_FRAMES], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const a = VEILS[prev.id];
  const b = VEILS[cur.id];
  return {sidebar: lerp(a.sidebar, b.sidebar, t), main: lerp(a.main, b.main, t), panel: lerp(a.panel, b.panel, t)};
};

// ---- closing ----
export const CLOSING = {
  headline: {copy: '다음 일은, PM이 챙긴다', enter: 1674, collapseFrom: 1732, collapseTo: 1750},
  wordmark: {from: 1744, settle: 1760},
  tagline: {copy: '사람과 Agent가 한 팀으로', enter: 1766},
  boardFade: {from: 1732, to: 1760},
};

// ---- pinned stills (storyboard-v4 §4) ----
export const PINS = {SF1a: 233, SF1b: 330, SF2: 714, SF3: 1414} as const;
