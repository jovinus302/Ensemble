// v5 pitch film (storyboard-v5.md), full length 1680f. Stage 1: B1-B3 (f0-660)
// fully animated; later beats hold the B3 world (placeholder). Every value is a
// pure function of useCurrentFrame(); event frames come from ./timeline (which
// reads public/audio/timing.json through ./timing). The scene is the approved TA
// style-frame world: same config, WorldStage, SurfaceFrame and surface bodies, with
// the film animation context (surfaces/film.tsx) feeding the bodies.
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {AbsoluteFill, Audio, Sequence, continueRender, delayRender, staticFile, useCurrentFrame} from 'remotion';
import {ensurePretendardLoaded, ensurePretendardVariableLoaded, FONT_FAMILY} from '../tokens/fonts';
import {COPY, HEADLINE_BOX_V6, MIN_SCREEN_TEXT_PX, THREAD_ROUTES, placementsFor, themeLook} from './config';
import type {SurfaceId} from './config';
import {TOTAL_FRAMES} from './timing';
import {B1, B2, B3, SFX_EVENTS, sfxFile} from './timeline';
import {C0, cameraAt, camMoving} from './camera';
import {CameraMotionBlur} from '@remotion/motion-blur';
import {BEAT, EASE, SPR, clamp01, eased, lerp, prog, sp} from './anim';
import {capGlowAt, capsuleAppearAt, dimPAt, dofAAt, filmAnimAt, glowAt, headlineAt, litAt, morphAt, threadAt} from './filmAnim';
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
import {FilmProvider} from './surfaces/film';
import type {FilmAnim} from './surfaces/film';
import {ThreadDraw} from './fx/ThreadDraw';
import {DashBreak} from './fx/DashBreak';
import {Capsule} from './fx/Capsule';
import {RevealWords, WordBox} from './type/HeadlineFilm';
import {AGENT} from './content';

type Id = Exclude<SurfaceId, 'V'>;
const IDS: Id[] = ['M', 'D', 'S', 'P', 'A'];
const BODY: Record<Id, React.FC> = {M: Meeting, D: Canvas, S: Messenger, P: Doc, A: AgentTerminal};

// ------------------------------------------------------------------ static scene (TA look)
const LOOK0 = themeLook('TA', 'B1f140').look; // camera C0, dof {A: 3, P: 2.5}
const PLACES0 = placementsFor(LOOK0) as Record<Id, SurfacePlacement>;
const FAR_Z = Math.min(...IDS.map((i) => PLACES0[i].z));
const FONT_FLOOR: Record<Id, number> = Object.fromEntries(IDS.map((i) => [i, Math.ceil((MIN_SCREEN_TEXT_PX + 0.6) / surfaceScreenScale(C0, PLACES0[i]))])) as Record<Id, number>;
const HEAD = LOOK0.headline!;
const GROUP_C = {x: IDS.reduce((a, i) => a + PLACES0[i].x, 0) / IDS.length, y: IDS.reduce((a, i) => a + PLACES0[i].y, 0) / IDS.length};

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

type Anchor = {surface: Id; u: number; v: number; w: number; h: number};
type Side = 'left' | 'right' | 'top' | 'bottom';
const ANCHOR_SIDE: Record<string, Side> = {'pm-tile': 'right', 'comment-pin': 'left', 'pm-reply': 'left', 'slot-brief': 'left', 'd-ring': 'left', 's-ask': 'left', 'doc-ad': 'left'};
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
const bell = (frame: number, center: number, half: number) => {
  const x = (frame - center) / half;
  return Math.abs(x) >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * x);
};
const mix3 = (a: {x: number; y: number; z: number}, b: {x: number; y: number; z: number}, t: number) => ({x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t)});

const WORDS = {
  b1: COPY.B1.split(' '),
  b2: COPY.B2.split(' '),
  b3: COPY.B3.split(' '), // PM Agent가 맥락을 잇는다 -> [PM, Agent가, 맥락을, 잇는다]
};
const B2_BOX = {left: 112, top: 150, width: 760, fontSize: 108};

const stage = {
  placements(frame: number): Record<Id, SurfacePlacement & {e: number}> {
    const spr = EASE.inout(prog(frame, B2.spread.start, B2.spread.end - B2.spread.start)) * (1 - EASE.out(prog(frame, B3.spreadBack.start, B3.spreadBack.end - B3.spreadBack.start)));
    const out = {} as Record<Id, SurfacePlacement & {e: number}>;
    for (const id of IDS) {
      const b = PLACES0[id];
      let e = 1;
      let pl: SurfacePlacement = {...b};
      if (id !== 'S') {
        const from = ENTER_FROM[id];
        e = EASE.out(prog(frame, B1.enter[id], B1.enterDur));
        pl = {...b, x: b.x + from.dx * (1 - e), y: b.y + from.dy * (1 - e) - 90 * Math.sin(Math.PI * e) * (1 - e), z: b.z + from.dz * (1 - e), yaw: b.yaw + from.yaw * (1 - e), sc: 0.3 + 0.7 * e};
      }
      const dx = b.x - GROUP_C.x;
      const dy = b.y - GROUP_C.y;
      const len = Math.hypot(dx, dy) || 1;
      pl = {...pl, x: pl.x + (dx / len) * B2.spread.px * spr, y: pl.y + (dy / len) * B2.spread.px * spr};
      out[id] = {...pl, e};
    }
    return out;
  },
};

// ------------------------------------------------------------------ the film
const Scene: React.FC = () => {
  const f = useCurrentFrame();
  const rootRef = useRef<HTMLDivElement>(null);
  const cam = cameraAt(f);
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
      let surface: Id | undefined;
      while (e) {
        if (e.dataset.surface) {
          surface = e.dataset.surface as Id;
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

  const places = stage.placements(f);
  const look = {...LOOK0, camera: cam};

  // ------------------------------------------------ light / dof amounts
  const capGlow = capGlowAt(f);
  const litAmt: Record<Id, number> = litAt(f);
  const poolAmt: PoolAmt = Object.fromEntries(IDS.map((id) => [id, {lit: litAmt[id], vis: id === 'S' ? 1 : clamp01((places[id].e - 0.45) / 0.55)}])) as PoolAmt;
  const dimP = dimPAt(f);
  const dofA = dofAAt(f, LOOK0.dof!.A!);
  const blurOf = (id: Id) => (id === 'A' ? dofA : id === 'P' ? LOOK0.dof!.P! : 0);
  const film = filmAnimAt(f);

  // ------------------------------------------------ projections for overlay elements
  const pt = (id: string, side?: Side, fy = 0.5) => {
    const a = anchors[id];
    if (!a) return undefined;
    const sd = side ?? ANCHOR_SIDE[id] ?? 'left';
    const x = sd === 'right' ? a.u + a.w + 6 : sd === 'left' ? a.u - 10 : a.u + a.w / 2;
    const y = sd === 'bottom' ? a.v + a.h + 10 : sd === 'top' ? a.v - 10 : a.v + a.h * fy;
    return projectSurfacePoint(cam, places[a.surface], x, y, THREAD_LIFT);
  };
  const anchorWorld = (id: string, lift = CAPSULE_LIFT) => {
    const a = anchors[id];
    return a ? surfaceWorld(places[a.surface], a.u + a.w / 2, a.v + a.h / 2, lift) : undefined;
  };

  // ------------------------------------------------ capsule (world path -> screen)
  const camRest = cameraAt(B2.camMoveEnd);
  const restXY = wallPointForScreen(camRest, CAPSULE_REST.sx, CAPSULE_REST.sy, CAPSULE_REST.z);
  const REST = {x: restXY.x, y: restXY.y, z: CAPSULE_REST.z};
  const bandW = surfaceWorld(PLACES0.M, PLACES0.M.w / 2, PLACES0.M.h - BAND_BOTTOM - BAND_H / 2, CAPSULE_LIFT);
  const tileW = anchorWorld('pm-tile', 40);
  let capW = bandW;
  let travel = 0;
  const moveP = EASE.inout(prog(f, B2.capsuleMoveStart, B2.capsuleMoveEnd - B2.capsuleMoveStart));
  if (f >= B2.capsuleMoveStart) capW = mix3(bandW, REST, moveP);
  const absP = prog(f, B3.absorb.start, B3.absorb.end - B3.absorb.start);
  const absE = EASE.in(absP);
  if (f >= B3.absorb.start && tileW) capW = mix3(REST, tileW, absE);
  if (f >= B2.capsuleMoveStart && f < B2.capsuleMoveEnd) travel = Math.sin(Math.PI * prog(f, B2.capsuleMoveStart, B2.capsuleMoveEnd - B2.capsuleMoveStart));
  if (f >= B3.absorb.start) travel = Math.sin(Math.PI * absP) * 0.9;
  const capNow = projectWorld(cam, capW);
  const capPrev = projectWorld(cameraAt(f - 1), f >= B3.absorb.start && tileW ? mix3(REST, tileW, EASE.in(prog(f - 1, B3.absorb.start, B3.absorb.end - B3.absorb.start))) : f - 1 >= B2.capsuleMoveStart ? mix3(bandW, REST, EASE.inout(prog(f - 1, B2.capsuleMoveStart, B2.capsuleMoveEnd - B2.capsuleMoveStart))) : bandW);
  const capAngle = (Math.atan2(capNow.y - capPrev.y, capNow.x - capPrev.x) * 180) / Math.PI;
  const resting = f >= B2.capsuleMoveEnd && f < B3.absorb.start;
  const bob = resting ? Math.sin((2 * Math.PI * f) / (2 * BEAT)) * 4 : 0;
  const capAppear = capsuleAppearAt(f);
  const capShimmer = resting ? ((f - B2.capsuleMoveEnd) % 60) / 60 / 0.5 : 0;
  const capVisible = f >= B2.capsuleForm - 2 && f < B3.absorb.end;

  // ------------------------------------------------ B2 dashed lines
  const dashTargets: {id: string; side: Side}[] = [
    {id: 'd-ring', side: 'left'},
    {id: 's-ask', side: 'left'},
    {id: 'doc-ad', side: 'left'},
  ];
  const dashes = B2.dashed.map((start, i) => {
    const tgt = pt(dashTargets[i].id, dashTargets[i].side);
    const grow = eased(f, start, B2.dashGrow, EASE.out);
    const fall = EASE.in(prog(f, start + B2.dashGrow + B2.dashHang, B2.dashFall));
    if (!tgt || grow <= 0 || fall >= 1) return null;
    const from = {x: capNow.x, y: capNow.y + bob};
    const dx = tgt.x - from.x;
    const dy = tgt.y - from.y;
    const sag = i === 2 ? -40 : 40;
    return {key: `dash${i}`, from, to: tgt, c1: {x: from.x + dx * 0.35, y: from.y + dy * 0.05 + sag}, c2: {x: from.x + dx * 0.75, y: tgt.y - dy * 0.25 + sag}, grow, fall};
  });

  // ------------------------------------------------ B3 threads
  type Br = {k: 'D' | 'S' | 'A'; anchor: string; t: {start: number; end: number}};
  const branches: Br[] = [
    {k: 'D', anchor: 'comment-pin', t: B3.threadD},
    {k: 'S', anchor: 'pm-reply', t: B3.threadS},
    {k: 'A', anchor: 'slot-brief', t: B3.threadA},
  ];
  const glow = glowAt(f);
  const threads = branches.flatMap((b, i) => {
    const r = THREAD_ROUTES[b.k];
    const st = pt('pm-tile', 'right', r.fy);
    const en = pt(b.anchor);
    if (!st || !en || f < b.t.start) return [];
    const {head, body, dock} = threadAt(b.t, f);
    const p0 = {x: st.x + r.dx * camRatio, y: st.y};
    return [{k: b.k, i, p0, p1: {x: p0.x + r.c1[0] * camRatio, y: p0.y + r.c1[1] * camRatio}, p2: {x: en.x + r.c2[0] * camRatio, y: en.y + r.c2[1] * camRatio}, p3: en, head, body, dock, w: r.w}];
  });

  // ------------------------------------------------ headline
  const H = headlineAt(f);
  const swapped = f >= B3.swap.start;
  const B1w = WORDS.b1.map((text, i) => ({text, enter: H.b1.enter[i], exit: H.b1.exit}));
  const B2w = WORDS.b2.map((text, i) => ({text, enter: H.b2.enter[i], exit: H.b2.exit[i], hidden: i === 0 && swapped}));
  const b3Exit = H.b3.exit;
  const handoff = f >= B3.headline.settle;
  const B3w = WORDS.b3.map((text, i) => ({text, accent: i < 2, enter: H.b3.enter[i], exit: b3Exit, hidden: i === 2 && !handoff}));
  // the travelling word: "맥락은" glides from the B2 line to its slot in the B3 line, then 은 -> 을
  const gl = EASE.inout(prog(f, B3.swap.start, B3.wordGlide));
  const showTraveler = swapped && !handoff && rects.b2 && rects.b3;
  const trav = rects.b2 && rects.b3 ? {x: lerp(B2_BOX.left + rects.b2[0].x, HEADLINE_BOX_V6.left + rects.b3[2].x, gl), y: lerp(B2_BOX.top + rects.b2[0].y, HEADLINE_BOX_V6.top + rects.b3[2].y, gl), fs: lerp(B2_BOX.fontSize, HEAD.fontSize, gl)} : undefined;
  const mc = morphAt(f, B3.swap.morph);
  const mOutCh = mc.out;
  const mInCh = f < mc.inStart ? 0 : sp(f, mc.inStart, SPR.soft);

  const geoFor = (id: Id) => ({floor: FONT_FLOOR[id]});

  return (
    <FilmProvider value={film}>
      <AbsoluteFill ref={rootRef} style={{background: LOOK0.stageColor}}>
        <WorldStage
          frame={f}
          look={look}
          places={places as unknown as Record<SurfaceId, SurfacePlacement>}
          poolAmt={poolAmt}
          surfaces={IDS.map((id) => {
            const p = places[id];
            if (id !== 'S' && f < B1.enter[id]) return null;
            const Body = BODY[id];
            return (
              <SurfaceFrame
                key={id}
                place={p}
                look={look}
                fontFloor={geoFor(id).floor}
                aerial={id === 'A' && look.agentBody ? 0 : (0 - p.z) / (0 - FAR_Z)}
                label={id}
                dark={id === 'A'}
                blur={blurOf(id)}
                dim={id !== 'S'}
                dimAmt={Math.max(id === 'P' ? dimP : 0, id === 'S' ? 0 : (1 - places[id].e) * 1.5)}
                litEdge={LOOK0.litEdge! * litAmt[id]}
                theme={{state: 'B1'}}
              >
                <Body />
              </SurfaceFrame>
            );
          })}
          overlay={
            <>
              {/* capsule light: the only light source in B2 */}
              {capVisible && capGlow > 0 && (
                <div style={{position: 'absolute', left: capNow.x - 420 * capNow.k, top: capNow.y + bob - 300 * capNow.k, width: 840 * capNow.k, height: 600 * capNow.k, borderRadius: '50%', background: 'radial-gradient(closest-side, rgba(143,213,179,.34), rgba(76,141,246,.12) 55%, rgba(0,0,0,0))', opacity: capGlow * capAppear, pointerEvents: 'none'}} />
              )}
              {dashes.map((d) => d && <DashBreak key={d.key} from={d.from} to={d.to} c1={d.c1} c2={d.c2} grow={d.grow} fall={d.fall} scale={camRatio} phase={f} />)}
              {threads.map((t) => (
                <ThreadDraw key={t.k} id={`th${t.i}`} p0={t.p0} p1={t.p1} p2={t.p2} p3={t.p3} head={t.head} body={t.body} w0={t.w[0]} w1={t.w[1]} glow={glow} halo={LOOK0.halo! * Math.min(1, t.head * 3)} dock={t.dock} shadowColor={LOOK0.threadShadow} scale={camRatio} />
              ))}
              {capVisible && <Capsule x={capNow.x} y={capNow.y + bob} scale={capNow.k} appear={capAppear} stretch={travel} angle={capAngle} absorb={f >= B3.absorb.start ? absE : 0} shimmer={capShimmer > 0 && capShimmer < 1 ? capShimmer : 0} />}
              {/* headlines: B1 left, B2 centered block, B3 top-left; "맥락은" travels between B2 and B3 */}
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
            </>
          }
        />
      </AbsoluteFill>
    </FilmProvider>
  );
};

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
