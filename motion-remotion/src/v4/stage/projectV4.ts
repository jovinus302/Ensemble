// v4 projection helpers. The rig matrix and the perspective divide are v3's
// (src/v3/stage/project.ts: rigMatrix / projectPoint), imported unchanged, so
// callout anchors use exactly the transform the board is rendered with.
// v4 adds one step in front of it: a point on the lifted hero card first goes
// through the hero's own transform (scale about the card center, then
// translateZ) — without it a frontal-but-lifted anchor would miss by tens of px.
import type {CameraPose} from '../../v3/tokens/video';
import {K, PERSPECTIVE, STAGE_W, STAGE_H} from '../../v3/tokens/video';
import {projectPoint, rigMatrix} from '../../v3/stage/project';
import {HERO_LIFT} from '../config';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Hero lift at progress `rise` (0 = resting on the board, 1 = fully risen).
export const heroScale = (rise: number) => 1 + (HERO_LIFT.scale - 1) * rise;
export const heroZ = (rise: number) => HERO_LIFT.z * rise;

// Board-logical point on the hero card -> board-logical (x, y, z) after the
// hero transform `translateZ(z) scale(sc)` with transform-origin at the card
// center (the order HeroLift.tsx uses).
export const heroPointToBoard = (card: Rect, p: {x: number; y: number}, rise: number) => {
  const cx = card.x + card.w / 2;
  const cy = card.y + card.h / 2;
  const sc = heroScale(rise);
  return {x: cx + (p.x - cx) * sc, y: cy + (p.y - cy) * sc, z: heroZ(rise)};
};

// Z-inclusive anchor projection: optional hero transform, then v3 projectPoint.
export const projectAnchor = (pose: CameraPose, p: {x: number; y: number; z?: number}, hero?: {card: Rect; rise: number}) => {
  const b = hero ? heroPointToBoard(hero.card, p, hero.rise) : {x: p.x, y: p.y, z: p.z ?? 0};
  return projectPoint(pose, b.x, b.y, b.z);
};

// Stage-space point (rig applied, before perspective) of a board-logical point.
export const rigPointStage = (pose: CameraPose, x: number, y: number, z: number) => {
  const q = rigMatrix(pose).transformPoint(new DOMPoint(x * K, y * K, z * K));
  return {x: q.x, y: q.y, z: q.z};
};

// Perspective divide for an arbitrary stage-space point (same formula as
// projectPoint's tail; perspective-origin at the stage center).
export const perspectiveToScreen = (q: {x: number; y: number; z: number}, perspective = PERSPECTIVE) => {
  const d = perspective - q.z;
  return {x: STAGE_W / 2 + ((q.x - STAGE_W / 2) * perspective) / d, y: STAGE_H / 2 + ((q.y - STAGE_H / 2) * perspective) / d};
};
