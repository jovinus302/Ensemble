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
import {PERSPECTIVE, STAGE_H, STAGE_W, cameraTransform} from './worldProject';

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
const WallPools: React.FC<{look: WorldLook; places: Record<SurfaceId, SurfacePlacement>; lit: SurfaceId[]}> = ({look, places, lit}) => {
  const wallZ = wallZFor(look);
  const P = look.pools!;
  return (
    <>
      {(Object.keys(places) as SurfaceId[]).map((id) => {
        const p = places[id];
        const k = refFactor(p.z) / refFactor(wallZ);
        const w = p.w * P.scale * k;
        const h = p.h * P.scale * k;
        const a = lit.includes(id) ? P.lit : P.base;
        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: -w / 2,
              top: -h / 2,
              width: w,
              height: h,
              borderRadius: '50%',
              background: `rgb(${P.rgb})`,
              opacity: a,
              filter: `blur(${P.blur}px)`,
              transform: `translate3d(${p.x * k}px, ${p.y * k}px, ${wallZ}px)`,
            }}
          />
        );
      })}
    </>
  );
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
}> = ({frame, look, surfaces, overlay, lit = []}) => {
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
        {look.pools && <WallPools look={look} places={places} lit={lit} />}
        <WallShadows look={look} places={places} />
        {surfaces}
      </div>
      {overlay}
    </div>
  );
};
