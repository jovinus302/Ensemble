// v5 film camera: keyed world poses, eased segments, zoom interpolated in log
// space (storyboard-v5.md §1 "카메라"). One eased move per scene, never a zoom
// reversal (s only falls after the dolly toward M), tracking moves <= 40f.
import {THEMES, placementsFor} from './config';
import type {WorldCamera} from './stage/worldProject';
import {cameraMatrix, perspectiveDivide} from './stage/worldProject';
import {EASE, clamp01, lerp} from './anim';
import {B1, B2, B3, BEAT_END} from './timeline';
import {beatStart} from './timing';

/** the approved TA still camera (B1f140 and B3f600 share it) */
export const C0: WorldCamera = THEMES.TA.camera;

/** tx/ty that put the world point at screen (sx, sy) for the given yaw/pitch/s (Newton, 2x2) */
export const solveTxTy = (base: Omit<WorldCamera, 'tx' | 'ty' | 'tz'>, w: {x: number; y: number; z: number}, sx: number, sy: number): WorldCamera => {
  let tx = 0;
  let ty = 0;
  const proj = (a: number, b: number) => perspectiveDivide(cameraMatrix({...base, tx: a, ty: b, tz: 0}).transformPoint(new DOMPoint(w.x, w.y, w.z)));
  for (let i = 0; i < 14; i++) {
    const p = proj(tx, ty);
    const px = proj(tx + 1, ty);
    const py = proj(tx, ty + 1);
    const j00 = px.x - p.x;
    const j01 = py.x - p.x;
    const j10 = px.y - p.y;
    const j11 = py.y - p.y;
    const det = j00 * j11 - j01 * j10 || 1;
    const ex = sx - p.x;
    const ey = sy - p.y;
    tx += (j11 * ex - j01 * ey) / det;
    ty += (-j10 * ex + j00 * ey) / det;
  }
  return {...base, tx, ty, tz: 0};
};

let cache: {keys: Key[]} | undefined;
type Key = {f: number; pose: WorldCamera; ease: (t: number) => number};

const keys = (): Key[] => {
  if (cache) return cache.keys;
  const places = placementsFor(THEMES.TA);
  const M = places.M;
  const tweak = (s: number): WorldCamera => ({...C0, s});
  const drift = (s: number, dtx: number): WorldCamera => ({...C0, s, tx: C0.tx + dtx}); // slow lateral drift during reads (world px)
  // B1: wide intro drift (yaw -14 -> C0), then near-still reads (s within 0.5%)
  const intro: WorldCamera = {...C0, yaw: -14, s: 0.83};
  // B1 end / B2 start: close on M, M in the left third (storyboard B1 "s 1.15, M 왼쪽 1/3")
  const m1 = solveTxTy({yaw: -13, pitch: 6, s: 1.15}, {x: M.x, y: M.y, z: M.z}, 640, 620);
  // B2 end / B3 reads: M and D together, every surface but A in view; same angle as C0
  const p2: WorldCamera = {tx: 95, ty: 15, tz: 0, yaw: -10, pitch: 6, s: 0.88};
  const k = (f: number, pose: WorldCamera, ease = EASE.inout): Key => ({f, pose, ease});
  cache = {
    keys: [
      k(beatStart('B1'), intro),
      k(B1.camSettle, drift(0.8625, -9), EASE.out),
      k(B1.still, tweak(0.86), EASE.linear), // = TA B1f140 camera exactly
      k(B1.camEnd, drift(0.8596, 1), EASE.linear), // read drift: slow dolly, <=0.5% scale
      k(B1.camMoveStart, drift(0.8596, 1.5), EASE.linear),
      k(B1.camMoveEnd, m1),
      k(B2.camMoveStart, m1),
      k(B2.camMoveEnd, p2),
      k(B3.camMove.start, {...p2, s: 0.876}, EASE.linear), // near-still read: drift <= 0.8%
      k(B3.camMove.end, drift(0.8625, -6)),
      k(B3.pulse, tweak(0.86), EASE.linear), // = TA B3f600 camera exactly
      k(BEAT_END, drift(0.857, 6), EASE.linear),
    ],
  };
  return cache.keys;
};

export const cameraAt = (frame: number): WorldCamera => {
  const ks = keys();
  if (frame <= ks[0].f) return ks[0].pose;
  const last = ks[ks.length - 1];
  if (frame >= last.f) return last.pose;
  let i = 0;
  while (i < ks.length - 2 && frame >= ks[i + 1].f) i++;
  const a = ks[i];
  const b = ks[i + 1];
  const e = b.ease(clamp01((frame - a.f) / Math.max(1, b.f - a.f)));
  return {
    tx: lerp(a.pose.tx, b.pose.tx, e),
    ty: lerp(a.pose.ty, b.pose.ty, e),
    tz: 0,
    yaw: lerp(a.pose.yaw, b.pose.yaw, e),
    pitch: lerp(a.pose.pitch, b.pose.pitch, e),
    s: Math.exp(lerp(Math.log(a.pose.s), Math.log(b.pose.s), e)), // log-space zoom
  };
};

/** frames in which the camera is travelling (T-cam: motion blur candidates) */
export const camMoving = (frame: number) => {
  const ks = keys();
  for (let i = 1; i < ks.length; i++) {
    const a = ks[i - 1].pose;
    const b = ks[i].pose;
    const big = Math.abs(Math.log(a.s / b.s)) > 0.04 || Math.abs(a.tx - b.tx) > 20 || Math.abs(a.ty - b.ty) > 20;
    if (big && frame > ks[i - 1].f && frame < ks[i].f) return true;
  }
  return false;
};
