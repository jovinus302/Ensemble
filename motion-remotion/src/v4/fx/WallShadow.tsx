// v4 detached shadow: the board's silhouette (front + back outline, i.e. the
// whole slab), each point offset by its height above a wall plane (see
// config.WALL), drawn in the 2D background layer. Because it is computed from
// the real rig pose, the gap between board and shadow grows with distance
// from the wall — at the opening's (0,-40,0) the near edge's shadow separates
// clearly (a "detached" shadow); frontal beats get one consistent offset.
import React from 'react';
import type {CameraPose} from '../../v3/tokens/video';
import {BOARD_W, BOARD_H} from '../../v3/ui/content';
import {rigPointStage, perspectiveToScreen} from '../stage/projectV4';
import {WALL, BOARD_THICKNESS, BOARD_RADIUS} from '../config';

// Rounded-rect outline in board-logical px (corners sampled as arcs).
export const roundedRectOutline = (w: number, h: number, r: number, stepsPerCorner = 6) => {
  const pts: {x: number; y: number}[] = [];
  const corners = [
    {cx: w - r, cy: r, a0: -90},
    {cx: w - r, cy: h - r, a0: 0},
    {cx: r, cy: h - r, a0: 90},
    {cx: r, cy: r, a0: 180},
  ];
  for (const c of corners) {
    for (let i = 0; i <= stepsPerCorner; i++) {
      const a = ((c.a0 + (90 * i) / stepsPerCorner) * Math.PI) / 180;
      pts.push({x: c.cx + r * Math.cos(a), y: c.cy + r * Math.sin(a)});
    }
  }
  return pts;
};

const cross = (o: {x: number; y: number}, a: {x: number; y: number}, b: {x: number; y: number}) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

const convexHull = (input: {x: number; y: number}[]) => {
  const p = [...input].sort((a, b) => a.x - b.x || a.y - b.y);
  const lower: typeof p = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: typeof p = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
};

export const WallShadow: React.FC<{pose: CameraPose}> = ({pose}) => {
  const L = WALL.light;
  const outline = roundedRectOutline(BOARD_W, BOARD_H, BOARD_RADIUS);
  const screenPts: {x: number; y: number}[] = [];
  for (const z of [0, -BOARD_THICKNESS]) {
    for (const o of outline) {
      const q = rigPointStage(pose, o.x, o.y, z);
      const p = perspectiveToScreen(q);
      const h = Math.max(0, q.z - WALL.z); // height above the wall plane
      screenPts.push({x: p.x + L.x * h, y: p.y + L.y * h});
    }
  }
  const hull = convexHull(screenPts);
  const d = hull.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') + ' Z';
  return (
    <svg
      width={1920}
      height={1080}
      style={{position: 'absolute', inset: 0, overflow: 'visible', filter: `blur(${WALL.blur}px)`, pointerEvents: 'none'}}
    >
      <path d={d} fill={`rgba(23,59,48,${WALL.opacity})`} />
    </svg>
  );
};
