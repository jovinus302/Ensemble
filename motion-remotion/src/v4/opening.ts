// v4 opening timeline (storyboard-v4.md §2 segment O, design-v4 §2):
// ① and ② are type-led on an empty stage; the word swap turns ② into ③; ③
// recedes while the board enters at the opening start pose (0,-40,0) = SF1a;
// the board holds, then rotates to frontal while the camera pushes in to the
// SF1b framing; ③ is re-set above the landed board (= SF1b) and read.
//
// Why ③ recedes and returns: at the approved SF1a framing the board's near
// top corner reaches y≈88, so a T1 line in the SF1b headline band (y 64–182)
// would sit on the panel tabs, and a centered line would sit on the team rows
// and criteria. The board's (0,-40,0) moment is therefore text-free, as in
// the SF1a still (v3's Bridge used the same "type recedes, board advances").
import {Easing, interpolate} from 'remotion';
import type {CameraPose} from '../v3/tokens/video';
import {STILL_POSES} from './config';

export const OPENING = {
  // ① "Agent는 늘었는데": 2 words -> read >= max(1.2s, 2/3+0.5s) = 36f
  lineA: {enter: 0, exit: 48},
  // ② "다음 일은 사람이 챙긴다": 4 words -> read >= 1.83s = 55f. Last word starts
  // at f70; the reveal spring is 0.9998 by +30f -> ② is set and still at f100.
  lineB: {enter: 52},
  // round 5 (user: "no breathing room"): ② holds still 15f (f100–115) before the swap
  swap: {oldExit: 115, newEnter: 121, widthFrom: 115, widthTo: 129},
  // "AI PM이" is set at f151 (121 + 30); ③ then holds centered and fully still
  // for 60f (f151–211) — no board, no camera move, only the background drift.
  centerHold: {from: 151, to: 211},
  recede: {from: 211, to: 223}, // ③ (centered) recedes...
  boardEnter: {from: 217, to: 229}, // ...while the board fades in, half a beat later
  sf1aHold: {from: 229, to: 237}, // SF1a pinned at f233
  rotate: {from: 237, to: 267}, // 30f (design: 24–36f)
  // ③ re-set in the SF1b headline band (stagger 4): last word starts at +16f,
  // the reveal spring is 1.0000 by +40f -> fully set at f317 (= SF1b).
  lineC: {enter: 261, stagger: 4},
  // design-v4 r3 B "착지 즉시 PM이 답한다": once ③ reads in the band (~f297), the
  // AI PM replies under M1 (M1b, 12f rise) and its team row pops to "지휘 중"
  // (18f). M1b has 7 words -> read >= 7/3+0.5 = 2.83s = 85f -> hold to f388.
  pmReply: {from: 300, to: 312},
  pmPop: {from: 300, to: 318},
  sf1aPin: 233,
  sf1bPin: 330, // ③ settled (f317), reply settled, POP finished
  end: 388, // landed hold f267–388 (121f)
} as const;

export const pmReplyProgress = (frame: number) =>
  interpolate(frame, [OPENING.pmReply.from, OPENING.pmReply.to], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.2, 0, 0, 1),
  });

export const pmPopProgress = (frame: number) =>
  interpolate(frame, [OPENING.pmPop.from, OPENING.pmPop.to], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

// Ease-in-out with a long, soft landing: slow start out of the SF1a hold,
// fast through the oblique band, gentle settle onto frontal.
export const ROTATE_EASE = Easing.bezier(0.45, 0, 0.12, 1);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const rotationProgress = (frame: number) =>
  interpolate(frame, [OPENING.rotate.from, OPENING.rotate.to], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ROTATE_EASE,
  });

export const boardEnterProgress = (frame: number) =>
  interpolate(frame, [OPENING.boardEnter.from, OPENING.boardEnter.to], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.2, 0, 0, 1),
  });

// Camera/board pose per frame. Before the rotation it is exactly SF1a (plus a
// dz push during the entrance); after it, exactly SF1b.
export const openingPose = (frame: number): CameraPose => {
  const a = STILL_POSES.SF1a;
  const b = STILL_POSES.SF1b;
  const t = rotationProgress(frame);
  const enter = boardEnterProgress(frame);
  if (t <= 0) return {...a, dz: -240 * (1 - enter)};
  if (t >= 1) return b;
  return {
    tx: lerp(a.tx, b.tx, t),
    ty: lerp(a.ty, b.ty, t),
    s: lerp(a.s, b.s, t),
    rx: 0,
    ry: lerp(a.ry, b.ry, t),
    rz: 0,
    ax: lerp(a.ax, b.ax, t),
    ay: lerp(a.ay, b.ay, t),
    dz: 0,
  };
};

// design-v4 §4: |ry| in the 5–25° band is only passed through, within 12f.
export const obliqueBandFrames = () => {
  const frames: number[] = [];
  for (let f = 0; f <= OPENING.end; f++) {
    const ry = Math.abs(openingPose(f).ry);
    if (ry >= 5 && ry <= 25) frames.push(f);
  }
  return frames;
};

const band = obliqueBandFrames();
if (band.length > 12) throw new Error(`[v4] opening: |ry| in 5–25° for ${band.length} frames (> 12)`);
