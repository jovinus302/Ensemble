// v4 (review/design-v4.md r1) — single source for the v4 look hypothesis:
// held camera poses, the 3-layer depth parameters (hero lift, wall shadow,
// board thickness) and the headline copy with its 18-char check.
//
// Camera model: v3's CameraPose + rigTransform/projectPoint are reused as-is
// (src/v3/stage/project.ts), so the CSS applied to the board rig and the
// callout-anchor math stay one method. v4 only restricts WHICH poses may be
// held: frontal (0,0,0) for every feature beat, and the single opening start
// pose (0,-40,0). Feature-beat camera = pan (tx,ty) + zoom (s) only.
import type {CameraPose} from '../v3/tokens/video';

// ---- held rotations (design-v4 §4: the only two allowed) ----
export const HELD_ROTATIONS = {
  frontal: {rx: 0, ry: 0, rz: 0},
  openingStart: {rx: 0, ry: -40, rz: 0},
} as const;

export type HeldRotationName = keyof typeof HELD_ROTATIONS;

export const heldRotationOf = (pose: CameraPose): HeldRotationName | null => {
  for (const [name, r] of Object.entries(HELD_ROTATIONS) as [HeldRotationName, {rx: number; ry: number; rz: number}][]) {
    if (pose.rx === r.rx && pose.ry === r.ry && pose.rz === r.rz) return name;
  }
  return null;
};

// Throws at render time if a still is ever configured with a non-allowed held pose.
export const assertHeldPose = (id: string, pose: CameraPose): HeldRotationName => {
  const name = heldRotationOf(pose);
  if (!name) throw new Error(`[v4] ${id}: held pose (${pose.rx},${pose.ry},${pose.rz}) is not (0,0,0) or (0,-40,0)`);
  return name;
};

// ---- zoom for feature beats ----
// s = 1.45 is the smallest zoom that keeps board-plane body text (bodyMd 14 /
// messageBody 15 logical) >= 20px on screen (14 * 1.45 = 20.3) and, with the
// hero lift's 1.02 scale + perspective magnification, keeps hero chips (24
// logical tall) >= 36px. All frontal stills share it so the board reads as
// one consistent object across beats.
export const FEATURE_ZOOM = 1.45;

// SF1b (landed, no hero card) — round 2: the frame must hold the board's full
// readable width, sidebar text (x 84) through the panel badges (x 1412), so
// no chip or badge is cut by a frame edge. That span is 1328 logical; at
// 1.45 it is 1926px (> 1920). 1.435 is the largest zoom that fits it with a
// ~7px margin per side, and still keeps bodyMd at 14 * 1.435 = 20.1px.
export const SF1B_ZOOM = 1.435;

// Screen y of the board's top edge in frontal stills: headlines live in the
// background band above the board, so they can never overlap UI text.
// SF1b's board top (212) is set so the bottom frame edge falls in the gap
// between sidebar team rows 4 and 5 — row 4's "작업 중" chip was cut at 252.
// SF2's is 176 (was 200): the AI PM reply M1b now sits between M1 and the
// plan card (design-v4 r3 B), so the card is 42 logical lower; 176 keeps its
// bottom edge ~40px inside the frame while the T2 headline (ends y 151) stays clear.
export const FRONTAL_BOARD_TOP = {SF1b: 212, SF2: 176, SF3: 200} as const;

const frontal = (tx: number, boardTopScreenY: number, s = FEATURE_ZOOM): CameraPose => ({
  // (ax, ay) = stage center; (tx, ty) = the board-logical point shown there.
  tx,
  ty: (540 - boardTopScreenY) / s,
  s,
  ...HELD_ROTATIONS.frontal,
  ax: 960,
  ay: 540,
  dz: 0,
});

export type StillId = 'SF1a' | 'SF1b' | 'SF2' | 'SF3';

// ---- camera pose table (every still is a held pose) ----
export const STILL_POSES: Record<StillId, CameraPose> = {
  // Opening start: whole board as an object, pivoting about its own center
  // (tx,ty = board center), right edge swung toward camera so the right side
  // face and the detached wall shadow are both in frame.
  SF1a: {tx: 720, ty: 450, s: 0.8, ...HELD_ROTATIONS.openingStart, ax: 880, ay: 520, dz: 0},
  // Landed: frontal, pushed in; sidebar text and panel badges both in frame.
  SF1b: frontal(748, FRONTAL_BOARD_TOP.SF1b, SF1B_ZOOM),
  // Beat 2 (plan): board's top-left corner in frame; plan card left of center,
  // callout chips in the empty timeline gap to its right.
  SF2: frontal(607, FRONTAL_BOARD_TOP.SF2),
  // Beat 5 (verdict): right panel center-right, board's right edge in frame so
  // the callout chip sits on the background, not on UI.
  SF3: frontal(1068, FRONTAL_BOARD_TOP.SF3),
};

// ---- hero lift (design-v4 §2: scale 1 -> 1.02, translateZ, shadow (8,16) blur 24 start) ----
export const HERO_LIFT = {
  scale: 1.02,
  z: 40, // logical; screen-space Z = z * s (~58px at s=1.45)
  shadow: {dx: 8, dy: 16, blur: 24, color: 'rgba(23,59,48,.24)'}, // logical px, board plane
} as const;

// ---- board thickness (opening needs a real side face) ----
export const BOARD_THICKNESS = 48; // logical
export const BOARD_RADIUS = 20; // logical, matches v3 board body

// ---- detached wall shadow (background layer) ----
// Each point of the slab outline is projected to the screen, then pushed
// along a fixed screen direction by its stage-space height above the wall
// plane: offset = (z - WALL.z) * light. Frontal boards get one uniform offset;
// at the opening's (0,-40,0) the near edge (z > 0) throws its shadow much
// farther than the far edge, so the shadow visibly separates from the board.
// (A true perspective projection onto a far wall shrinks the shadow toward
// the screen center and hides it behind the board — tried first, rejected.)
export const WALL = {
  z: -420, // stage px; behind the far back corner of the board at the opening pose
  light: {x: 0.09, y: 0.15}, // screen px of offset per stage px of height above the wall
  blur: 22, // screen px
  opacity: 0.3,
} as const;

// ---- layer parallax (design-v4 §2 "8-16px, to be tested") ----
// In stills only the hero-vs-board parallax exists (from the hero's Z lift,
// measured and reported). Background-vs-board parallax is a motion property;
// recorded here as the target for PitchV4, not applied to held stills.
export const PARALLAX_TARGET_PX = {min: 8, max: 16} as const;

// ---- copy (design-v4 §8, rank 1 adopted) ----
export const COPY = {
  opening1: 'Agent는 늘었는데',
  opening2: '다음 일은 사람이 챙긴다',
  opening3: '다음 일은 AI PM이 챙긴다', // SF1b
  beat2: '목표만 말하면, 배정은 PM이', // SF2
  beat5: '판정은 보고가 아닌 증거로', // SF3
  closing: '다음 일은, PM이 챙긴다',
} as const;

// MOTION.md: count every code point — spaces, punctuation and latin included.
export const headlineLength = (s: string) => [...s].length;
export const HEADLINE_MAX = 18;

for (const [k, v] of Object.entries(COPY)) {
  if (headlineLength(v) > HEADLINE_MAX) throw new Error(`[v4] headline ${k} "${v}" is ${headlineLength(v)} chars (> ${HEADLINE_MAX})`);
}
