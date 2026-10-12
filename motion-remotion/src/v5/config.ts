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

export interface WorldLook {
  id: StillId;
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
  shadow: {dx: number; dy: number; blurBase: number; blurPerH: number; opacity: number};
  nudge?: Partial<Record<SurfaceId, {x?: number; y?: number}>>; // per-look layout nudges (screen-layout fixes)
  bgOverlay?: string; // tone wash over the shared paper Background
  bg: 'paper' | {top: string; mid: string; bottom: string; glowA: string; glowB: string; vignette: number};
  aerial: {color: string; strength: number}; // far surfaces lighten toward this tone
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
    const z = b.z * look.depthMul;
    const k = refFactor(b.z) / refFactor(z);
    const n = look.nudge?.[id];
    out[id] = {x: b.x * k + (n?.x ?? 0), y: b.y * k + (n?.y ?? 0), z, yaw: b.yaw * look.yawMul, w: b.w, h: b.h};
  }
  return out;
};

export const wallZFor = (look: WorldLook) => Math.min(...Object.values(placementsFor(look)).map((p) => p.z)) - 260;

// ---------------------------------------------------------------- headline (SF-A)
// T1, left column in the empty upper-left; width keeps it to two lines.
export const HEADLINE_BOX = {left: 112, top: 84, width: 820};
export const MIN_SCREEN_TEXT_PX = 20;
