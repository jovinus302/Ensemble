// v4 stage: three depth layers — (1) background (v3 Background + the detached
// wall shadow), (2) the board rig, (3) the hero card, which lives inside the
// rig at a Z lift (HeroLift.tsx) — plus flat 2D overlays on top (callouts,
// headlines, noise). The rig transform is v3's rigTransform, pivot pinned to
// (0,0) exactly like v3's Rig so projectPoint() matches the render.
import React from 'react';
import type {CameraPose} from '../../v3/tokens/video';
import {PERSPECTIVE, STAGE_W, STAGE_H} from '../../v3/tokens/video';
import {rigTransform} from '../../v3/stage/project';
import {Background} from '../../v3/stage/Background';
import {Noise} from '../../v3/stage/Noise';
import {WallShadow} from '../fx/WallShadow';

export const BoardRig: React.FC<{pose: CameraPose; children: React.ReactNode}> = ({pose, children}) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      transformStyle: 'preserve-3d',
      transformOrigin: '0px 0px',
      transform: rigTransform(pose),
    }}
  >
    {children}
  </div>
);

// Headlines: screen-plane, front-facing, never rotated or zoomed with the board.
export const TypeLayer: React.FC<{children: React.ReactNode}> = ({children}) => (
  <div style={{position: 'absolute', inset: 0, transformStyle: 'preserve-3d', pointerEvents: 'none'}}>{children}</div>
);

// `slab` (the board's thickness) gets its own rig with the identical
// transform, composited BEFORE the board rig. From any camera in front of the
// board the side faces never need to occlude the board face, so painting the
// board on top is always correct — and it keeps the board body out of a 3D
// sort with perpendicular planes, which in Chrome dropped the body's pixels
// near the side face (iteration log in review/log-v4-sf.md).
//
// `boardOpacity` (motion only, e.g. the opening's board entrance): wraps the
// wall shadow + rigs in one opacity group. Opacity on a preserve-3d element
// would flatten it, so the group is a plain full-stage div that re-declares
// the stage's perspective (perspective only reaches direct children). When
// the prop is omitted — every still — the DOM is exactly the unwrapped one.
export const StageV4: React.FC<{
  frame: number;
  pose: CameraPose;
  board: React.ReactNode;
  slab?: React.ReactNode;
  overlay?: React.ReactNode;
  boardOpacity?: number;
}> = ({frame, pose, board, slab, overlay, boardOpacity}) => {
  const layers = (
    <>
      <WallShadow pose={pose} />
      {slab && <BoardRig pose={pose}>{slab}</BoardRig>}
      <BoardRig pose={pose}>{board}</BoardRig>
    </>
  );
  return (
    <div
      style={{
        position: 'absolute',
        width: STAGE_W,
        height: STAGE_H,
        perspective: PERSPECTIVE,
        perspectiveOrigin: '960px 540px',
        overflow: 'hidden',
        backgroundColor: '#F4F1EA',
      }}
    >
      <Background frame={frame} />
      {boardOpacity === undefined ? (
        layers
      ) : (
        <div style={{position: 'absolute', inset: 0, perspective: PERSPECTIVE, perspectiveOrigin: '960px 540px', opacity: boardOpacity}}>{layers}</div>
      )}
      {overlay}
      <Noise frame={frame} />
    </div>
  );
};
