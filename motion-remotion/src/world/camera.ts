import {interpolate, spring} from 'remotion';
import {FPS, ad, sineLoop} from '../tokens/motion';
import {S04_START, tokenTravelT} from './s04Timing';

export type CameraState = {centerX: number; centerY: number; zoom: number};

// storyboard-v2.md §1.3 camera path, re-timed per art-direction notes: main moves use
// the CAMERA spring (~30-40f settle) instead of a fixed 800ms token, front-loaded then
// held; holds are never fully dead (slow drift / breathing) per the pacing note.
// Centralized here so it's the single place to retune once further notes land.
const springT = (localFrame: number) => Math.min(spring({frame: Math.max(localFrame, 0), fps: FPS, config: ad.springs.camera}), 1);

const S02_START = 195;
const S02_END = 345;
const S03_END = 510;
const S04_END = 750;

// S01 base zoom raised from the storyboard's literal 0.50 to 0.75 (orchestrator review
// round: nodes/lines read too tiny/empty vs the approved style-frame density). Chosen
// so world content still leaves >=35% empty space but reads intentional, not sparse.
const S01_BASE_ZOOM = 0.75;

export const getCamera = (frame: number): CameraState => {
  // --- S01: wide but not sparse, slow continuous push-in drift 1.0 -> 1.06 across the whole scene ---
  if (frame < S02_START) {
    const t = interpolate(frame, [0, S02_START], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
    return {centerX: 1920, centerY: 1080, zoom: S01_BASE_ZOOM * (1 + 0.06 * t)};
  }

  // --- S02: hold empty-slot framing, then swoop into S03's start value in the last ~10f (match-move) ---
  if (frame < S02_END) {
    const holdEnd = S02_END - 10;
    const base = S01_BASE_ZOOM * 1.06; // continuity with S01's drifted end value
    if (frame < holdEnd) {
      // not dead: tiny breathing so it doesn't feel frozen
      const breathe = 1 + 0.01 * (sineLoop(frame, 4000) - 0.5) * 2;
      return {centerX: 1920, centerY: 1080, zoom: base * breathe};
    }
    const t = springT(frame - holdEnd);
    return {centerX: 1920, centerY: 1080, zoom: base + (0.9 - base) * t};
  }

  // --- S03: continue push-in with the CAMERA spring, then hold with slow rotation-synced breathing ---
  if (frame < S03_END) {
    const local = frame - S02_END;
    const t = springT(local);
    const zoom = 0.9 + (1.0 - 0.9) * t;
    return {centerX: 1920, centerY: 1080, zoom};
  }

  // --- S04: lead-pan 3f ahead of the handoff token during its travel burst, then hold ---
  if (frame < S04_END) {
    const local = frame - S04_START;
    const t = tokenTravelT(local + 3); // lead by 3f
    return {centerX: 1500 + (2300 - 1500) * t, centerY: 1080, zoom: 1.05};
  }

  // --- beyond 2a scope: hold S04's end camera (S05-S08 are Phase 2b) ---
  const t = tokenTravelT(S04_END - S04_START + 3);
  return {centerX: 1500 + (2300 - 1500) * t, centerY: 1080, zoom: 1.05};
};
