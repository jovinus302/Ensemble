// v5 world stage: background (2D) -> world rig (preserve-3d, one camera matrix
// shared with worldProject) holding the wall shadows and the surface slabs ->
// 2D overlay (headline). Wall shadows are flat leaf planes at wall Z, offset
// by each slab's height above the wall along the key-light direction, so the
// gap between a window and its shadow grows with depth (v4 WallShadow idea,
// generalized to a world of surfaces).
import React from 'react';
import {Background} from '../../v3/stage/Background';
import type {SurfaceId, WorldLook} from '../config';
import {placementsFor, refFactor, wallZFor} from '../config';
import type {SurfacePlacement} from './worldProject';
import {PERSPECTIVE, STAGE_H, STAGE_W, cameraTransform, projectSurfacePoint, wallPointForScreen} from './worldProject';

// static grain (feTurbulence, no animation) against banding on dark gradients
const GRAIN = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .9 0'/></filter><rect width='240' height='240' filter='url(%23n)'/></svg>")`;

const BgTone: React.FC<{bg: Exclude<WorldLook['bg'], 'paper'>}> = ({bg}) => (
  <div style={{position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${bg.top} 0%, ${bg.mid} 55%, ${bg.bottom} 100%)`}}>
    <div style={{position: 'absolute', inset: 0, background: `radial-gradient(ellipse 60% 55% at 28% 22%, ${bg.glowA}, transparent 70%)`}} />
    <div style={{position: 'absolute', inset: 0, background: `radial-gradient(ellipse 50% 50% at 82% 78%, ${bg.glowB}, transparent 70%)`}} />
    <div style={{position: 'absolute', inset: 0, background: `radial-gradient(ellipse 120% 100% at 50% 45%, transparent 55%, rgba(23,32,28,${bg.vignette}) 100%)`}} />
  </div>
);

// v6: light pools on the wall behind each surface (lit = thread-touched). The wall is far
// behind the slabs, so wall coordinates are scaled by k = ref(z_slab) / ref(z_wall): the pool
// then projects right behind its slab instead of drifting with parallax.
const WallPools: React.FC<{look: WorldLook; places: Record<SurfaceId, SurfacePlacement>; lit: SurfaceId[]; even?: boolean}> = ({look, places, lit, even}) => {
  const wallZ = wallZFor(look);
  const P = look.pools!;
  const ids = Object.keys(places) as SurfaceId[];
  // pool centers are found by inverting the full camera projection (pitch/yaw parallax of the far wall)
  const centers: Partial<Record<SurfaceId, {x: number; y: number}>> = {};
  for (const id of ids) {
    const c = projectSurfacePoint(look.camera, places[id], places[id].w / 2, places[id].h / 2, 0);
    centers[id] = wallPointForScreen(look.camera, c.x, c.y, wallZ);
  }
  const pool = (key: string, p: SurfacePlacement, k: number, rgb: string, sw: number, sh: number, ox: number, oy: number, a: number) => {
    const w = p.w * sw * k;
    const h = p.h * sh * k;
    return (
      <div
        key={key}
        style={{
          position: 'absolute',
          left: -w / 2,
          top: -h / 2,
          width: w,
          height: h,
          borderRadius: '50%',
          // elliptical falloff instead of a blurred box: reads as light, not as a fog block
          background: `radial-gradient(closest-side, rgba(${rgb},1) 0%, rgba(${rgb},.92) 58%, rgba(${rgb},.5) 78%, rgba(${rgb},0) 100%)`,
          opacity: a,
          transform: `translate3d(${centers[key.replace(/t$/, '') as SurfaceId]!.x + ox * p.w * k}px, ${centers[key.replace(/t$/, '') as SurfaceId]!.y + oy * p.h * k}px, ${wallZ}px)`,
        }}
      />
    );
  };
  const out: React.ReactNode[] = [];
  if (even && P.key) {
    // one even key light behind the whole group (B7: the pools merge into one goal)
    const xs = ids.map((id) => centers[id]!.x);
    const ys = ids.map((id) => centers[id]!.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const w = 1100 * P.key.scale;
    const h = 650 * P.key.scale;
    out.push(<div key="key" style={{position: 'absolute', left: -w / 2, top: -h / 2, width: w, height: h, borderRadius: '50%', background: `rgb(${P.rgb})`, opacity: P.key.a, filter: `blur(${P.blur * 1.3}px)`, transform: `translate3d(${cx}px, ${cy}px, ${wallZ}px)`}} />);
  }
  for (const id of ids) {
    const p = places[id];
    const k = refFactor(p.z) / refFactor(wallZ);
    const isLit = even || lit.includes(id);
    const boost = P.boost?.[id];
    const a = even && P.even !== undefined ? (boost ? boost.lit * 0.85 : P.even) : isLit ? boost?.lit ?? P.lit : P.base;
    const sc = isLit && boost ? boost.scale : P.scale;
    const dy = (boost?.dy ?? P.dy ?? 0) * (isLit ? 1 : 0);
    out.push(pool(id, p, k, P.rgb, boost ? boost.scale : sc, boost ? boost.scale : sc, 0, dy, !isLit && boost ? boost.base ?? P.base : a));
    const t = P.tint?.[id];
    if (isLit && t) out.push(pool(id + 't', p, k, t.rgb, sc * 0.62, sc * 0.62, t.dx, t.dy + dy, t.a * (even ? 0.55 : 1)));
  }
  return <>{out}</>;
};

const WallShadows: React.FC<{look: WorldLook; places: Record<SurfaceId, SurfacePlacement>}> = ({look, places}) => {
  const wallZ = wallZFor(look);
  const S = look.shadow;
  return (
    <>
      {(Object.keys(places) as SurfaceId[]).flatMap((id) => {
        const p = places[id];
        const h = p.z - wallZ;
        const k = look.compWall ? refFactor(p.z) / refFactor(wallZ) : 1;
        const sx = p.x * k + S.dx * h;
        const sy = p.y * k + S.dy * h;
        const blur = S.blurBase + S.blurPerH * h;
        const w = p.w * Math.cos((p.yaw * Math.PI) / 180) * k;
        const hh = p.h * k;
        if (look.compWall) {
          const mk = (key: string, mult: number, op: number, bl: number) => (
            <div
              key={key}
              style={{
                position: 'absolute',
                left: -w / 2,
                top: -hh / 2,
                width: w,
                height: hh,
                borderRadius: look.radius * k,
                background: S.color,
                opacity: op,
                filter: `blur(${bl}px)`,
                transform: `translate3d(${p.x * k + S.dx * h * mult}px, ${p.y * k + S.dy * h * mult}px, ${wallZ}px)`,
              }}
            />
          );
          const out = [];
          if (S.long) out.push(mk(id + 'L', S.long.mult, S.long.opacity, blur * 2 + 6));
          out.push(mk(id, 1, S.opacity, blur));
          return out;
        }
        // far slabs are higher above the wall only in the "closer = darker" sense: opacity falls off with distance
        const fall = 0.55 + 0.45 * Math.min(1, (p.z - wallZ) / (-wallZ));
        return [(
          <div
            key={id}
            style={{
              position: 'absolute',
              left: -w / 2,
              top: -p.h / 2,
              width: w,
              height: p.h,
              borderRadius: look.radius,
              background: `rgba(23,32,28,${S.opacity * fall})`,
              filter: `blur(${blur}px)`,
              transform: `translate3d(${sx}px, ${sy}px, ${wallZ}px)`,
            }}
          />
        )];
      })}
    </>
  );
};

export const WorldStage: React.FC<{
  frame: number;
  look: WorldLook;
  surfaces: React.ReactNode;
  overlay?: React.ReactNode;
  lit?: SurfaceId[];
  even?: boolean;
}> = ({frame, look, surfaces, overlay, lit = [], even}) => {
  const places = placementsFor(look);
  return (
    <div style={{position: 'absolute', width: STAGE_W, height: STAGE_H, perspective: PERSPECTIVE, perspectiveOrigin: `${STAGE_W / 2}px ${STAGE_H / 2}px`, overflow: 'hidden', background: look.stageColor ?? '#F4F1EA'}}>
      {look.bgLayers ? (
        <div style={{position: 'absolute', inset: 0, background: look.bgLayers.join(', ')}} />
      ) : look.bg === 'paper' ? (
        <Background frame={frame} />
      ) : (
        <BgTone bg={look.bg} />
      )}
      {look.grain && <div style={{position: 'absolute', inset: 0, backgroundImage: GRAIN, opacity: look.grain, pointerEvents: 'none'}} />}
      {look.bgOverlay && <div style={{position: 'absolute', inset: 0, background: look.bgOverlay}} />}
      <div
        style={{
          position: 'absolute',
          left: STAGE_W / 2,
          top: STAGE_H / 2,
          width: 0,
          height: 0,
          transformStyle: 'preserve-3d',
          transform: cameraTransform(look.camera),
        }}
      >
        {look.pools && <WallPools look={look} places={places} lit={lit} even={even} />}
        <WallShadows look={look} places={places} />
        {surfaces}
      </div>
      {overlay}
    </div>
  );
};
