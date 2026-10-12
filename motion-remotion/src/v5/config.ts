// v5 config (storyboard-v5.md §1 / §5 / §7): copy with the 18-char check, the
// Surface layout table, and the SF-A world options. SF-A options vary ONLY on
// the storyboard free axes: material, light direction, surface thickness,
// background tone, camera angle (within +-16 deg). Everything semantic
// (surface set, content, copy, colors-by-role) is shared.
import type {SurfacePlacement, WorldCamera} from './stage/worldProject';
import {PERSPECTIVE} from './stage/worldProject';

// ---------------------------------------------------------------- copy
export const HEADLINE_MAX_CHARS = 18;
export const assertHeadline = (copy: string) => {
  const n = Array.from(copy).length; // spaces and punctuation count
  if (n > HEADLINE_MAX_CHARS) throw new Error(`[v5] headline "${copy}" is ${n} chars (> ${HEADLINE_MAX_CHARS})`);
  return copy;
};

export const COPY = {
  B1: assertHeadline('일은 각자의 도구에서 한다'),
  B2: assertHeadline('맥락은 그 사이에서 끊긴다'),
  B3: assertHeadline('PM Agent가 맥락을 잇는다'),
  B4: assertHeadline('충돌은 먼저, 결정은 사람이'),
  B5: assertHeadline('반영될 때까지 챙긴다'),
  B6: assertHeadline('결정의 이유도 기억한다'),
  B7: assertHeadline('프로젝트 맥락은 한눈에'),
  C: assertHeadline('흩어진 맥락을, 하나의 목표로'),
} as const;

// ---------------------------------------------------------------- surfaces
export type SurfaceId = 'M' | 'D' | 'S' | 'P' | 'A';

export interface SurfaceSpec {
  id: SurfaceId;
  label: string; // function names only, never product names
  base: SurfacePlacement; // reference placement (look.depthMul rescales z, x/y are compensated)
}

// Storyboard §1 table, adjusted in the SF round: M moved down-left and the
// rest shifted so the upper-left stays empty for the T1 headline (that corner
// was occupied by M in the first sketch).
export const SURFACES: Record<SurfaceId, SurfaceSpec> = {
  M: {id: 'M', label: '미팅', base: {x: -660, y: 150, z: -200, yaw: 10, w: 760, h: 460}},
  D: {id: 'D', label: '디자인', base: {x: 400, y: -400, z: -420, yaw: -6, w: 820, h: 520}},
  S: {id: 'S', label: '메신저', base: {x: 640, y: 290, z: -80, yaw: -12, w: 640, h: 560}},
  P: {id: 'P', label: '문서', base: {x: -20, y: 400, z: -520, yaw: 4, w: 600, h: 520}},
  A: {id: 'A', label: '지은의 Agent', base: {x: 1120, y: -300, z: -640, yaw: -16, w: 560, h: 380}},
};

// ---------------------------------------------------------------- world looks
export type StillId = 'A1' | 'A2' | 'A3';

export type ThemeId = 'TA' | 'TB' | 'R';
export type FrameId = 'B1f140' | 'B3f600';

export interface WorldLook {
  id: StillId | ThemeId;
  name: string;
  camera: WorldCamera;
  depthMul: number; // z spacing multiplier (x/y re-compensated so the screen layout holds)
  yawMul: number; // surface yaw multiplier
  thickness: number; // world px
  radius: number;
  // edge (extrusion) colors: lit side -> shadow side, plus how much deeper layers darken
  edgeLit: string;
  edgeDark: string;
  edgeDepthDarken: number; // 0..1
  faceTone: string; // body color (style bible: surface #FFFFFF)
  faceGradient: string; // material sheen over the face (light direction baked in)
  bevel: string; // inset box-shadow of the face (rim light / ceramic bevel)
  rimLine: string; // 1px outline color
  contact: string; // tight in-plane shadow around the face (contact edge)
  edgeAngle: number; // css angle (deg) of the lit -> dark gradient across each extrusion layer
  // key light as the direction shadows travel on the wall (per px of height above the wall)
  shadow: {dx: number; dy: number; blurBase: number; blurPerH: number; opacity: number; color?: string; long?: {mult: number; opacity: number}};
  nudge?: Partial<Record<SurfaceId, {x?: number; y?: number}>>; // per-look layout nudges (screen-layout fixes)
  bgOverlay?: string; // tone wash over the shared paper Background
  bg: 'paper' | {top: string; mid: string; bottom: string; glowA: string; glowB: string; vignette: number};
  aerial: {color: string; strength: number; mode?: 'lighten' | 'darken'}; // far surfaces lighten (default) or darken toward this tone
  // ---- v6 theme fields (all optional; A1-A3 leave them unset)
  bgLayers?: string[]; // css background layers, first = top; replaces paper Background + wash
  stageColor?: string; // container background / loading color
  pools?: {rgb: string; scale: number; blur: number; base: number; lit: number}; // wall light pools behind each surface
  dof?: Partial<Record<SurfaceId, number>>; // px blur per surface (face + side layers individually)
  headline?: {color: string; accent: string; fontSize: number};
  zOverride?: Partial<Record<SurfaceId, number>>;
  yawSet?: Partial<Record<SurfaceId, number>>; // absolute surface yaw (overrides base*yawMul)
  darkRim?: string; // rim color of the dark terminal
  wallGap?: number;
  litEdge?: number; // max harmony bleed on thread-touched surfaces
  agentBody?: string;
  pal?: 'light' | 'dark';
  mono?: boolean;
  cursor?: string; // cursor color (theme R)
  grain?: number; // static grain opacity
  dim?: {color: string; strength: number; blur: number}; // unconnected surfaces
  halo?: number; // thread halo opacity
  threadShadow?: string;
  drop?: {dy: number; blur: number; inset: number; alpha: number}; // ambient drop shadow as a blurred plane behind the slab (large box-shadows on 3D faces tear in Chrome)
  compWall?: boolean; // wall planes (shadows/pools) compensated so they project right behind the slab
}

export const LOOKS: Record<StillId, WorldLook> = {
  A1: {
    id: 'A1',
    name: '소프트 클레이 슬랩 (따뜻한 좌상단 빛)',
    camera: {tx: 110, ty: 60, tz: 0, yaw: -8, pitch: 7, s: 0.8},
    depthMul: 1,
    yawMul: 1,
    thickness: 64,
    radius: 26,
    edgeLit: '#EFEADF',
    edgeDark: '#BFB49E',
    edgeDepthDarken: 0.16,
    faceTone: '#FFFFFF',
    faceGradient: 'linear-gradient(140deg, rgba(255,250,240,.7) 0%, rgba(255,255,255,0) 38%, rgba(120,110,90,.07) 100%)',
    bevel: 'inset 0 2px 0 rgba(255,255,255,.95), inset 0 -3px 6px rgba(120,110,90,.10)',
    rimLine: 'rgba(201,209,203,.7)',
    contact: '0 1px 2px rgba(80,70,50,.18)',
    edgeAngle: 135,
    shadow: {dx: 0.07, dy: 0.11, blurBase: 12, blurPerH: 0.022, opacity: 0.3},
    bg: 'paper',
    bgOverlay: 'rgba(150,128,92,.09)',
    aerial: {color: '#F4F1EA', strength: 0.12},
  },
  A2: {
    id: 'A2',
    name: '세라믹 패널 (차가운 우상단 빛, 깊은 간격)',
    camera: {tx: 90, ty: 60, tz: 0, yaw: 6, pitch: 4, s: 0.8},
    depthMul: 1.5,
    yawMul: 1,
    thickness: 14,
    radius: 22,
    edgeLit: '#FFFFFF',
    edgeDark: '#AEBBB5',
    edgeDepthDarken: 0.1,
    faceTone: '#FFFFFF',
    faceGradient:
      'linear-gradient(112deg, rgba(255,255,255,0) 36%, rgba(255,255,255,.34) 46%, rgba(255,255,255,0) 56%), linear-gradient(210deg, rgba(160,190,200,.14) 0%, rgba(255,255,255,0) 45%, rgba(70,90,100,.05) 100%)',
    bevel: 'inset 0 0 0 2px rgba(255,255,255,1), inset 0 -4px 0 rgba(90,110,120,.10), inset 0 3px 10px rgba(255,255,255,.9)',
    rimLine: 'rgba(120,140,150,.45)',
    contact: '0 2px 3px rgba(40,60,70,.30), 0 0 0 1px rgba(60,80,90,.10)',
    edgeAngle: 225,
    shadow: {dx: -0.06, dy: 0.1, blurBase: 9, blurPerH: 0.02, opacity: 0.26},
    bg: {top: '#EFF3F3', mid: '#E4EBEA', bottom: '#D3DDDB', glowA: 'rgba(255,255,255,.9)', glowB: 'rgba(170,200,215,.35)', vignette: 0.12},
    aerial: {color: '#E4EBEA', strength: 0.16},
  },
  A3: {
    id: 'A3',
    name: '두꺼운 압출 타일 (강한 방향광, 따뜻한 배경, 극적인 각도)',
    camera: {tx: 215, ty: 60, tz: 0, yaw: -15, pitch: 8, s: 0.8},
    depthMul: 1.15,
    yawMul: 1.25,
    nudge: {P: {x: -95, y: 15}},
    thickness: 96,
    radius: 30,
    edgeLit: '#C9C6B9',
    edgeDark: '#4B4F47',
    edgeDepthDarken: 0.35,
    faceTone: '#FFFEFA',
    faceGradient: 'linear-gradient(100deg, rgba(255,244,214,.75) 0%, rgba(255,255,255,0) 34%, rgba(60,55,40,.14) 100%)',
    bevel: 'inset 0 3px 0 rgba(255,255,255,.95), inset 0 -2px 0 rgba(40,40,30,.12)',
    rimLine: 'rgba(60,60,50,.28)',
    contact: '0 3px 8px -2px rgba(40,35,25,.35)',
    edgeAngle: 100,
    shadow: {dx: 0.14, dy: 0.08, blurBase: 6, blurPerH: 0.014, opacity: 0.38},
    bg: {top: '#F0E4CC', mid: '#E6D5B5', bottom: '#D2BE97', glowA: 'rgba(255,244,214,.95)', glowB: 'rgba(210,150,90,.25)', vignette: 0.22},
    aerial: {color: '#E6D5B5', strength: 0.08},
  },
};

export const refFactor = (z: number) => PERSPECTIVE / (PERSPECTIVE - z);

/** surface placements for a look: z * depthMul, x/y re-compensated by the perspective ratio, yaw * yawMul */
export const placementsFor = (look: WorldLook): Record<SurfaceId, SurfacePlacement> => {
  const out = {} as Record<SurfaceId, SurfacePlacement>;
  for (const id of Object.keys(SURFACES) as SurfaceId[]) {
    const b = SURFACES[id].base;
    const z = look.zOverride?.[id] ?? b.z * look.depthMul;
    const k = refFactor(b.z) / refFactor(z);
    const n = look.nudge?.[id];
    out[id] = {x: b.x * k + (n?.x ?? 0), y: b.y * k + (n?.y ?? 0), z, yaw: look.yawSet?.[id] ?? b.yaw * look.yawMul, w: b.w, h: b.h};
  }
  return out;
};

export const wallZFor = (look: WorldLook) => Math.min(...Object.values(placementsFor(look)).map((p) => p.z)) - (look.wallGap ?? 260);

// ---------------------------------------------------------------- headline (SF-A)
// T1, left column in the empty upper-left; width keeps it to two lines.
export const HEADLINE_BOX = {left: 112, top: 84, width: 820};
export const MIN_SCREEN_TEXT_PX = 20;

// ---------------------------------------------------------------- v6 themes (review/log-v6-theme.md)
export interface FrameSpec {
  state: 'B1' | 'B3';
  camera?: Partial<WorldCamera>;
  yawMul?: number;
  yawSet?: Partial<Record<SurfaceId, number>>;
  nudge?: Partial<Record<SurfaceId, {x?: number; y?: number}>>;
  lit: SurfaceId[]; // thread-touched surfaces
  dimmed: SurfaceId[]; // unconnected surfaces pushed back
  glow: number; // thread glow 0..1
  thread: boolean;
  litEdge: boolean;
  dof?: Partial<Record<SurfaceId, number>>; // per-frame DOF override (rack-focus endpoint)
  headlineCursor?: boolean;
  messengerCursor?: 'first' | 'reply';
}

const DARK_FACE_GRAD = 'linear-gradient(135deg, rgba(255,255,255,.035) 0%, rgba(255,255,255,0) 50%)';

export const THEMES: Record<ThemeId, WorldLook> = {
  TA: {
    id: 'TA',
    name: '합주 무대 — 빛은 PM Agent의 실에서 온다',
    camera: {tx: 167, ty: 50, tz: 0, yaw: -10, pitch: 6, s: 0.86},
    depthMul: 1,
    yawMul: 1,
    thickness: 40,
    radius: 24,
    edgeLit: '#E3E9E5',
    edgeDark: '#3B4640',
    edgeDepthDarken: 0.3,
    faceTone: '#FFFFFF',
    faceGradient: 'linear-gradient(135deg, rgba(255,255,255,0) 55%, rgba(14,36,28,.10) 100%)',
    bevel: 'inset 0 1.5px 0 #FFFFFF',
    rimLine: 'rgba(255,255,255,.35)',
    contact: '0 2px 4px rgba(0,0,0,.35)',
    drop: {dy: 24, blur: 24, inset: 16, alpha: 0.5},
    edgeAngle: 135,
    shadow: {color: 'rgb(2,6,4)', opacity: 0.65, blurBase: 18, blurPerH: 0.03, dx: 0.05, dy: 0.12},
    bg: 'paper',
    bgLayers: ['radial-gradient(ellipse 110% 95% at 60% 45%, transparent 45%, rgba(4,8,6,.6) 100%)', 'linear-gradient(180deg, #173B30 0%, #0E1311 70%)'],
    stageColor: '#0E1311',
    pools: {rgb: '246,246,243', scale: 1.5, blur: 120, base: 0.06, lit: 0.2},
    aerial: {color: '#0E1311', strength: 0.18, mode: 'darken'},
    dof: {A: 3, P: 2.5},
    headline: {color: '#E3E9E5', accent: '#8FD5B3', fontSize: 136},
    zOverride: {S: 40, A: -800, P: -650},
    darkRim: 'rgba(255,255,255,.34)',
    wallGap: 160,
    litEdge: 0.35,
    agentBody: '#27302C',
    dim: {color: '#0E1311', strength: 0.35, blur: 3},
    halo: 0.22,
    threadShadow: 'rgba(0,0,0,.45)',
    compWall: true,
  },
  TB: {
    id: 'TB',
    name: '북극성 정렬장 — 흩어진 면이 실을 따라 정렬된다',
    camera: {tx: 167, ty: 50, tz: 0, yaw: -6, pitch: 5, s: 0.86},
    depthMul: 1,
    yawMul: 1.6,
    thickness: 36,
    radius: 24,
    edgeLit: '#E5E8E3',
    edgeDark: '#7A867F',
    edgeDepthDarken: 0.2,
    faceTone: '#FFFFFF',
    faceGradient: 'linear-gradient(135deg, rgba(255,255,255,0) 60%, rgba(24,32,28,.05) 100%)',
    bevel: 'inset 0 1.5px 0 #FFFFFF',
    rimLine: 'rgba(24,32,28,.14)',
    contact: '0 1px 2px rgba(24,32,28,.25)',
    edgeAngle: 135,
    shadow: {color: 'rgb(24,32,28)', opacity: 0.45, blurBase: 4, blurPerH: 0.015, dx: 0.06, dy: 0.06, long: {mult: 1.8, opacity: 0.14}},
    bg: 'paper',
    bgLayers: [
      'radial-gradient(ellipse 120% 110% at 55% 45%, transparent 50%, rgba(24,32,28,.22) 100%)',
      'radial-gradient(ellipse 50% 55% at 62% 42%, #FFFFFF, transparent 70%)',
      'linear-gradient(180deg, #FFFFFF 0%, #F6F6F3 45%, #DCDFDA 100%)',
    ],
    stageColor: '#F6F6F3',
    wallGap: 120,
    aerial: {color: '#FFFFFF', strength: 0},
    dof: {A: 3, P: 2.5},
    headline: {color: '#18201C', accent: '#2B6A52', fontSize: 144},
    agentBody: '#18201C',
    threadShadow: 'rgba(24,32,28,.22)',
    compWall: true,
  },
  R: {
    id: 'R',
    name: '커서에서 시작하는 원샷 — 쓰는 손',
    camera: {tx: 167, ty: 50, tz: 0, yaw: -10, pitch: 6, s: 0.86},
    depthMul: 1,
    yawMul: 1,
    thickness: 12,
    radius: 20,
    edgeLit: '#2F3A34',
    edgeDark: '#0E1311',
    edgeDepthDarken: 0.25,
    faceTone: '#151B18',
    faceGradient: DARK_FACE_GRAD,
    bevel: 'inset 0 1px 0 rgba(255,255,255,.06)',
    rimLine: '#3B4640',
    contact: '0 1px 2px rgba(0,0,0,.5)',
    drop: {dy: 30, blur: 40, inset: 20, alpha: 0.7},
    edgeAngle: 135,
    shadow: {color: 'rgb(0,0,0)', opacity: 0.55, blurBase: 22, blurPerH: 0.03, dx: 0.05, dy: 0.12},
    bg: 'paper',
    bgLayers: [
      'radial-gradient(rgba(227,233,229,.07) 1.2px, transparent 1.4px) 0 0/28px 28px',
      'radial-gradient(ellipse 38% 45% at 18% 12%, rgba(31,81,63,.55), transparent 70%)',
      'radial-gradient(ellipse 34% 40% at 86% 88%, rgba(74,58,30,.45), transparent 70%)',
      '#151612',
    ],
    stageColor: '#151612',
    grain: 0.05,
    aerial: {color: '#0E1311', strength: 0.12, mode: 'darken'},
    dof: {A: 3, P: 2.5},
    headline: {color: '#E3E9E5', accent: '#8FD5B3', fontSize: 136},
    zOverride: {S: 40, A: -800, P: -650},
    wallGap: 160,
    litEdge: 0.3,
    agentBody: '#0E1311',
    darkRim: '#566660',
    pal: 'dark',
    mono: true,
    cursor: '#8FD5B3',
    dim: {color: '#0E1311', strength: 0.22, blur: 3},
    halo: 0.18,
    threadShadow: 'rgba(0,0,0,.5)',
    compWall: true,
  },
};

export const THEME_FRAMES: Record<ThemeId, Record<FrameId, FrameSpec>> = {
  TA: {
    B1f140: {state: 'B1', lit: [], dimmed: [], glow: 0, thread: false, litEdge: false},
    B3f600: {state: 'B3', lit: ['M', 'D', 'S', 'A'], dimmed: ['P'], glow: 1, thread: true, litEdge: true, dof: {A: 1.5}},
  },
  TB: {
    B1f140: {state: 'B1', lit: [], dimmed: [], glow: 0, thread: false, litEdge: false},
    B3f600: {state: 'B3', yawSet: {M: -6, D: -6, S: -6, A: -6}, lit: ['M', 'D', 'S', 'A'], dimmed: [], glow: 0, thread: true, litEdge: false},
  },
  R: {
    B1f140: {state: 'B1', lit: [], dimmed: [], glow: 0, thread: false, litEdge: false, headlineCursor: true, messengerCursor: 'first'},
    B3f600: {state: 'B3', lit: ['M', 'D', 'S', 'A'], dimmed: ['P'], glow: 1, thread: true, litEdge: true, dof: {A: 1.5}, headlineCursor: true, messengerCursor: 'reply'},
  },
};

export const themeLook = (theme: ThemeId, frame: FrameId): {look: WorldLook; spec: FrameSpec} => {
  const base = THEMES[theme];
  const spec = THEME_FRAMES[theme][frame];
  const look: WorldLook = {
    ...base,
    camera: {...base.camera, ...spec.camera},
    dof: {...base.dof, ...spec.dof},
    yawMul: spec.yawMul ?? base.yawMul,
    yawSet: spec.yawSet ?? base.yawSet,
    nudge: {...base.nudge, ...spec.nudge},
  };
  return {look, spec};
};

export const HEADLINE_BOX_V6 = {left: 112, top: 84, width: 880};
// thread branches: control-point offsets from the start / end anchor (screen px), tuned per render
export const THREAD_ROUTES: Record<'D' | 'S' | 'A', {c1: [number, number]; c2: [number, number]}> = {
  D: {c1: [40, -170], c2: [-120, 150]},
  S: {c1: [120, -150], c2: [-170, -150]},
  A: {c1: [260, -250], c2: [-420, 24]},
};
