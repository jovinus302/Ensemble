// v5 pitch film (storyboard-v5.md), full length 1680f: B1 .. Closing. Every value
// is a pure function of useCurrentFrame(); event frames come from ./timeline (which
// reads public/audio/timing.json through ./timing). The scene is the approved TA
// style-frame world: same config, WorldStage, SurfaceFrame and surface bodies, with
// the film animation context (surfaces/film.tsx) feeding the bodies.
import React, {createContext, useContext, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {AbsoluteFill, Audio, Sequence, continueRender, delayRender, staticFile, useCurrentFrame} from 'remotion';
import {ensurePretendardLoaded, ensurePretendardVariableLoaded, FONT_FAMILY} from '../tokens/fonts';
import {AFTERGLOW_ROUTES, COPY, HEADLINE_BOX_V6, MIN_SCREEN_TEXT_PX, SOURCE_ROUTES, THREAD_ROUTES, placementsFor, themeLook} from './config';
import type {SurfaceId} from './config';
import {TOTAL_FRAMES} from './timing';
import {B1, B2, B3, B4, B5, B6, B7, C, SFX_EVENTS, sfxFile} from './timeline';
import {C0, cameraAt, camMoving} from './camera';
import {CameraMotionBlur} from '@remotion/motion-blur';
import {BEAT, EASE, SPR, clamp01, eased, lerp, prog, sp} from './anim';
import {afterglowAt, capGlowAt, capsuleAppearAt, capsuleDateAt, dimPAt, dofAAt, dofPAt, evenAt, filmAnimAt, glowAt, headlineAt, litAt, morphAt, poolBreath, poolFadeAt, rackAt, recedeAt, threadAt, threadFadeAt} from './filmAnim';
import {WorldStage} from './stage/WorldStage';
import type {PoolAmt} from './stage/WorldStage';
import type {SurfacePlacement, WorldCamera} from './stage/worldProject';
import {PERSPECTIVE, cameraMatrix, perspectiveDivide, projectSurfacePoint, surfaceMatrix, surfaceScreenScale, wallPointForScreen} from './stage/worldProject';
import {SurfaceFrame} from './surfaces/SurfaceFrame';
import {Messenger} from './surfaces/Messenger';
import {Canvas} from './surfaces/Canvas';
import {Meeting} from './surfaces/Meeting';
import {Doc} from './surfaces/Doc';
import {AgentTerminal} from './surfaces/AgentTerminal';
import {ContextView} from './surfaces/ContextView';
import {FilmProvider} from './surfaces/film';
import {SourceDraw, ThreadDraw} from './fx/ThreadDraw';
import {Thread} from './fx/Thread';
import {DashBreak} from './fx/DashBreak';
import {Capsule} from './fx/Capsule';
import {RevealWords, WordBox} from './type/HeadlineFilm';

type Id = Exclude<SurfaceId, 'V'>;
const IDS: Id[] = ['M', 'D', 'S', 'P', 'A'];
const ALL: SurfaceId[] = [...IDS, 'V'];
const BODY: Record<SurfaceId, React.FC> = {M: Meeting, D: Canvas, S: Messenger, P: Doc, A: AgentTerminal, V: ContextView};

// ------------------------------------------------------------------ static scene (TA look)
const LOOK0 = themeLook('TA', 'B1f140').look; // camera C0, dof {A: 3, P: 2.5}
const PLACES0 = placementsFor(LOOK0) as Record<Id, SurfacePlacement>;
// the B7 world (approved TA-B7f1440): S nudged and shorter, V in the lower right
const B7_SPEC = themeLook('TA', 'B7f1440');
const PLACES7 = placementsFor(B7_SPEC.look);
const PV = PLACES7.V; // final V placement
const FAR_Z = Math.min(...IDS.map((i) => PLACES0[i].z));
const CAM7 = cameraAt(B7.still);
const floorFor = (cam: WorldCamera, pl: SurfacePlacement) => Math.ceil((MIN_SCREEN_TEXT_PX + 0.6) / surfaceScreenScale(cam, pl));
// minimum logical UI font per surface so on-screen text stays >= 20px: sized for the TA reading camera, then for the B7 pull-back camera (the TA-B7 style frame uses these larger floors)
const FONT_FLOOR0: Record<SurfaceId, number> = Object.fromEntries([...IDS.map((i) => [i, floorFor(C0, PLACES0[i])]), ['V', floorFor(CAM7, PV)]]) as Record<SurfaceId, number>;
const FONT_FLOOR7: Record<SurfaceId, number> = Object.fromEntries([...IDS.map((i) => [i, floorFor(CAM7, PLACES7[i])]), ['V', floorFor(CAM7, PV)]]) as Record<SurfaceId, number>;
const HEAD = LOOK0.headline!;
const GROUP_C = {x: IDS.reduce((a, i) => a + PLACES0[i].x, 0) / IDS.length, y: IDS.reduce((a, i) => a + PLACES0[i].y, 0) / IDS.length};
const V_HEADER = 60; // ContextView geometry: header + 4 equal rows
const V_ROW = (PV.h - V_HEADER) / 4;

// how each surface arrives (B1): offset it travels from, in world px (dz = from deep Z), plus a yaw swing
const ENTER_FROM: Record<Exclude<Id, 'S'>, {dx: number; dy: number; dz: number; yaw: number}> = {
  D: {dx: -160, dy: -260, dz: -1200, yaw: 28},
  M: {dx: -460, dy: 120, dz: -1000, yaw: -30},
  P: {dx: 180, dy: 340, dz: -1100, yaw: 24},
  A: {dx: 520, dy: -140, dz: -1100, yaw: -34},
};
const MOTION_BLUR = {shutterAngle: 100, samples: 4}; // T-cam segments only; single-worker cost ~0.38s per sample-frame, so 4 samples ~1.5s/frame (the budget)
const BAND_BOTTOM = 92; // MeetingFilm caption band geometry (see surfaces/MeetingFilm.tsx)
const BAND_H = 64;
const CAPSULE_REST = {sx: 940, sy: 566, z: 60}; // where the capsule rests (screen at the B2-end camera, depth z)
const CAPSULE_LIFT = 26;
const S_FORWARD = 130; // B6: S steps toward the camera
const RECEDE_Z = 420; // closing: the surfaces step back

type Anchor = {surface: SurfaceId; u: number; v: number; w: number; h: number};
type Side = 'left' | 'right' | 'top' | 'bottom';
const ANCHOR_SIDE: Record<string, Side> = {'pm-tile': 'right', 'comment-pin': 'left', 'pm-reply': 'left', 'pm-answer': 'left', 'slot-brief': 'left', 'd-ring': 'left', 's-ask': 'left', 'doc-ad': 'left', 's-card': 'right', 's-source': 'left', 'doc-row': 'right'};
const THREAD_LIFT = 20;

const projectWorld = (cam: WorldCamera, p: {x: number; y: number; z: number}) => {
  const q = cameraMatrix(cam).transformPoint(new DOMPoint(p.x, p.y, p.z));
  const s = perspectiveDivide(q);
  return {x: s.x, y: s.y, k: (cam.s * PERSPECTIVE) / (PERSPECTIVE - q.z)};
};
const surfaceWorld = (pl: SurfacePlacement, u: number, v: number, lift = 0) => {
  const q = surfaceMatrix(pl).transformPoint(new DOMPoint(u - pl.w / 2, v - pl.h / 2, lift));
  return {x: q.x, y: q.y, z: q.z};
};
const mix3 = (a: {x: number; y: number; z: number}, b: {x: number; y: number; z: number}, t: number) => ({x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t)});
type P2 = {x: number; y: number};
const bez = (a: P2, b: P2, c: P2, d: P2, t: number): P2 => {
  const m = 1 - t;
  return {x: m * m * m * a.x + 3 * m * m * t * b.x + 3 * m * t * t * c.x + t * t * t * d.x, y: m * m * m * a.y + 3 * m * m * t * b.y + 3 * m * t * t * c.y + t * t * t * d.y};
};
const lerp2 = (a: P2, b: P2, t: number): P2 => ({x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t)});

const WORDS = {
  b1: COPY.B1.split(' '),
  b2: COPY.B2.split(' '),
  b3: COPY.B3.split(' '), // PM Agent가 맥락을 잇는다 -> [PM, Agent가, 맥락을, 잇는다]
  b4: COPY.B4.split(' '),
  b5: COPY.B5.split(' '),
  b6: COPY.B6.split(' '),
  b7: COPY.B7.split(' '),
  c: COPY.C.split(' '),
};
const B2_BOX = {left: 112, top: 150, width: 760, fontSize: 108};
// per-beat headline boxes (storyboard §3: B4 right / asymmetric, B5 lower left, B6 top center, B7 upper left, closing center)
const HB = {
  b4: {left: 40, top: 30, width: 660, size: 84, justify: 'flex-end' as const}, // right-aligned in the left column: D owns the upper right at this camera
  b5: {left: 112, top: 70, width: 760, size: 104, justify: 'flex-start' as const}, // M / P fill the lower left at this camera
  b6: {left: 40, top: 60, width: 720, size: 96, justify: 'center' as const}, // D fills the top center once the rack focus releases
  b7: {left: HEADLINE_BOX_V6.left, top: HEADLINE_BOX_V6.top, width: HEADLINE_BOX_V6.width, size: 112, justify: 'flex-start' as const},
  c: {left: 160, top: 360, width: 1600, size: 112, justify: 'center' as const},
};
// closing geometry: the wordmark, its underline (the converged thread) and the lockup
const WM = {cx: 960, cy: 470, size: 200, lineY: 610, x0: 510, x1: 1410};

const stage = {
  placements(frame: number, noForward = false): Record<SurfaceId, SurfacePlacement & {e: number}> {
    const spr = EASE.inout(prog(frame, B2.spread.start, B2.spread.end - B2.spread.start)) * (1 - EASE.out(prog(frame, B3.spreadBack.start, B3.spreadBack.end - B3.spreadBack.start)));
    const fwd = noForward ? 0 : EASE.inout(prog(frame, B6.forward.start, B6.forward.end - B6.forward.start)) * (1 - EASE.inout(prog(frame, B6.back.start, B6.back.end - B6.back.start)));
    const b7a = EASE.inout(prog(frame, B7.camMove.start, B7.camMove.end - B7.camMove.start));
    const rec = recedeAt(frame);
    const out = {} as Record<SurfaceId, SurfacePlacement & {e: number}>;
    for (const id of IDS) {
      const b = PLACES0[id];
      let e = 1;
      let pl: SurfacePlacement = {...b};
      if (id !== 'S') {
        const from = ENTER_FROM[id];
        e = EASE.out(prog(frame, B1.enter[id], B1.enterDur));
        pl = {...b, x: b.x + from.dx * (1 - e), y: b.y + from.dy * (1 - e) - 90 * Math.sin(Math.PI * e) * (1 - e), z: b.z + from.dz * (1 - e), yaw: b.yaw + from.yaw * (1 - e), sc: 0.3 + 0.7 * e};
      } else {
        const t = PLACES7.S; // B7: S is nudged and shorter
        pl = {...b, x: lerp(b.x, t.x, b7a), y: lerp(b.y, t.y, b7a), h: lerp(b.h, t.h, b7a), z: b.z + S_FORWARD * fwd};
      }
      const dx = b.x - GROUP_C.x;
      const dy = b.y - GROUP_C.y;
      const len = Math.hypot(dx, dy) || 1;
      pl = {...pl, x: pl.x + (dx / len) * B2.spread.px * spr, y: pl.y + (dy / len) * B2.spread.px * spr, z: pl.z - RECEDE_Z * rec};
      out[id] = {...pl, e};
    }
    // V grows out of the decision capsule: the 결정 row stays where the capsule landed, rows unfold up and down from it
    if (frame >= B7.vGrow.start) {
      const g = EASE.out(prog(frame, B7.vGrow.start, B7.vGrow.end - B7.vGrow.start));
      const A = filmAnimAt(frame).V;
      const rowsOpen = A.rows[0] + 1 + A.rows[2] + A.rows[3];
      const h = V_HEADER + V_ROW * rowsOpen;
      const yDecision = PV.y + (V_HEADER + V_ROW * 1.5 - PV.h / 2); // world y of the decision row (final layout)
      const top = yDecision - (V_HEADER + V_ROW * (A.rows[0] + 0.5));
      out.V = {...PV, y: top + h / 2, h, z: PV.z - RECEDE_Z * rec, sc: 0.45 + 0.55 * g, e: g};
    }
    return out;
  },
};

/** QA: on-screen px of the smallest UI text (20 logical px, or the surface's floor if larger) per surface at film frame f */
export const qaTextPx = (f: number) => {
  const pl = stage.placements(f);
  const cam = cameraAt(f);
  const b7a = EASE.inout(prog(f, B7.camMove.start, B7.camMove.end - B7.camMove.start));
  return (Object.keys(pl) as SurfaceId[]).map((id) => ({id, px: Math.max(20, lerp(FONT_FLOOR0[id], FONT_FLOOR7[id], b7a)) * surfaceScreenScale(cam, pl[id]), e: pl[id].e}));
};

// ------------------------------------------------------------------ the film
/** teaser: the scene reads source frames through `map` (teaser.ts) and drops the headlines that do not belong to the teaser */
export const FrameMapCtx = createContext<{map: (tf: number) => number; teaser: boolean; cam?: (tf: number) => WorldCamera | undefined} | null>(null);

export const Scene: React.FC = () => {
  const tfRaw = useCurrentFrame();
  const fm = useContext(FrameMapCtx);
  const f = fm ? fm.map(tfRaw) : tfRaw;
  const teaser = !!fm?.teaser;
  const rootRef = useRef<HTMLDivElement>(null);
  const cam = fm?.cam?.(tfRaw) ?? cameraAt(f); // teaser bridges: one smooth camera move instead of the source path
  const [anchors, setAnchors] = useState<Record<string, Anchor>>({});
  const [rects, setRects] = useState<{b2?: {x: number; y: number}[]; b3?: {x: number; y: number}[]}>({});
  const camRatio = cam.s / C0.s;

  // anchors: layout offsets of [data-anchor] elements measured every frame (layout is animated), projected with the live placements
  useLayoutEffect(() => {
    const out: Record<string, Anchor> = {};
    (rootRef.current ?? document).querySelectorAll<HTMLElement>('[data-anchor]').forEach((el) => {
      let u = 0;
      let v = 0;
      let e: HTMLElement | null = el;
      let surface: SurfaceId | undefined;
      while (e) {
        if (e.dataset.surface) {
          surface = e.dataset.surface as SurfaceId;
          break;
        }
        u += e.offsetLeft;
        v += e.offsetTop;
        e = e.offsetParent as HTMLElement | null;
      }
      if (surface) out[el.dataset.anchor!] = {surface, u, v, w: el.offsetWidth, h: el.offsetHeight};
    });
    setAnchors((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
  });

  const places = stage.placements(f, teaser);
  const look = {...LOOK0, camera: cam};
  const present = ALL.filter((id) => places[id] && (id === 'S' || id === 'V' || f >= B1.enter[id as Exclude<Id, 'S'>]));

  // ------------------------------------------------ light / dof amounts
  const capGlow = capGlowAt(f);
  const litAmt: Record<Id, number> = litAt(f);
  const evenA = evenAt(f);
  const fade = poolFadeAt(f);
  const breath = teaser ? 1 : poolBreath(f);
  const vG = places.V ? places.V.e : 0;
  const poolAmt: PoolAmt = Object.fromEntries(
    (Object.keys(places) as SurfaceId[]).map((id) => [id, {lit: id === 'V' ? vG : litAmt[id as Id] * (litAmt[id as Id] > 0.9 ? breath : 1), vis: (id === 'S' ? 1 : present.includes(id) ? clamp01((places[id].e - 0.45) / 0.55) : 0) * fade}]),
  ) as PoolAmt;
  const dimP = dimPAt(f);
  const rack = teaser ? 0 : rackAt(f); // the teaser skips B6: no rack focus
  const rec = recedeAt(f);
  const b7a = EASE.inout(prog(f, B7.camMove.start, B7.camMove.end - B7.camMove.start));
  const blurOf = (id: SurfaceId) => {
    const base = id === 'A' ? dofAAt(f, LOOK0.dof!.A!) : id === 'P' ? dofPAt(f, LOOK0.dof!.P!) : 0;
    return base + (id === 'S' || id === 'V' ? 0 : 6 * rack) + 10 * rec;
  };
  const film = filmAnimAt(f);

  // ------------------------------------------------ projections for overlay elements
  const pt = (id: string, side?: Side, fy = 0.5) => {
    const a = anchors[id];
    if (!a || !places[a.surface]) return undefined;
    const sd = side ?? ANCHOR_SIDE[id] ?? 'left';
    const x = sd === 'right' ? a.u + a.w + 6 : sd === 'left' ? a.u - 10 : a.u + a.w / 2;
    const y = sd === 'bottom' ? a.v + a.h + 10 : sd === 'top' ? a.v - 10 : a.v + a.h * fy;
    return projectSurfacePoint(cam, places[a.surface], x, y, THREAD_LIFT);
  };
  const anchorWorld = (id: string, lift = CAPSULE_LIFT) => {
    const a = anchors[id];
    return a && places[a.surface] ? surfaceWorld(places[a.surface], a.u + a.w / 2, a.v + a.h / 2, lift) : undefined;
  };
  // faces in front of a line that must pass behind them: every surface except the ones it starts / ends on
  const occ = (...except: (SurfaceId | undefined)[]) =>
    present
      .filter((id) => !except.includes(id))
      .map((id) => {
        const pl = places[id];
        return [projectSurfacePoint(cam, pl, 0, 0), projectSurfacePoint(cam, pl, pl.w, 0), projectSurfacePoint(cam, pl, pl.w, pl.h), projectSurfacePoint(cam, pl, 0, pl.h)].map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');
      });
  const surfOf = (id: string) => anchors[id]?.surface;

  // ------------------------------------------------ the B6 reverse thread (source chip -> PM tile), used by the capsule too
  const revStart = pt('s-source', 'left');
  const revEnd = pt('pm-tile', 'right', 0.5);
  const reverse =
    revStart && revEnd && f >= B6.reverse.start && !teaser
      ? (() => {
          const th = threadAt(B6.reverse, f);
          const p0 = revStart;
          const p3 = revEnd;
          const p1 = {x: p0.x - 260 * camRatio, y: p0.y - 40 * camRatio};
          const p2 = {x: p3.x + 300 * camRatio, y: p3.y + 160 * camRatio};
          return {p0, p1, p2, p3, ...th};
        })()
      : undefined;

  // ------------------------------------------------ capsule (world path -> screen): B2 form/leave, B3 absorb, B6 memory, B7 -> V
  const camRest = cameraAt(B2.camMoveEnd);
  const restXY = wallPointForScreen(camRest, CAPSULE_REST.sx, CAPSULE_REST.sy, CAPSULE_REST.z);
  const REST = {x: restXY.x, y: restXY.y, z: CAPSULE_REST.z};
  const bandW = surfaceWorld(PLACES0.M, PLACES0.M.w / 2, PLACES0.M.h - BAND_BOTTOM - BAND_H / 2, CAPSULE_LIFT);
  const tileW = anchorWorld('pm-tile', 40);
  const vRowW = surfaceWorld(PV, PV.w * 0.5, V_HEADER + V_ROW * 1.5, 24);
  const capAt = (ff: number) => {
    const camF = ff === f ? cam : cameraAt(ff);
    const sPlace = places.S;
    const sPark = surfaceWorld(sPlace, sPlace.w * 0.55, -30, 60);
    const srcW = anchorWorld('s-source', 30);
    let w = bandW;
    let travel = 0;
    let absorb = 0;
    let visible = false;
    let screen: P2 | undefined;
    let wide = 0;
    let outA = 0; // fade into the V row
    if (ff >= B2.capsuleForm - 2 && ff < B3.absorb.end) {
      visible = true;
      const mp = EASE.inout(prog(ff, B2.capsuleMoveStart, B2.capsuleMoveEnd - B2.capsuleMoveStart));
      if (ff >= B2.capsuleMoveStart) w = mix3(bandW, REST, mp);
      const ap = prog(ff, B3.absorb.start, B3.absorb.end - B3.absorb.start);
      if (ff >= B3.absorb.start && tileW) {
        w = mix3(REST, tileW, EASE.in(ap));
        absorb = EASE.in(ap);
        travel = Math.sin(Math.PI * ap) * 0.9;
      } else if (ff >= B2.capsuleMoveStart && ff < B2.capsuleMoveEnd) travel = Math.sin(Math.PI * prog(ff, B2.capsuleMoveStart, B2.capsuleMoveEnd - B2.capsuleMoveStart));
    } else if (ff >= (teaser ? B6.capsuleBack.end - 20 : B6.capsuleOut.start) && ff < B7.vGrow.start + 8) {
      visible = true;
      const eo = EASE.out(prog(ff, B6.capsuleOut.start, B6.capsuleOut.end - B6.capsuleOut.start));
      if (ff < B6.capsuleToS.start) {
        w = tileW ? mix3(tileW, bandW, eo) : bandW;
        absorb = 1 - eo;
        travel = Math.sin(Math.PI * eo) * 0.8;
      } else if (ff < B6.capsuleToS.end) {
        const t = EASE.inout(prog(ff, B6.capsuleToS.start, B6.capsuleToS.end - B6.capsuleToS.start));
        w = mix3(bandW, sPark, t);
        travel = Math.sin(Math.PI * t);
      } else if (ff < B6.reverse.start - 15) {
        w = sPark;
      } else if (ff < B6.reverse.start) {
        const t = EASE.inout(prog(ff, B6.reverse.start - 15, 15));
        w = srcW ? mix3(sPark, srcW, t) : sPark;
        travel = Math.sin(Math.PI * t) * 0.6;
      } else if (ff < B6.reverse.end && reverse) {
        const hd = clamp01(reverse.head);
        screen = bez(reverse.p0, reverse.p1, reverse.p2, reverse.p3, hd);
        const ahead = bez(reverse.p0, reverse.p1, reverse.p2, reverse.p3, clamp01(hd + 0.02));
        void ahead;
        travel = 0.7 * Math.sin(Math.PI * clamp01(hd));
      } else if (ff < B6.capsuleBack.end) {
        const t = EASE.out(prog(ff, B6.reverse.end, B6.capsuleBack.end - B6.reverse.end));
        w = tileW ? mix3(tileW, bandW, t) : bandW;
        travel = Math.sin(Math.PI * t) * 0.6;
      } else if (ff < B7.capsuleToV.start) {
        w = bandW;
      } else if (ff < B7.capsuleToV.end) {
        const t = EASE.inout(prog(ff, B7.capsuleToV.start, B7.capsuleToV.end - B7.capsuleToV.start));
        w = mix3(bandW, vRowW, t);
        w = {...w, y: w.y - 50 * Math.sin(Math.PI * t)};
        travel = Math.sin(Math.PI * t);
      } else {
        w = vRowW;
        wide = EASE.out(prog(ff, B7.vGrow.start, 6));
        outA = prog(ff, B7.vGrow.start + 2, 4);
      }
    }
    const pr = screen ? {x: screen.x, y: screen.y, k: camF.s * (PERSPECTIVE / (PERSPECTIVE - 30)) * 1.0} : projectWorld(camF, w);
    return {x: pr.x, y: pr.y, k: pr.k, travel, absorb, visible, wide, outA};
  };
  const cNow = capAt(f);
  const cPrev = capAt(f - 1);
  const capAngle = (Math.atan2(cNow.y - cPrev.y, cNow.x - cPrev.x) * 180) / Math.PI;
  const resting = (f >= B2.capsuleMoveEnd && f < B3.absorb.start) || (f >= B6.capsuleToS.end && f < B6.reverse.start - 15) || (f >= B6.capsuleBack.end && f < B7.capsuleToV.start);
  const bob = resting ? Math.sin((2 * Math.PI * f) / (2 * BEAT)) * 4 : 0;
  const capAppear = teaser ? (f >= B6.capsuleBack.end - 20 ? eased(f, B6.capsuleBack.end - 20, 14) : capsuleAppearAt(f)) : f >= B6.capsuleOut.start ? 1 : capsuleAppearAt(f);
  const capShimmer = resting ? (((f - B2.capsuleMoveEnd) % 60) / 60) / 0.5 : 0;
  const capDate = f >= (teaser ? B6.capsuleBack.end - 20 : B6.capsuleOut.start) ? capsuleDateAt(f) : undefined;
  const capOpacity = 1 - cNow.outA;
  const capGlowNow = cNow.visible ? (f < B3.absorb.end ? capGlow : 0.55) * (1 - cNow.outA) * (1 - cNow.absorb) : 0;

  // ------------------------------------------------ B2 dashed lines
  const dashTargets: {id: string; side: Side}[] = [
    {id: 'd-ring', side: 'left'},
    {id: 's-ask', side: 'left'},
    {id: 'doc-ad', side: 'left'},
  ];
  const fd = teaser ? f + 16 : f; // teaser: the lines start breaking sooner so the very first frames already show the break
  const dashes = B2.dashed.map((start, i) => {
    const tgt = pt(dashTargets[i].id, dashTargets[i].side);
    const grow = eased(fd, start, B2.dashGrow, EASE.out);
    const fall = EASE.in(prog(fd, start + B2.dashGrow + B2.dashHang, B2.dashFall));
    if (!tgt || grow <= 0 || fall >= 1 || f > B3.absorb.start) return null;
    const from = {x: cNow.x, y: cNow.y + bob};
    const dx = tgt.x - from.x;
    const dy = tgt.y - from.y;
    const sag = i === 2 ? -40 : 40;
    return {key: `dash${i}`, from, to: tgt, c1: {x: from.x + dx * 0.35, y: from.y + dy * 0.05 + sag}, c2: {x: from.x + dx * 0.75, y: tgt.y - dy * 0.25 + sag}, grow, fall};
  });

  // ------------------------------------------------ threads: B3 branches, B4 scan, B5 -> A
  type Br = {k: string; from: string; fromSide?: Side; fy?: number; dx?: number; to: string; t: {start: number; end: number}; c1: [number, number]; c2: [number, number]; w: [number, number]};
  const branches: Br[] = [
    {k: 'D', from: 'pm-tile', fromSide: 'right', fy: THREAD_ROUTES.D.fy, dx: THREAD_ROUTES.D.dx, to: 'comment-pin', t: B3.threadD, c1: THREAD_ROUTES.D.c1, c2: THREAD_ROUTES.D.c2, w: THREAD_ROUTES.D.w},
    {k: 'S', from: 'pm-tile', fromSide: 'right', fy: THREAD_ROUTES.S.fy, dx: THREAD_ROUTES.S.dx, to: 'pm-reply', t: B3.threadS, c1: THREAD_ROUTES.S.c1, c2: THREAD_ROUTES.S.c2, w: THREAD_ROUTES.S.w},
    {k: 'A', from: 'pm-tile', fromSide: 'right', fy: THREAD_ROUTES.A.fy, dx: THREAD_ROUTES.A.dx, to: 'slot-brief', t: B3.threadA, c1: THREAD_ROUTES.A.c1, c2: THREAD_ROUTES.A.c2, w: THREAD_ROUTES.A.w},
    {k: 'scan', from: 'pm-tile', fromSide: 'right', fy: 0.82, dx: 6, to: 'doc-ad', t: B4.scan, c1: [90, 150], c2: [-120, -70], w: [11, 8]},
    {k: 'B5A', from: 's-card', fromSide: 'right', fy: 0.5, dx: 4, to: 'slot-brief', t: B5.threadA, c1: [160, -90], c2: [-220, 40], w: [12, 8]},
  ];
  const glow = teaser ? 0 : glowAt(f);
  const tFade = threadFadeAt(f);
  const threads = branches.flatMap((b, i) => {
    if (f < b.t.start || tFade <= 0.003) return [];
    const st = pt(b.from, b.fromSide, b.fy);
    const en = pt(b.to);
    if (!st || !en) return [];
    const {head, body, dock} = threadAt(b.t, f);
    const p0 = {x: st.x + (b.dx ?? 0) * camRatio, y: st.y};
    return [{k: b.k, i, p0, p1: {x: p0.x + b.c1[0] * camRatio, y: p0.y + b.c1[1] * camRatio}, p2: {x: en.x + b.c2[0] * camRatio, y: en.y + b.c2[1] * camRatio}, p3: en, head, body, dock, w: b.w}];
  });
  const scanTip = threads.find((t) => t.k === 'scan');

  // ------------------------------------------------ afterglow (B3-B6 threads remain) and the closing convergence
  const agAlpha = afterglowAt(f);
  const conv = EASE.inout(prog(f, C.converge.start, C.converge.end - C.converge.start));
  const LINE = {p0: {x: WM.x0, y: WM.lineY}, p1: {x: WM.x0 + 200, y: WM.lineY}, p2: {x: WM.x1 - 200, y: WM.lineY}, p3: {x: WM.x1, y: WM.lineY}};
  const agMap: Record<string, string> = {'pm-reply': 'pm-answer'};
  const agCurves =
    agAlpha > 0.003 && f < C.converge.end + 2
      ? AFTERGLOW_ROUTES.flatMap((r) => {
          const fromId = agMap[r.from] ?? r.from;
          const toId = agMap[r.to] ?? r.to;
          const from = pt(fromId, r.fromSide, r.fy);
          const to = pt(toId, r.toSide);
          if (!from || !to) return [];
          const c1 = {x: from.x + r.c1[0], y: from.y + r.c1[1]};
          const c2 = {x: to.x + r.c2[0], y: to.y + r.c2[1]};
          return [{k: `${r.from}>${r.to}`, p0: lerp2(from, LINE.p0, conv), p1: lerp2(c1, LINE.p1, conv), p2: lerp2(c2, LINE.p2, conv), p3: lerp2(to, LINE.p3, conv), w: [lerp(r.w?.[0] ?? 9, 8, conv), lerp(r.w?.[1] ?? 7, 8, conv)], occ: conv < 0.5 ? occ(surfOf(fromId), surfOf(toId)) : undefined}];
        })
      : [];

  // ------------------------------------------------ B7 hairline source lines
  const sources =
    f >= B7.sources.start
      ? SOURCE_ROUTES.flatMap((r, i) => {
          const from = pt(r.from, r.fromSide ?? 'left');
          const to = pt(r.to, r.toSide);
          if (!from || !to) return [];
          const p = EASE.out(prog(f, B7.sources.start + i * B7.sources.stagger, B7.sources.dur));
          return [{k: `${r.from}>${r.to}`, from, to, c1: {x: from.x + r.c1[0], y: from.y + r.c1[1]}, c2: {x: to.x + r.c2[0], y: to.y + r.c2[1]}, p, occ: occ(surfOf(r.from), surfOf(r.to))}];
        })
      : [];

  // ------------------------------------------------ headline
  const H = headlineAt(f);
  const swapped = f >= B3.swap.start;
  const B1w = WORDS.b1.map((text, i) => ({text, enter: H.b1.enter[i], exit: H.b1.exit}));
  const B2w = WORDS.b2.map((text, i) => ({text, enter: H.b2.enter[i], exit: H.b2.exit[i], hidden: i === 0 && swapped}));
  const b3Exit = H.b3.exit;
  const handoff = f >= B3.headline.settle;
  const B3w = WORDS.b3.map((text, i) => ({text, accent: i < 2, enter: H.b3.enter[i], exit: b3Exit, hidden: i === 2 && !handoff}));
  const simple = (ws: string[], h: {enter: number[]; exit: number}, hide = false) => ws.map((text, i) => ({text, enter: hide ? 0 : h.enter[i], exit: hide ? 0 : h.exit}));
  // the travelling word: "맥락은" glides from the B2 line to its slot in the B3 line, then 은 -> 을
  const gl = EASE.inout(prog(f, B3.swap.start, B3.wordGlide));
  const showTraveler = swapped && !handoff && rects.b2 && rects.b3;
  const trav = rects.b2 && rects.b3 ? {x: lerp(B2_BOX.left + rects.b2[0].x, HEADLINE_BOX_V6.left + rects.b3[2].x, gl), y: lerp(B2_BOX.top + rects.b2[0].y, HEADLINE_BOX_V6.top + rects.b3[2].y, gl), fs: lerp(B2_BOX.fontSize, HEAD.fontSize, gl)} : undefined;
  const mc = morphAt(f, B3.swap.morph);
  const mOutCh = mc.out;
  const mInCh = f < mc.inStart ? 0 : sp(f, mc.inStart, SPR.soft);

  // ------------------------------------------------ closing: wordmark, underline, lockup, caption
  const cl = H.c;
  const wmLand = cl.wordmark;
  const wmTrack = lerp(0.34, -0.02, wmLand); // em
  const lineA = f >= C.converge.end ? 1 : 0;
  const ulE = EASE.out(prog(f, C.underline.start, C.underline.end - C.underline.start));
  const lockE = EASE.out(prog(f, C.lockup.start, C.lockup.end - C.lockup.start));
  const capE = eased(f, C.caption, 12);
  const veilF = teaser ? tfRaw - 318 + (C.headline.reveal - 14 - 0) : f; // teaser: the vignette follows the teaser clock, not the fast-forwarded source
  const veil = eased(veilF, C.headline.reveal - 14, 22) * 0.8;
  const wmPulse = f >= C.headline.land ? Math.max(0, 1 - (f - C.headline.land) / 18) : 0;

  return (
    <FilmProvider value={film}>
      <AbsoluteFill ref={rootRef} style={{background: LOOK0.stageColor}}>
        <WorldStage
          frame={f}
          look={look}
          places={places as unknown as Record<SurfaceId, SurfacePlacement>}
          poolAmt={poolAmt}
          evenAmt={evenA}
          surfaces={present.map((id) => {
            const p = places[id];
            const Body = BODY[id];
            const enterDark = id === 'S' ? 0 : (1 - p.e) * 1.5;
            return (
              <SurfaceFrame
                key={id}
                place={p}
                look={look}
                fontFloor={lerp(FONT_FLOOR0[id], FONT_FLOOR7[id], b7a)}
                aerial={id === 'A' && look.agentBody ? 0 : (0 - p.z) / (0 - FAR_Z)}
                label={id}
                dark={id === 'A'}
                blur={blurOf(id)}
                dim={id !== 'S' || rec > 0}
                dimAmt={Math.max(id === 'P' ? dimP : 0, enterDark, 1.25 * rec)}
                litEdge={id === 'V' ? 0 : LOOK0.litEdge! * litAmt[id as Id] * (1 - evenA)}
                theme={{state: id === 'V' ? 'B7' : 'B1'}}
              >
                <Body />
              </SurfaceFrame>
            );
          })}
          overlay={
            <>
              {/* closing: a soft stage vignette keeps the headline readable over the lit surfaces */}
              {veil > 0.003 && <div style={{position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 62% 52% at 50% 46%, rgba(14,19,17,1), rgba(14,19,17,0) 100%)', opacity: veil, pointerEvents: 'none'}} />}
              {/* capsule light: the only light source in B2 */}
              {cNow.visible && capGlowNow > 0 && (
                <div style={{position: 'absolute', left: cNow.x - 420 * cNow.k, top: cNow.y + bob - 300 * cNow.k, width: 840 * cNow.k, height: 600 * cNow.k, borderRadius: '50%', background: 'radial-gradient(closest-side, rgba(143,213,179,.34), rgba(76,141,246,.12) 55%, rgba(0,0,0,0))', opacity: capGlowNow * capAppear, pointerEvents: 'none'}} />
              )}
              {agCurves.map((c, i) => (
                <Thread key={c.k} p0={c.p0} p1={c.p1} p2={c.p2} p3={c.p3} gradientId={`ag${i}`} w0={c.w[0]} w1={c.w[1]} alpha={Math.min(1, agAlpha)} halo={0} shadowColor="rgba(0,0,0,.3)" caps={false} occluders={c.occ} />
              ))}
              {lineA > 0 && f < C.underline.start + 1 && <Underline x0={WM.x0} x1={WM.x1} y={WM.lineY} th={8} alpha={1} glow={0} />}
              {f >= C.underline.start && <Underline x0={WM.x0} x1={WM.x1} y={WM.lineY} th={lerp(8, 12, ulE)} alpha={1} glow={Math.max(wmPulse, ulE * (0.32 + 0.18 * Math.sin((2 * Math.PI * (f - C.headline.land)) / (4 * BEAT))))} sh={f >= C.lockup.start ? (((f - C.lockup.start) % (4 * BEAT)) / (4 * BEAT)) * 1.6 : 2} />}
              {dashes.map((d) => d && <DashBreak key={d.key} from={d.from} to={d.to} c1={d.c1} c2={d.c2} grow={d.grow} fall={d.fall} scale={camRatio} phase={f} />)}
              {threads.map((t) => (
                <ThreadDraw key={t.k} id={`th${t.i}`} p0={t.p0} p1={t.p1} p2={t.p2} p3={t.p3} head={t.head} body={t.body} w0={t.w[0]} w1={t.w[1]} glow={t.k === 'D' || t.k === 'S' || t.k === 'A' ? glow : 0} halo={LOOK0.halo! * Math.min(1, t.head * 3)} dock={t.dock} shadowColor={LOOK0.threadShadow} scale={camRatio} alpha={tFade} />
              ))}
              {scanTip && P_SCAN(film.P.scan, scanTip.p3)}
              {reverse && f < B6.reverse.end + 30 && (
                <ThreadDraw id="threv" p0={reverse.p0} p1={reverse.p1} p2={reverse.p2} p3={reverse.p3} head={reverse.head} body={reverse.body} w0={12} w1={9} halo={LOOK0.halo! * Math.min(1, reverse.head * 3) * (1 - eased(f, B6.reverse.end + 6, 20))} dock={reverse.dock} shadowColor={LOOK0.threadShadow} scale={camRatio} alpha={1 - eased(f, B6.reverse.end + 6, 20)} />
              )}
              {sources.map((s) => (
                <SourceDraw key={s.k} id={`src-${s.k}`} from={s.from} to={s.to} c1={s.c1} c2={s.c2} p={s.p} occluders={s.occ} alpha={0.6 * (1 - cl.out)} />
              ))}
              {cNow.visible && (
                <div style={{opacity: capOpacity}}>
                  <Capsule x={cNow.x} y={cNow.y + bob} scale={cNow.k} appear={capAppear} stretch={cNow.travel} angle={capAngle} absorb={cNow.absorb} shimmer={capShimmer > 0 && capShimmer < 1 ? capShimmer : 0} date={capDate} wide={cNow.wide} />
                </div>
              )}
              {/* headlines: B1 left, B2 centered block, B3 top-left ("맥락은" travels), B4 right, B5 lower left, B6 top center, B7 upper left, closing center -> wordmark */}
              <div style={{position: 'absolute', left: HEADLINE_BOX_V6.left, top: HEADLINE_BOX_V6.top, width: HEADLINE_BOX_V6.width}}>
                <RevealWords words={B1w} color={HEAD.color} accent={HEAD.accent} fontSize={HEAD.fontSize} width={HEADLINE_BOX_V6.width} />
              </div>
              <div style={{position: 'absolute', left: B2_BOX.left, top: B2_BOX.top, width: B2_BOX.width}}>
                <RevealWords words={B2w} color={HEAD.color} accent={HEAD.accent} fontSize={B2_BOX.fontSize} width={B2_BOX.width} justify="center" onRects={(r) => setRects((p) => ({...p, b2: r}))} />
              </div>
              <div style={{position: 'absolute', left: HEADLINE_BOX_V6.left, top: HEADLINE_BOX_V6.top, width: HEADLINE_BOX_V6.width}}>
                <RevealWords words={B3w} color={HEAD.color} accent={HEAD.accent} fontSize={HEAD.fontSize} width={HEADLINE_BOX_V6.width} onRects={(r) => setRects((p) => ({...p, b3: r}))} />
              </div>
              {showTraveler && trav && (
                <div style={{position: 'absolute', display: 'flex', left: trav.x, top: trav.y, fontFamily: FONT_FAMILY, fontWeight: 800, fontSize: trav.fs, lineHeight: 1.02, letterSpacing: '-0.035em', color: HEAD.color, whiteSpace: 'nowrap'}}>
                  <WordBox text="맥락" enter={1} exit={b3Exit} accentColor={HEAD.accent} style={{margin: 0}}>
                    맥락
                    <span style={{display: 'inline-block', position: 'relative'}}>
                      <span style={{display: 'inline-block', opacity: 1 - mOutCh, transform: `scale(${1 - 0.04 * mOutCh})`}}>은</span>
                      <span style={{position: 'absolute', left: 0, top: 0, opacity: Math.min(1, mInCh * 2), transform: `scale(${0.9 + 0.1 * Math.min(1, mInCh)})`}}>을</span>
                    </span>
                  </WordBox>
                </div>
              )}
              {([['b4', H.b4, HB.b4], ['b5', H.b5, HB.b5], ['b6', H.b6, HB.b6], ['b7', H.b7, HB.b7]] as const).map(([key, h, box]) => (
                <div key={key} style={{position: 'absolute', left: box.left, top: box.top, width: box.width}}>
                  <RevealWords words={simple(WORDS[key], h, teaser)} color={HEAD.color} accent={HEAD.accent} fontSize={box.size} width={box.width} justify={box.justify} />
                </div>
              ))}
              <div style={{position: 'absolute', left: HB.c.left, top: HB.c.top, width: HB.c.width}}>
                <RevealWords
                  words={simple(WORDS.c, {enter: cl.enter, exit: 0})}
                  color={HEAD.color}
                  accent={HEAD.accent}
                  fontSize={HB.c.size}
                  width={HB.c.width}
                  justify="center"
                  tracking={`${lerp(-0.035, -0.16, cl.squeeze)}em`}
                  opacity={1 - cl.out}
                />
              </div>
              {/* wordmark lands on the final hit; the converged thread is its underline */}
              {wmLand > 0.002 && (
                <div style={{position: 'absolute', left: 0, width: 1920, top: WM.cy - WM.size * 0.62, textAlign: 'center', fontFamily: FONT_FAMILY, fontWeight: 800, fontSize: WM.size, lineHeight: 1.2, letterSpacing: `${wmTrack}em`, color: HEAD.color, opacity: Math.min(1, wmLand * 3), transform: `scale(${0.97 + 0.03 * Math.min(1, wmLand)})`, paddingLeft: `${wmTrack > 0 ? 0 : 0}px`}}>
                  ensemble
                </div>
              )}
              {lockE > 0.002 && (
                <div style={{position: 'absolute', left: 0, width: 1920, top: WM.lineY + 26, height: 84, overflow: 'hidden', textAlign: 'center'}}>
                  <div style={{fontFamily: FONT_FAMILY, fontWeight: 700, fontSize: 56, letterSpacing: '0.03em', color: HEAD.accent, lineHeight: '84px', transform: `translateY(${(1 - lockE) * -100}%)`}}>PM Agent</div>
                </div>
              )}
              {capE > 0.002 && (
                <div style={{position: 'absolute', left: 0, width: 1920, top: 978, textAlign: 'center', fontFamily: FONT_FAMILY, fontWeight: 600, fontSize: 28, letterSpacing: '0.02em', color: 'rgba(227,233,229,.58)', opacity: capE}}>컨셉 영상 · 화면은 연출된 예시</div>
              )}
            </>
          }
        />
      </AbsoluteFill>
    </FilmProvider>
  );
};

/** B4: the scan thread reaches the ad row and a check pulse (amber ring) goes off there */
const P_SCAN = (scan: number, at: {x: number; y: number}) =>
  scan > 0.01 ? (
    <svg key="scan" style={{position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none'}} width={1920} height={1080}>
      <circle cx={at.x} cy={at.y} r={22 + 46 * (1 - scan)} fill="none" stroke="#F2C35C" strokeWidth={4} opacity={0.9 * scan} />
    </svg>
  ) : null;

/** the converged thread = the wordmark's underline */
const Underline: React.FC<{x0: number; x1: number; y: number; th: number; alpha: number; glow: number; sh?: number}> = ({x0, x1, y, th, alpha, glow, sh = 2}) => (
  <svg style={{position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', opacity: alpha}} width={1920} height={1080}>
    <defs>
      <linearGradient id="ul-g" gradientUnits="userSpaceOnUse" x1={x0} y1={y} x2={x1} y2={y}>
        <stop offset="0%" stopColor="#3DBE8B" />
        <stop offset="35%" stopColor="#4C8DF6" />
        <stop offset="65%" stopColor="#9B7BF7" />
        <stop offset="100%" stopColor="#F08BB4" />
      </linearGradient>
      <filter id="ul-b" filterUnits="userSpaceOnUse" x={x0 - 120} y={y - 120} width={x1 - x0 + 240} height={240}>
        <feGaussianBlur stdDeviation={16} />
      </filter>
    </defs>
    {glow > 0.01 && <rect x={x0} y={y - th * 1.5} width={x1 - x0} height={th * 3} rx={th * 1.5} fill="url(#ul-g)" opacity={0.55 * glow} filter="url(#ul-b)" />}
    <rect x={x0} y={y - th / 2} width={x1 - x0} height={th} rx={th / 2} fill="url(#ul-g)" />
    {sh <= 1 && (
      <>
        <defs>
          <linearGradient id="ul-s" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
            <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x={x0 + (x1 - x0 - 180) * sh} y={y - th / 2} width={180} height={th} rx={th / 2} fill="url(#ul-s)" />
      </>
    )}
  </svg>
);

/** music master clock + SFX at their event frames (sfx names / lengths from timing.json); outside the scene so motion-blur copies never duplicate audio */
const Sound: React.FC = () => (
  <>
    <Audio src={staticFile('audio/music-v5.wav')} volume={1} />
    {SFX_EVENTS.map((e, i) => (
      <Sequence key={`${e.name}-${i}`} from={e.frame} durationInFrames={e.frames ?? Math.ceil(sfxFile(e.name).durationSec * 30) + 2} layout="none" name={`sfx ${e.label}`}>
        <Audio src={staticFile(sfxFile(e.name).file)} volume={e.volume} />
      </Sequence>
    ))}
  </>
);

/** T-cam frames get camera motion blur (@remotion/motion-blur); everything else renders once */
const Film: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <>
      {camMoving(f) ? (
        <CameraMotionBlur shutterAngle={MOTION_BLUR.shutterAngle} samples={MOTION_BLUR.samples}>
          <Scene />
        </CameraMotionBlur>
      ) : (
        <Scene />
      )}
      <Sound />
    </>
  );
};

export const PitchV5: React.FC = () => {
  const [handle] = useState(() => delayRender('loading fonts (PitchV5)'));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all([ensurePretendardLoaded(), ensurePretendardVariableLoaded()])
      .then(() => {
        setReady(true);
        continueRender(handle);
      })
      .catch((err) => {
        console.error(err);
        continueRender(handle);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!ready) return <AbsoluteFill style={{backgroundColor: LOOK0.stageColor}} />;
  return <Film />;
};

export const PITCH_V5_FRAMES = TOTAL_FRAMES;
