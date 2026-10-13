// v5 style frames. SF-A (storyboard-v5.md §5): B1 f140 composition in three world
// options (A1 clay / A2 ceramic / A3 bold) via `still`. v6 themes (TA / TB / R,
// review/log-v6-theme.md): the same world under a theme + frame (B1f140 / B3f600),
// with the PM Agent thread, per-surface DOF, wall pools, headline variants.
// Props: still, theme, frame, headline, measure (log text sizes, anchors,
// headline/surface clearance, thread-over-face hits).
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {AbsoluteFill, continueRender, delayRender} from 'remotion';
import {ensurePretendardLoaded, ensurePretendardVariableLoaded} from '../tokens/fonts';
import {KineticHeadline} from '../v3/type/KineticHeadline';
import {TypeLayer} from '../v4/stage/StageV4';
import {AFTERGLOW_ROUTES, COPY, HEADLINE_BOX, HEADLINE_BOX_V6, LOOKS, MIN_SCREEN_TEXT_PX, SOURCE_ROUTES, THREAD_ROUTES, placementsFor, themeLook} from './config';
import type {FrameId, FrameSpec, StillId, SurfaceId, ThemeId, WorldLook} from './config';
import {beatStart} from './timing';
import {WorldStage} from './stage/WorldStage';
import {projectSurfacePoint, surfaceScreenBounds, surfaceScreenScale} from './stage/worldProject';
import {SurfaceFrame} from './surfaces/SurfaceFrame';
import {Messenger} from './surfaces/Messenger';
import {Canvas} from './surfaces/Canvas';
import {Meeting} from './surfaces/Meeting';
import {Doc} from './surfaces/Doc';
import {AgentTerminal} from './surfaces/AgentTerminal';
import {HeadlineV5} from './type/HeadlineV5';
import {SourceLine, Thread} from './fx/Thread';
import {ContextView} from './surfaces/ContextView';

export interface StyleFrameV5Props {
  still?: StillId; // SF-A world options (A1-A3)
  theme?: ThemeId; // v6 themes; takes precedence over `still`
  frame?: FrameId;
  headline?: boolean; // v6: show the frame's headline (canonical B3f600 has none; B1f140 default on)
  measure?: boolean;
}

// SF-A is B1 f140: beat start from timing.json + offset. The headline is fully in by then.
const SF_A_FRAME = beatStart('B1') + 140;
const HEADLINE_LOCAL_FRAME = 400; // KineticHeadline local frame: all words settled

const BODY: Record<SurfaceId, React.FC> = {M: Meeting, D: Canvas, S: Messenger, P: Doc, A: AgentTerminal, V: ContextView};
// paint hint only; real order comes from 3D depth sorting
const wordsOf = (copy: string) => copy.split(' ').map((text) => ({text}));

type Side = 'left' | 'right' | 'top' | 'bottom';
type Anchor = {surface: SurfaceId; u: number; v: number; w: number; h: number};
const THREAD_LIFT = 20;
const ANCHOR_SIDE: Record<string, Side> = {'pm-tile': 'right', 'comment-pin': 'left', 'pm-reply': 'left', 'slot-brief': 'left', 'doc-row': 'right'};
const BRANCH_ANCHOR = {D: 'comment-pin', S: 'pm-reply', A: 'slot-brief'} as const;

const inQuad = (pt: {x: number; y: number}, q: {x: number; y: number}[]) => {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    if (q[i].y > pt.y !== q[j].y > pt.y && pt.x < ((q[j].x - q[i].x) * (pt.y - q[i].y)) / (q[j].y - q[i].y) + q[i].x) inside = !inside;
  }
  return inside;
};

const Inner: React.FC<{look: WorldLook; label: string; spec?: FrameSpec; frame?: FrameId; showHeadline: boolean; measure?: boolean}> = ({look, label, spec, frame, showHeadline, measure}) => {
  const places = placementsFor(look);
  const headRef = useRef<HTMLDivElement>(null);
  const [anchors, setAnchors] = useState<Record<string, Anchor>>({});

  const geo = (Object.keys(places) as SurfaceId[]).map((id) => {
    const scale = surfaceScreenScale(look.camera, places[id]);
    return {id, scale, floor: Math.ceil((MIN_SCREEN_TEXT_PX + 0.6) / scale), bounds: surfaceScreenBounds(look.camera, places[id])};
  });
  const farZ = Math.min(...geo.map((g) => places[g.id].z));

  // anchors: layout-space offsets of [data-anchor] elements inside their surface, projected with projectSurfacePoint
  useLayoutEffect(() => {
    if (!spec?.thread && !spec?.afterglow) return;
    const out: Record<string, Anchor> = {};
    document.querySelectorAll<HTMLElement>('[data-anchor]').forEach((el) => {
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
    setAnchors(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label]);

  const pt = (id: string, side?: Side, fy = 0.5) => {
    const a = anchors[id];
    if (!a) return undefined;
    const sd = side ?? ANCHOR_SIDE[id] ?? 'left';
    // end caps stop just short of the target
    const x = sd === 'right' ? a.u + a.w + 6 : sd === 'left' ? a.u - 10 : a.u + a.w / 2;
    const y = sd === 'bottom' ? a.v + a.h + 10 : sd === 'top' ? a.v - 10 : a.v + a.h * fy;
    return projectSurfacePoint(look.camera, places[a.surface], x, y, THREAD_LIFT);
  };
  // faces in front of a hidden-behind line: every surface except the ones the line starts / ends on
  const occ = (...except: (SurfaceId | undefined)[]) =>
    (Object.keys(places) as SurfaceId[])
      .filter((id) => !except.includes(id))
      .map((id) => {
        const pl = places[id];
        return [projectSurfacePoint(look.camera, pl, 0, 0), projectSurfacePoint(look.camera, pl, pl.w, 0), projectSurfacePoint(look.camera, pl, pl.w, pl.h), projectSurfacePoint(look.camera, pl, 0, pl.h)].map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');
      });
  const surfOf = (id: string) => anchors[id]?.surface;
  type Curve = {k: string; occ?: string[]; from: {x: number; y: number}; to: {x: number; y: number}; c1: [number, number]; c2: [number, number]; w?: [number, number]};
  const branches: Curve[] =
    spec?.thread
      ? (['D', 'S', 'A'] as const).flatMap((k) => {
          const r = THREAD_ROUTES[k];
          const st = pt('pm-tile', 'right', r.fy);
          const start = st && {x: st.x + r.dx, y: st.y};
          const e = pt(BRANCH_ANCHOR[k]);
          if (!start || !e) return [];
          return [{k, from: start, to: e, c1: r.c1, c2: r.c2, w: r.w}];
        })
      : [];
  const afterglow: Curve[] = spec?.afterglow
    ? AFTERGLOW_ROUTES.flatMap((r) => {
        const from = pt(r.from, r.fromSide, r.fy);
        const to = pt(r.to, r.toSide);
        return from && to ? [{k: `${r.from}>${r.to}`, from, to, c1: r.c1, c2: r.c2, w: r.w, occ: occ(surfOf(r.from), surfOf(r.to))}] : [];
      })
    : [];
  const sources: Curve[] = spec?.sources
    ? SOURCE_ROUTES.flatMap((r) => {
        const from = pt(r.from, r.fromSide ?? 'left');
        const to = pt(r.to, r.toSide);
        return from && to ? [{k: `${r.from}>${r.to}`, from, to, c1: r.c1, c2: r.c2, occ: occ(surfOf(r.from), surfOf(r.to))}] : [];
      })
    : [];
  const cp = (c: Curve) => ({p0: c.from, p1: {x: c.from.x + c.c1[0], y: c.from.y + c.c1[1]}, p2: {x: c.to.x + c.c2[0], y: c.to.y + c.c2[1]}, p3: c.to});

  const threadFaceHits = () => {
    const hits: string[] = [];
    for (const b of [...branches, ...afterglow, ...sources]) {
      const p1 = {x: b.from.x + b.c1[0], y: b.from.y + b.c1[1]};
      const p2 = {x: b.to.x + b.c2[0], y: b.to.y + b.c2[1]};
      for (let i = 1; i < 100; i++) {
        const t = i / 100;
        const m = 1 - t;
        const q = {
          x: m * m * m * b.from.x + 3 * m * m * t * p1.x + 3 * m * t * t * p2.x + t * t * t * b.to.x,
          y: m * m * m * b.from.y + 3 * m * m * t * p1.y + 3 * m * t * t * p2.y + t * t * t * b.to.y,
        };
        if (Math.hypot(q.x - b.from.x, q.y - b.from.y) < 70 || Math.hypot(q.x - b.to.x, q.y - b.to.y) < 130) continue; // endpoints may touch their faces
        for (const g of geo) {
          const pl = places[g.id];
          const quad = [projectSurfacePoint(look.camera, pl, 0, 0), projectSurfacePoint(look.camera, pl, pl.w, 0), projectSurfacePoint(look.camera, pl, pl.w, pl.h), projectSurfacePoint(look.camera, pl, 0, pl.h)];
          if (inQuad(q, quad)) hits.push(`${b.k}>${g.id}@${t}`);
        }
      }
    }
    return hits;
  };

  useLayoutEffect(() => {
    if (!measure) return;
    const hb = (headRef.current?.firstElementChild as HTMLElement | null)?.getBoundingClientRect();
    const texts: {surface: string; text: string; px: number}[] = [];
    document.querySelectorAll<HTMLElement>('[data-surface]').forEach((el) => {
      const g = geo.find((x) => x.id === el.dataset.surface);
      if (!g) return;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = walker.nextNode())) {
        const t = n.textContent?.trim();
        const parent = n.parentElement;
        if (!t || !parent) continue;
        const fs = parseFloat(getComputedStyle(parent).fontSize);
        texts.push({surface: g.id, text: t, px: Math.round(fs * g.scale * 10) / 10});
      }
    });
    const small = texts.filter((t) => t.px < MIN_SCREEN_TEXT_PX);
    // eslint-disable-next-line no-console
    console.log(
      'V5-MEASURE ' +
        JSON.stringify({
          still: label,
          anchors: Object.fromEntries(Object.entries(anchors).map(([k, a]) => [k, {...a, scr: pt(k) && {x: Math.round(pt(k)!.x), y: Math.round(pt(k)!.y)}}])),
          threadOnFaces: threadFaceHits(),
          headline: hb && {x0: Math.round(hb.left), x1: Math.round(hb.right), y0: Math.round(hb.top), y1: Math.round(hb.bottom)},
          surfaces: geo.map((g) => ({id: g.id, quad: (() => { const pl = places[g.id]; return [[0, 0], [pl.w, 0], [pl.w, pl.h], [0, pl.h]].map(([u, v]) => { const q = projectSurfacePoint(look.camera, pl, u, v); return [Math.round(q.x), Math.round(q.y)]; }); })(), scale: +g.scale.toFixed(3), floor: g.floor, b: Object.fromEntries(Object.entries(g.bounds).map(([k, v]) => [k, Math.round(v)]))})),
          smallText: small,
        }),
    );
  }, [measure, label, anchors]);

  return (
    <WorldStage
      frame={SF_A_FRAME}
      look={look}
      lit={spec?.lit}
      even={spec?.evenLight}
      surfaces={geo.map((g) => {
        const Body = BODY[g.id];
        const p = places[g.id];
        const dimmed = !!spec?.dimmed.includes(g.id);
        return (
          <SurfaceFrame
            key={g.id}
            place={p}
            look={look}
            fontFloor={g.floor}
            aerial={g.id === 'A' && look.agentBody ? 0 : (0 - p.z) / (0 - farZ)}
            label={g.id}
            dark={g.id === 'A'}
            blur={dimmed ? look.dim?.blur : look.dof?.[g.id]}
            dim={dimmed}
            litEdge={spec?.litEdge && spec.lit.includes(g.id) ? look.litEdge : 0}
            theme={spec ? {state: spec.state, messengerCursor: spec.messengerCursor} : undefined}
          >
            <Body />
          </SurfaceFrame>
        );
      })}
      overlay={
        spec ? (
          <>
            {afterglow.map((b, i) => (
              <Thread key={b.k} {...cp(b)} gradientId={`ag${i}`} w0={b.w?.[0] ?? 9} w1={b.w?.[1] ?? 7} alpha={look.afterglow ?? 0.2} halo={0} shadowColor="rgba(0,0,0,.3)" caps={false} occluders={b.occ} />
            ))}
            {branches.map((b, i) => (
              <Thread key={b.k} {...cp(b)} gradientId={`th${i}`} w0={b.w?.[0]} w1={b.w?.[1]} glow={spec.glow} halo={look.halo ?? 0} shadowColor={look.threadShadow} />
            ))}
            {sources.map((b) => (
              <SourceLine key={b.k} id={`src-${b.k}`} occluders={b.occ} from={b.from} to={b.to} c1={cp(b).p1} c2={cp(b).p2} />
            ))}
            {showHeadline && look.headline && (
              <div ref={headRef} style={{position: 'absolute', left: HEADLINE_BOX_V6.left, top: HEADLINE_BOX_V6.top, width: HEADLINE_BOX_V6.width}}>
                <HeadlineV5
                  copy={frame === 'B7f1440' ? COPY.B7 : frame === 'B3f600' ? COPY.B3 : COPY.B1}
                  accentWords={frame === 'B3f600' ? 2 : 0}
                  color={look.headline.color}
                  accent={look.headline.accent}
                  fontSize={spec.headlineSize ?? look.headline.fontSize}
                  width={HEADLINE_BOX_V6.width}
                  cursor={spec.headlineCursor ? look.cursor : undefined}
                />
              </div>
            )}
          </>
        ) : (
          <TypeLayer>
            <div ref={headRef} style={{position: 'absolute', left: HEADLINE_BOX.left, top: HEADLINE_BOX.top, width: HEADLINE_BOX.width}}>
              <KineticHeadline words={wordsOf(COPY.B1)} frame={HEADLINE_LOCAL_FRAME} variant="T1" align="left" top={0} left={0} width={HEADLINE_BOX.width} />
            </div>
          </TypeLayer>
        )
      }
    />
  );
};

export const StyleFrameV5: React.FC<StyleFrameV5Props> = ({still = 'A1', theme, frame = 'B3f600', headline, measure}) => {
  const [handle] = useState(() => delayRender('loading fonts (StyleFrameV5)'));
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
  const themed = theme ? themeLook(theme, frame) : undefined;
  const look = themed ? themed.look : LOOKS[still];
  if (!ready) return <AbsoluteFill style={{backgroundColor: look.stageColor ?? '#F4F1EA'}} />;
  return (
    <Inner
      look={look}
      label={themed ? `${theme}-${frame}` : still}
      spec={themed?.spec}
      frame={themed ? frame : undefined}
      showHeadline={themed ? (headline ?? frame !== 'B3f600') : true}
      measure={measure}
    />
  );
};
