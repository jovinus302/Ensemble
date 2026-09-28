// v3 §3/§7 step 6 + §6 "콜아웃 투영" — shared rig transform builder + 3D->2D
// projection, so the CSS applied to the Rig div and the callout anchor math
// use exactly the same matrix order (spec's explicit fix for the "미검증:
// DOMMatrix post-multiply order" risk).
import type {CameraPose} from '../tokens/video';
import {K, PERSPECTIVE, STAGE_W, STAGE_H} from '../tokens/video';

// CSS transform string for the Rig div, order fixed per spec §3:
// translate3d(ax,ay,dz) rotateX(rx) rotateY(ry) rotateZ(rz) scale3d(S,S,S) translate3d(-tx*2,-ty*2,0)
export const rigTransform = (pose: CameraPose): string => {
  const S = pose.s / K;
  return [
    `translate3d(${pose.ax}px, ${pose.ay}px, ${pose.dz}px)`,
    `rotateX(${pose.rx}deg)`,
    `rotateY(${pose.ry}deg)`,
    `rotateZ(${pose.rz}deg)`,
    `scale3d(${S}, ${S}, ${S})`,
    `translate3d(${-pose.tx * K}px, ${-pose.ty * K}px, 0px)`,
  ].join(' ');
};

// Builds the identical matrix via DOMMatrix (post-multiply / Self methods),
// which composes in the same left-to-right order as the CSS transform list
// above (each subsequent op acts in the just-established local frame).
export const rigMatrix = (pose: CameraPose): DOMMatrix => {
  const S = pose.s / K;
  const m = new DOMMatrix();
  m.translateSelf(pose.ax, pose.ay, pose.dz);
  m.rotateAxisAngleSelf(1, 0, 0, pose.rx);
  m.rotateAxisAngleSelf(0, 1, 0, pose.ry);
  m.rotateAxisAngleSelf(0, 0, 1, pose.rz);
  m.scaleSelf(S, S, S);
  m.translateSelf(-pose.tx * K, -pose.ty * K, 0);
  return m;
};

export interface Projected {
  x: number;
  y: number;
  z: number; // camera-space depth (q.z), useful for scale/occlusion decisions
}

// Projects a logical-space (x,y,z) point (board logical px, z in logical
// "risen" units already, NOT pre-multiplied by K) through the Rig matrix and
// then the Stage's perspective, matching perspective-origin 960,540.
export const projectPoint = (pose: CameraPose, x: number, y: number, z: number, perspective = PERSPECTIVE): Projected => {
  const m = rigMatrix(pose);
  const q = m.transformPoint(new DOMPoint(x * K, y * K, z * K));
  const denom = perspective - q.z;
  const X = STAGE_W / 2 + ((q.x - STAGE_W / 2) * perspective) / denom;
  const Y = STAGE_H / 2 + ((q.y - STAGE_H / 2) * perspective) / denom;
  return {x: X, y: Y, z: q.z};
};
