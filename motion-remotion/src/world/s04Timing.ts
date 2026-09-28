import {spring, interpolate} from 'remotion';
import {FPS, ad, ease} from '../tokens/motion';

// S04 local timing (scene starts at absolute frame 510). Shared between World (line
// draw / token / packet) and Camera (lead-pan) so they stay in lock-step.
export const S04_START = 510;
export const LINE_STAGGER = ad.stagger.node; // 2f between lines
export const LINE_DRAW_FRAMES = 16; // SMOOTH spring draw

// Beat 1: PM -> research agent (assignment + first handoff)
export const TOKEN_SHRINK_START = 20; // local frame: after research line (3rd, offset 4) finishes at 4+16=20
export const TOKEN_SHRINK_FRAMES = 4;
export const TOKEN_TRAVEL_START = TOKEN_SHRINK_START + TOKEN_SHRINK_FRAMES; // 24
export const TOKEN_TRAVEL_FRAMES = 22;
export const TOKEN_ARRIVAL = TOKEN_TRAVEL_START + TOKEN_TRAVEL_FRAMES; // 46

// Beat 2 (orchestrator review round: S04's second half read as a dead hold): PM ->
// prototype agent, the "PM keeps the flow going" beat. Starts once beat 1 has settled,
// finishes with >=40% of the scene still to hold per the rhythm rule (240f scene;
// arrival at local 132 leaves 108f = 45% hold).
export const TOKEN2_SHRINK_START = 106;
export const TOKEN2_SHRINK_FRAMES = 4;
export const TOKEN2_TRAVEL_START = TOKEN2_SHRINK_START + TOKEN2_SHRINK_FRAMES; // 110
export const TOKEN2_TRAVEL_FRAMES = 22;
export const TOKEN2_ARRIVAL = TOKEN2_TRAVEL_START + TOKEN2_TRAVEL_FRAMES; // 132

export const lineDrawProgress = (localFrame: number, order: number): number => {
  const start = order * LINE_STAGGER;
  const f = Math.max(localFrame - start, 0);
  return Math.min(spring({frame: f, fps: FPS, config: ad.springs.smooth, durationInFrames: LINE_DRAW_FRAMES}), 1);
};

// 0..1 travel progress of a handoff token along its line.
export const tokenTravelT = (localFrame: number, travelStart = TOKEN_TRAVEL_START, travelFrames = TOKEN_TRAVEL_FRAMES): number => {
  return interpolate(localFrame, [travelStart, travelStart + travelFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ease.inout, // symmetric ease-in-out travel per art direction
  });
};

export const tokenShrink = (
  localFrame: number,
  shrinkStart = TOKEN_SHRINK_START,
  shrinkFrames = TOKEN_SHRINK_FRAMES,
  travelStart = TOKEN_TRAVEL_START,
  travelFrames = TOKEN_TRAVEL_FRAMES,
): number => {
  // 1.0 -> 0.9 over 4f, holds at 0.9 while traveling, back to 1.0 shortly after arrival
  const shrinkIn = interpolate(localFrame, [shrinkStart, shrinkStart + shrinkFrames], [1, 0.9], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const arrival = travelStart + travelFrames;
  const restore = interpolate(localFrame, [arrival, arrival + 6], [0.9, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return localFrame < arrival ? shrinkIn : restore;
};
