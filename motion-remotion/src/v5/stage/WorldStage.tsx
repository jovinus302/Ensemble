// v5 world stage: background (2D) -> world rig (preserve-3d, one camera matrix
// shared with worldProject) holding the wall shadows and the surface slabs ->
// 2D overlay (headline). Wall shadows are flat leaf planes at wall Z, offset
// by each slab's height above the wall along the key-light direction, so the
// gap between a window and its shadow grows with depth (v4 WallShadow idea,
// generalized to a world of surfaces).
import React from 'react';
import {Background} from '../../v3/stage/Background';
import type {SurfaceId, WorldLook} from '../config';
import {placementsFor, wallZFor} from '../config';
import type {SurfacePlacement} from './worldProject';
import {PERSPECTIVE, STAGE_H, STAGE_W, cameraTransform} from './worldProject';

const BgTone: React.FC<{bg: Exclude<WorldLook['bg'], 'paper'>}> = ({bg}) => (
  <div style={{position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${bg.top} 0%, ${bg.mid} 55%, ${bg.bottom} 100%)`}}>
    <div style={{position: 'absolute', inset: 0, background: `radial-gradient(ellipse 60% 55% at 28% 22%, ${bg.glowA}, transparent 70%)`}} />
    <div style={{position: 'absolute', inset: 0, background: `radial-gradient(ellipse 50% 50% at 82% 78%, ${bg.glowB}, transparent 70%)`}} />
    <div style={{position: 'absolute', inset: 0, background: `radial-gradient(ellipse 120% 100% at 50% 45%, transparent 55%, rgba(23,32,28,${bg.vignette}) 100%)`}} />
  </div>
);

const WallShadows: React.FC<{look: WorldLook; places: Record<SurfaceId, SurfacePlacement>}> = ({look, places}) => {
  const wallZ = wallZFor(look);
  const S = look.shadow;
  return (
    <>
      {(Object.keys(places) as SurfaceId[]).map((id) => {
        const p = places[id];
        const h = p.z - wallZ;
        const sx = p.x + S.dx * h;
        const sy = p.y + S.dy * h;
        const blur = S.blurBase + S.blurPerH * h;
        const w = p.w * Math.cos((p.yaw * Math.PI) / 180);
        // far slabs are higher above the wall only in the "closer = darker" sense: opacity falls off with distance
        const fall = 0.55 + 0.45 * Math.min(1, (p.z - wallZ) / (-wallZ));
        return (
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
        );
      })}
    </>
  );
};

export const WorldStage: React.FC<{
  frame: number;
  look: WorldLook;
  surfaces: React.ReactNode;
  overlay?: React.ReactNode;
}> = ({frame, look, surfaces, overlay}) => {
  const places = placementsFor(look);
  return (
    <div style={{position: 'absolute', width: STAGE_W, height: STAGE_H, perspective: PERSPECTIVE, perspectiveOrigin: `${STAGE_W / 2}px ${STAGE_H / 2}px`, overflow: 'hidden', background: '#F4F1EA'}}>
      {look.bg === 'paper' ? <Background frame={frame} /> : <BgTone bg={look.bg} />}
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
        <WallShadows look={look} places={places} />
        {surfaces}
      </div>
      {overlay}
    </div>
  );
};
