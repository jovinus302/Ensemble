// v3 §3/§7 step 6 — Stage (perspective root, NOT preserve-3d, so overflow:hidden
// here is safe per spec) + Rig (the preserve-3d group holding the board/fx,
// transform = rigTransform(pose)) + TypeRig (separate preserve-3d group for
// headlines: same perspective, half the rig's rotation, ignores camera zoom).
import React from 'react';
import type {CameraPose} from '../tokens/video';
import {PERSPECTIVE, STAGE_W, STAGE_H} from '../tokens/video';
import {rigTransform} from './project';
import {Background} from './Background';
import {Noise} from './Noise';

export const Rig: React.FC<{pose: CameraPose; children: React.ReactNode}> = ({pose, children}) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      transformStyle: 'preserve-3d',
      // transform-origin pinned to (0,0): project.ts's DOMMatrix math composes
      // from the element's local origin with no re-centering step, so the CSS
      // transform must use the same convention (browser default is 50% 50%,
      // which would otherwise desync Callout's projected anchors from the
      // actual render — this was caught by the §6 debug-dot check).
      transformOrigin: '0px 0px',
      transform: rigTransform(pose),
    }}
  >
    {children}
  </div>
);

// TypeRig: independent preserve-3d group sharing perspective with Rig, but at
// half rotation and not following the rig's zoom (§3 "카메라의 줌은 따르지
// 않는다"). Position is set per-headline by the child (translate(pos) is the
// child's own transform, composed after this group's rotation).
export const TypeRig: React.FC<{pose: CameraPose; children: React.ReactNode}> = ({pose, children}) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      transformStyle: 'preserve-3d',
      // Deliberately NOT pinned to (0,0) like Rig: TypeRig has no project.ts
      // dependency (callouts project through Rig, not TypeRig), and pivoting
      // from the stage center (the CSS default) keeps a centered T1 headline
      // visually stable while still rotating in place — pivoting from the
      // corner instead gave centered headlines a large, unwanted lever-arm
      // shift (round-3 fix: this is what made SF1's headline look mispositioned
      // rather than "sharing the board's perspective").
      transformOrigin: '960px 540px',
      transform: `rotateX(${pose.rx * 0.5}deg) rotateY(${pose.ry * 0.5}deg) translateZ(0px)`,
    }}
  >
    {children}
  </div>
);

export const Stage: React.FC<{frame: number; children: React.ReactNode}> = ({frame, children}) => (
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
    {children}
    <Noise frame={frame} />
  </div>
);
