// v5 teaser (storyboard-v5.md §6): TeaserV5 renders the SAME pure-function scene as the
// film, reading it at source frames chosen by this map. Teaser timing is driven by
// timing.json's teaser accents (lift / drive / final-hit-resolve); the source side
// reuses the film's own event frames (B3.pmTile, B4.click, B5.roll, B7.vGrow, closing).
//   tf   0-216  <- sf 240-456   B2 break + B3 connection, 1x (lift = PM tile lights)
//   tf 216-228  bridge A        the world runs forward from the B3 state to the B4 card (T-cam under motion blur)
//   tf 228-258  <- sf 798-828   B4 click on the drive accent
//   tf 258-270  bridge B        B4 -> B5
//   tf 270-288  <- sf 975-993   B5 number roll
//   tf 288-300  bridge C        B5 -> B7 (everything between flies past, camera pulls back)
//   tf 300-318  <- sf 1350-1368 B7 capsule -> V
//   tf 318-330  bridge D        V unfolds into the closing
//   tf 330-540  <- sf 1470-1680 closing, wordmark lands on the resolve accent
// Bridges are continuous (no cut, no fade): the scene keeps evolving, only faster, with a
// Hermite blend so the source speed is exactly 1x on both sides of every seam.
import {FRAMES_PER_BEAT, TEASER_FRAMES, accentFrame} from './timing';
import {B2, B3, B4, B5, B7, C, SFX_EVENTS} from './timeline';
import type {WorldCamera} from './stage/worldProject';
import {cameraAt} from './camera';
import {lerp} from './anim';

export const TV = {
  lift: accentFrame('lift', true),
  drive: accentFrame('drive', true),
  resolve: accentFrame('final-hit-resolve', true),
  total: TEASER_FRAMES,
};
export const BRIDGE = 12;
const BEATS2 = 2 * FRAMES_PER_BEAT;

// anchors: (teaser frame, source frame) pairs that must hold exactly
const ANCHORS: {tf: number; sf: number}[] = [
  {tf: 0, sf: B3.pmTile - TV.lift}, // B2 break moment opens the teaser; the PM tile lights on the lift accent
  {tf: TV.drive, sf: B4.click}, // click on the drive accent
  {tf: TV.drive + BEATS2, sf: B5.roll.start}, // number roll two beats later
  {tf: TV.drive + 2 * BEATS2, sf: B7.vGrow.start}, // capsule grows into V
  {tf: TV.drive + 3 * BEATS2, sf: C.headline.land - TV.resolve + (TV.drive + 3 * BEATS2)}, // closing at 1x: the wordmark lands on the resolve accent
];

const hermite = (t: number, s0: number, s1: number, d: number) => {
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * s0 + (t3 - 2 * t2 + t) * d + (-2 * t3 + 3 * t2) * s1 + (t3 - t2) * d; // slope d per unit t => 1 source frame per teaser frame at both ends
};

/** source frame read by the teaser at teaser frame tf */
export const teaserSource = (tf: number) => {
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const p = ANCHORS[i];
    const q = ANCHORS[i + 1];
    if (tf >= q.tf) continue;
    const bridgeStart = q.tf - BRIDGE;
    if (tf < bridgeStart) return p.sf + (tf - p.tf);
    const sA = p.sf + (bridgeStart - p.tf);
    return hermite((tf - bridgeStart) / BRIDGE, sA, q.sf, BRIDGE);
  }
  const last = ANCHORS[ANCHORS.length - 1];
  return last.sf + (tf - last.tf);
};

export const inBridge = (tf: number) => ANCHORS.slice(1).some((q) => tf > q.tf - BRIDGE && tf < q.tf);

/** teaser frame at which a film event (source frame) plays at 1x, or undefined if it falls inside a bridge */
export const teaserFrameOf = (sf: number) => {
  for (let i = 0; i < ANCHORS.length; i++) {
    const p = ANCHORS[i];
    const q = ANCHORS[i + 1];
    const len = q ? q.tf - BRIDGE - p.tf : Infinity;
    if (sf >= p.sf && sf - p.sf < len) return p.tf + (sf - p.sf);
  }
  return undefined;
};

/** inside a bridge the camera makes ONE smooth move from the pose at the bridge's start to the pose at its end (the world state runs forward under it) */
export const teaserCamera = (tf: number): WorldCamera | undefined => {
  for (let i = 1; i < ANCHORS.length; i++) {
    const p = ANCHORS[i - 1];
    const q = ANCHORS[i];
    const bs = q.tf - BRIDGE;
    if (tf > bs && tf < q.tf) {
      const a = cameraAt(p.sf + (bs - p.tf));
      const b = cameraAt(q.sf);
      const t = (tf - bs) / BRIDGE;
      const e = t * t * (3 - 2 * t);
      return {tx: lerp(a.tx, b.tx, e), ty: lerp(a.ty, b.ty, e), tz: 0, yaw: lerp(a.yaw, b.yaw, e), pitch: lerp(a.pitch, b.pitch, e), s: Math.exp(lerp(Math.log(a.s), Math.log(b.s), e))};
    }
  }
  return undefined;
};

// ---- SFX: every film event that plays at 1x in the teaser keeps its sound at the remapped frame; soft whooshes under bridges A and C
const BRIDGE_SFX = [{frame: TV.drive - BRIDGE, volume: 0.4}, {frame: TV.drive + 4 * FRAMES_PER_BEAT * 1 - BRIDGE + 2 * BEATS2 - 2 * BEATS2, volume: 0.4}];
export const TEASER_SFX = (() => {
  const out: {name: (typeof SFX_EVENTS)[number]['name']; frame: number; volume: number; frames?: number; label: string}[] = [];
  for (const e of SFX_EVENTS) {
    let tf = teaserFrameOf(e.frame);
    if (tf === undefined) continue;
    if (e.frame === B2.dashed[0] + 20) tf -= 16; // the teaser breaks the lines 16f earlier
    if (e.name === 'typing' || tf < 0 || tf >= TV.total) continue;
    out.push({name: e.name, frame: tf, volume: e.volume, frames: e.frames, label: e.label});
  }
  for (const b of BRIDGE_SFX) out.push({name: 'thread-draw', frame: b.frame, volume: b.volume, label: 'teaser bridge'});
  return out;
})();
