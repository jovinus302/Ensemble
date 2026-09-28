import {interpolate, spring} from 'remotion';
import {ease, duration, ms, sineLoop, linearLoopDeg, ad, FPS} from '../tokens/motion';
import {colors} from '../tokens/colors';
import {
  lineDrawProgress,
  tokenTravelT,
  tokenShrink,
  S04_START,
  TOKEN_TRAVEL_START,
  TOKEN_TRAVEL_FRAMES,
  TOKEN_ARRIVAL,
  TOKEN2_SHRINK_START,
  TOKEN2_TRAVEL_START,
  TOKEN2_TRAVEL_FRAMES,
  TOKEN2_ARRIVAL,
} from './s04Timing';

const clampFrame = (f: number) => Math.min(f, 750); // Phase 2a only implements S01-S04 visuals

const easedSeg = (frame: number, start: number, len: number, easing = ease.standard) =>
  interpolate(frame, [start, start + len], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing});

const springSeg = (frame: number, start: number, config = ad.springs.smooth, durationInFrames?: number) => {
  const f = Math.max(frame - start, 0);
  return Math.min(spring({frame: f, fps: FPS, config, durationInFrames}), 1);
};

export type ChaosLineState = {opacity: number; flowOffset: number};

export type WorldState = {
  bgColor: string;
  darkAmount: number;
  pmSlotOpacity: number;
  pmSlotScale: number;
  pmVisible: boolean;
  pmScaleUniform: number;
  pmScaleX: number;
  pmScaleY: number;
  pmRingDraw: number; // 0..1 reveal of the ring perimeter
  pmRingRotationDeg: number;
  peripheralOpacity: number;
  peripheralPop: (order: number) => number; // scale bump per node, S03
  peripheralDrift: (phase: number) => {dx: number; dy: number};
  chaos: {direct1: ChaosLineState; direct2: ChaosLineState; cross1: ChaosLineState; cross2: ChaosLineState};
  cursorPacket: {opacity: number; travelP: number; ripple: {r: number; opacity: number}; touchScale: number};
  assign: {
    pmUser: {draw: number; pulse: number};
    pmDesigner: {draw: number; pulse: number};
    pmResearch: {draw: number; pulse: number; activeColor: number};
    pmProto: {draw: number; pulse: number; activeColor: number};
  };
  handoffToken: {visible: boolean; t: number; shrink: number; barsIn: number; barsOut: number; groupOpacity: number};
  handoffToken2: {visible: boolean; t: number; shrink: number; barsIn: number; barsOut: number; groupOpacity: number};
};

// shared with Headline.tsx so on-screen text keeps AA contrast during the S02 dark dip
export const getDarkAmount = (rawFrame: number): number => {
  const frame = clampFrame(rawFrame);
  const toDark = easedSeg(frame, 195, 20, ease.standard);
  const toPaper = easedSeg(frame, 345, 20, ease.standard);
  return Math.max(toDark - toPaper, 0);
};

const S01_END = 195;
const S02_END = 345;
const S03_END = 510;

export const getWorldState = (rawFrame: number): WorldState => {
  const frame = clampFrame(rawFrame);

  // --- background: paper (S01) -> ink (S02, 20f) -> paper (S03, 20f) ---
  const toDark = easedSeg(frame, S01_END, 20, ease.standard);
  const toPaper = easedSeg(frame, S02_END, 20, ease.standard);
  const darkAmount = Math.max(toDark - toPaper, 0);
  const bgColor = mixHex(colors.background, colors.darkBackground, darkAmount);

  // --- empty PM slot: breathing scale 0.98<->1.0 over 40f, visible until PM materializes ---
  const pmAppear = S02_END; // PM pops right as we settle back into light (S03 start)
  const pmVisible = frame >= pmAppear;
  const pmSlotOpacity = pmVisible ? 0 : 0.95;
  const pmSlotScale = 0.98 + 0.02 * sineLoop(rawFrame, 1333); // 40f @ 30fps

  // --- PM pop: squash/stretch + overshoot, per art-direction (rounded square = half amount) ---
  const popLocal = Math.max(frame - pmAppear, 0);
  const popUniform = interpolate(popLocal, [0, 6, 10, 16], [0, 1.1, 0.97, 1.0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const squashX = interpolate(popLocal, [0, 6], [1.04, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const squashY = interpolate(popLocal, [0, 6], [0.97, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const pmScaleUniform = pmVisible ? popUniform : 0;
  const pmScaleX = squashX;
  const pmScaleY = squashY;

  // ring: draw perimeter 0->1 over 24f, then continuous slow rotation (360deg / 240f)
  const pmRingDraw = interpolate(popLocal, [0, 24], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease.standard});
  const rotateSince = Math.max(rawFrame - (pmAppear + 24), 0);
  const pmRingRotationDeg = pmRingDraw >= 1 ? linearLoopDeg(rotateSince, 8000) : 0; // 360deg/240f @30fps = 8000ms

  // --- peripheral nodes: full (S01) -> dim (S02, drift) -> full + pop bump (S03) ---
  // orchestrator review round: ghosts at 0.3 opacity read as "nearly invisible" against
  // the ink bg; raised the dim floor to 0.5 so "team without a conductor" stays legible.
  const dimOut = easedSeg(frame, S01_END, ms(duration.md));
  const dimIn = easedSeg(frame, S02_END, 20);
  const peripheralOpacity = frame < S02_END ? 1 - dimOut * 0.5 : 0.5 + dimIn * 0.5;

  const peripheralPop = (order: number): number => {
    const start = pmAppear + order * ad.stagger.node;
    const p = interpolate(popLocal - order * ad.stagger.node, [0, 6, 14], [1, 1.06, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    return frame >= start ? p : 1;
  };

  // async ±8px drift, only alive (ramped in/out) during S02
  const driftEnvelope = Math.min(easedSeg(frame, S01_END, 20), 1 - easedSeg(frame, S02_END - 20, 20));
  const peripheralDrift = (phase: number) => ({
    dx: 8 * driftEnvelope * Math.sin((rawFrame / 55) * 2 * Math.PI + phase),
    dy: 8 * driftEnvelope * Math.cos((rawFrame / 70) * 2 * Math.PI + phase * 1.3),
  });

  // --- S01 chaos lines: continuous dash-flow (marching, 60f cycle), quick fade-in, fade-out once PM lands ---
  const chaosFadeIn = (order: number) => easedSeg(frame, order * 2, 10, ease.enter);
  const chaosFadeOut = 1 - easedSeg(frame, S02_END, ms(duration.md));
  const flowOffset = -((rawFrame % 60) / 60) * 16;
  const mkChaos = (order: number): ChaosLineState => ({
    opacity: chaosFadeIn(order) * (frame < S02_END ? peripheralOpacity : peripheralOpacity * chaosFadeOut),
    flowOffset,
  });
  const chaos = {direct1: mkChaos(0), direct2: mkChaos(1), cross1: mkChaos(2), cross2: mkChaos(3)};

  // --- hand cursor + packet: continuously carries the packet back and forth between
  // the User-side and Designer-side tangle (orchestrator review round: a single
  // one-shot drop at f70-82 then ~110f of stillness read as a dead hold). The cosine
  // loop naturally slows to near-zero velocity at each end, which reads as "hesitate",
  // and a ripple + touch-scale pulse there reads as "drop" -- picked back up as it
  // accelerates away from 0/1 again. Deterministic function of frame, no timers.
  const cursorEnter = easedSeg(frame, 45, 8, ease.enter);
  const cyclePhaseFrame = Math.max(rawFrame - 45, 0);
  const travelP = sineLoop(cyclePhaseFrame, 100 * (1000 / FPS)); // 100f period -> ~2 round trips over S01's 195f
  const distFromEnd = Math.min(travelP, 1 - travelP);
  const rippleStrength = Math.max(1 - distFromEnd / 0.1, 0);
  const ripple = {r: 6 + rippleStrength * 28, opacity: rippleStrength * 0.5};
  const touchScale = 1 - 0.12 * rippleStrength;
  const cursorPacketOpacity = cursorEnter * (frame < S02_END ? peripheralOpacity : peripheralOpacity * chaosFadeOut);

  // --- S04 assignment lines: SMOOTH spring draw, 2f stagger, endpoint pulse on completion ---
  const s04Local = frame - S04_START;
  const lineOrders = {user: 0, designer: 1, research: 2, proto: 3};
  const drawFor = (order: number) => (frame >= S04_START ? lineDrawProgress(s04Local, order) : 0);
  const pulseFor = (order: number) => {
    const completeAt = order * ad.stagger.node + 16;
    const p = easedSeg(s04Local, completeAt, 8);
    return 1 + 0.3 * Math.sin(p * Math.PI); // endpoint pulse: scale 1 -> 1.3 -> 1 over 8f
  };
  const pmUserDraw = drawFor(lineOrders.user);
  const pmDesignerDraw = drawFor(lineOrders.designer);
  const pmResearchDraw = drawFor(lineOrders.research);
  const pmProtoDraw = drawFor(lineOrders.proto);
  const activeColor = frame >= S04_START ? easedSeg(s04Local, lineOrders.research * ad.stagger.node + 16, 3) : 0;

  // --- handoff token 1 (PM -> research agent): shrink -> ease travel with comet trail; context-5 packet cascades in/out ---
  const tokenT = frame >= S04_START ? tokenTravelT(s04Local) : 0;
  const shrink = frame >= S04_START ? tokenShrink(s04Local) : 1;
  const barsIn = frame >= S04_START ? easedSeg(s04Local, TOKEN_TRAVEL_START, 10) : 0; // cascade unfold, ~2f/bar across 5 bars
  const barsOut = frame >= S04_START ? easedSeg(s04Local, TOKEN_ARRIVAL, 5) : 0; // fold reverse, tight
  const groupFadeIn = easedSeg(s04Local, TOKEN_TRAVEL_START - 6, 6);
  const groupFadeOut = 1 - easedSeg(s04Local, TOKEN_ARRIVAL + 6, 10); // clear the destination node after delivery registers
  const handoffToken = {
    visible: frame >= S04_START && s04Local >= 18,
    t: tokenT,
    shrink,
    barsIn,
    barsOut,
    groupOpacity: Math.min(groupFadeIn, groupFadeOut),
  };

  // --- handoff token 2 (PM -> prototype agent): second beat so S04's back half isn't a
  // dead hold, and so the core claim ("PM keeps assigning/handing off in one flow", not
  // a one-shot) actually shows twice. Arrives with >=40% of the scene still to hold.
  const protoActiveColor = frame >= S04_START ? easedSeg(s04Local, TOKEN2_SHRINK_START - 4, 3) : 0;
  const tokenT2 = frame >= S04_START ? tokenTravelT(s04Local, TOKEN2_TRAVEL_START, TOKEN2_TRAVEL_FRAMES) : 0;
  const shrink2 = frame >= S04_START ? tokenShrink(s04Local, TOKEN2_SHRINK_START, 4, TOKEN2_TRAVEL_START, TOKEN2_TRAVEL_FRAMES) : 1;
  const barsIn2 = frame >= S04_START ? easedSeg(s04Local, TOKEN2_TRAVEL_START, 10) : 0;
  const barsOut2 = frame >= S04_START ? easedSeg(s04Local, TOKEN2_ARRIVAL, 5) : 0;
  const groupFadeIn2 = easedSeg(s04Local, TOKEN2_TRAVEL_START - 6, 6);
  const groupFadeOut2 = 1 - easedSeg(s04Local, TOKEN2_ARRIVAL + 6, 10);
  const handoffToken2 = {
    visible: frame >= S04_START && s04Local >= TOKEN2_TRAVEL_START - 6,
    t: tokenT2,
    shrink: shrink2,
    barsIn: barsIn2,
    barsOut: barsOut2,
    groupOpacity: Math.min(groupFadeIn2, groupFadeOut2),
  };

  return {
    bgColor,
    darkAmount,
    pmSlotOpacity,
    pmSlotScale,
    pmVisible,
    pmScaleUniform,
    pmScaleX,
    pmScaleY,
    pmRingDraw,
    pmRingRotationDeg,
    peripheralOpacity,
    peripheralPop,
    peripheralDrift,
    chaos,
    cursorPacket: {opacity: cursorPacketOpacity, travelP, ripple, touchScale},
    assign: {
      pmUser: {draw: pmUserDraw, pulse: pulseFor(lineOrders.user)},
      pmDesigner: {draw: pmDesignerDraw, pulse: pulseFor(lineOrders.designer)},
      pmResearch: {draw: pmResearchDraw, pulse: pulseFor(lineOrders.research), activeColor},
      pmProto: {draw: pmProtoDraw, pulse: pulseFor(lineOrders.proto), activeColor: protoActiveColor},
    },
    handoffToken,
    handoffToken2,
  };
};

function mixHex(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const r = Math.round(pa.r + (pb.r - pa.r) * t);
  const g = Math.round(pa.g + (pb.g - pa.g) * t);
  const bch = Math.round(pa.b + (pb.b - pa.b) * t);
  return `rgb(${r}, ${g}, ${bch})`;
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}
