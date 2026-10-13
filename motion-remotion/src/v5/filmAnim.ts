// v5 film animation values as pure functions of the frame (no DOM): the surface
// body values, light amounts, headline word progress, thread tips, capsule
// pop. PitchV5 renders them; scripts/qa/sync.ts runs the same functions to
// measure when each event actually becomes visible (QA step d).
import {AGENT} from './content';
import {BEAT, EASE, LAND, SPR, beatKick, blink, breathe, clamp01, eased, lerp, prog, sp} from './anim';
import {B1, B2, B3} from './timeline';
import type {FilmAnim} from './surfaces/film';

/** chip morph rule (storyboard §7): the outgoing chip scales .96 + fades over 4f; the incoming one starts 2f after that and is visible on the event frame T */
export const morphAt = (f: number, T: number) => ({out: prog(f, T - 8, 4), inStart: T - 2});

const sweep = (f: number, i: number) => {
  const ph = ((((f - i * 11) % 60) + 60) % 60) / 60;
  return ph < 0.4 ? ph / 0.4 : 2;
};

// the active speaker rotates every two beats over the three people (the PM Agent tile never speaks)
const speakerAt = (f: number, tile: number) => {
  if (tile === 1 || f < B1.tilesM + 30) return 0;
  const who = [0, 2, 3][Math.floor(f / (2 * BEAT)) % 3];
  return who === tile ? Math.sin(Math.PI * ((f % (2 * BEAT)) / (2 * BEAT))) : 0;
};

export const filmAnimAt = (f: number): FilmAnim => {
  const mOut = morphAt(f, B2.capsuleForm).out;
  const brief = morphAt(f, B3.brief);
  const pmLit = eased(f, B3.pmTile, 12, EASE.out);
  const settleBreath = (start: number) => eased(f, start, B2.ringDur) * breathe(f, 60, B2.headline.settle);
  return {
    frame: f,
    M: {
      tile: [0, 1, 2, 3].map((i) => eased(f, B1.tilesM + i * B1.tileStagger, 16)),
      pm: pmLit,
      pmAvatar: sp(f, B3.pmTile + 2, SPR.pop),
      pmPulse: prog(f, B3.pmTile, 26),
      band: eased(f, B2.chip1 - 4, 10) * (1 - eased(f, B2.capsuleMoveStart + 4, 14)),
      chip1: {in: eased(f, B2.chip1, 10), out: mOut, type: prog(f, B2.chip1 + 2, 12)},
      chip2: {in: eased(f, B2.chip2, 10), out: mOut, type: prog(f, B2.chip2 + 2, 12)},
      shimmer: [0, 1, 2, 3].map((i) => sweep(f, i)),
      speaker: [0, 1, 2, 3].map((i) => speakerAt(f, i)),
    },
    D: {
      unfold: eased(f, B1.unfoldD, 22),
      sel: eased(f, B1.unfoldD + 16, 10),
      ring: eased(f, B2.rings.D, B2.ringDur),
      ringBreath: settleBreath(B2.rings.D),
      cursor: {x: Math.sin((2 * Math.PI * f) / 90) * 28, y: Math.cos((2 * Math.PI * f) / 120) * 16, a: eased(f, B1.unfoldD + 26, 10)},
      pin1: 1 - eased(f, B3.pin - 8, 6, EASE.in),
      card: eased(f, B3.pin, 18),
      cardPin: sp(f, B3.pin + 2, SPR.soft),
      cardChip: sp(f, B3.pin + 14, SPR.soft),
    },
    S: {
      bubble: B1.bubble.map((s) => sp(f, s, SPR.pop)),
      amber: eased(f, B2.rings.S, B2.ringDur),
      amberBreath: settleBreath(B2.rings.S),
      row1: 1 - EASE.inout(prog(f, B3.rowSwap.start, B3.rowSwap.end - B3.rowSwap.start)),
      replyRow: EASE.inout(prog(f, B3.rowSwap.start, B3.rowSwap.end - B3.rowSwap.start)),
      reply: sp(f, B3.reply, SPR.soft),
      badge: sp(f, B3.reply + 6, SPR.soft),
      caret: blink(f, 2 * BEAT),
      send: beatKick(f),
      dots: f,
    },
    P: {
      page: eased(f, B1.pageP, 26),
      rows: [0, 1, 2].map((i) => eased(f, B1.pageP + 14 + i * 4, 14)),
      ring: eased(f, B2.rings.P, B2.ringDur),
      ringBreath: settleBreath(B2.rings.P),
    },
    A: {
      lines: [0, 1, 2].map((i) => eased(f, B1.enter.A + 14 + i * 4, 16)),
      typed: Math.max(0, Math.min(AGENT.inboxEmpty.length, Math.floor((f - B1.typeA) / 3) + 1)),
      caret: blink(f, 2 * BEAT),
      slotBorder: f >= B3.brief ? 1 : 0,
      emptyOut: brief.out,
      briefIn: f < brief.inStart ? 0 : sp(f, brief.inStart, SPR.soft),
    },
  };
};

// ---- light amounts (pool / lit edge / dim / dof)
export const pmLitAt = (f: number) => eased(f, B3.pmTile, 12, EASE.out);
export const capNearMAt = (f: number) => (f < B2.capsuleForm ? 0 : 1 - eased(f, B2.capsuleMoveStart, B2.capsuleMoveEnd + 30 - B2.capsuleMoveStart, EASE.soft));
export const litAt = (f: number) => ({
  M: Math.max(0.55 * capNearMAt(f) * eased(f, B2.capsuleForm, 10), pmLitAt(f)),
  D: eased(f, B3.threadD.end - 6, 16, EASE.out),
  S: eased(f, B3.threadS.end - 6, 16, EASE.out),
  P: 0,
  A: eased(f, B3.threadA.end - 6, 16, EASE.out),
});
export const dimPAt = (f: number) => EASE.soft(prog(f, B3.dimP.start, B3.dimP.end - B3.dimP.start));
export const dofAAt = (f: number, from: number) => lerp(from, 1.5, eased(f, B3.threadA.end - 12, 16, EASE.out));
export const capGlowAt = (f: number) => (f < B2.capsuleForm ? 0 : 1 - eased(f, B3.absorb.start, B3.absorb.end - B3.absorb.start, EASE.in));
export const capsuleAppearAt = (f: number) => (f < B2.capsuleForm - 2 ? 0 : sp(f, B2.capsuleForm - 2, SPR.snappy, 14));
export const glowAt = (f: number) => {
  const x = (f - B3.pulse) / B3.pulseHalf;
  return 0.8 * (Math.abs(x) >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * x));
};

// ---- thread tips: snappy leading edge, smooth body (spring pair)
const ARRIVED = 0.995;
const arrivalCache = new Map<number, number>();
/** spring duration (frames) so the snappy tip has landed (>= ARRIVED) exactly `dur` frames after it leaves */
const snappyDurFor = (dur: number) => {
  const hit = arrivalCache.get(dur);
  if (hit !== undefined) return hit;
  const crossing = (d: number) => {
    let f = 0;
    while (f < 4 * dur && sp(f, 0, SPR.snappy, d) < ARRIVED) f++;
    return f;
  };
  let d = 4;
  while (d < 4 * dur && crossing(d) < dur) d++;
  arrivalCache.set(dur, d);
  return d;
};
export const threadAt = (t: {start: number; end: number}, f: number) => {
  const dur = t.end - t.start;
  return {head: sp(f, t.start, SPR.snappy, snappyDurFor(dur)), body: sp(f, t.start + 2, SPR.smooth, dur + 4), dock: eased(f, t.end - 3, 8)};
};

// ---- headline word progress
export const headlineAt = (f: number) => {
  // each word's window is stretched by 1/LAND so the last word has visibly landed (>= .98) on the settle frame
  const win = (start: number, settle: number) => EASE.out(prog(f, start, (settle - start) / LAND));
  const b1 = {
    enter: [0, 1, 2, 3].map((i) => win(B1.headline.reveal + i * B1.headline.stagger, B1.headline.settle)),
    exit: EASE.in(prog(f, B1.headline.exit, B1.headline.exitDur)),
  };
  const b2Exit = EASE.in(prog(f, B2.headline.exit, B2.headline.exitDur));
  const b2 = {
    enter: [0, 1, 2, 3].map((i) => win(B2.headline.reveal + i * B2.headline.stagger, B2.headline.settle)),
    exit: [0, b2Exit, b2Exit, b2Exit],
  };
  const b3 = {
    enter: [0, 1, 2, 3].map((i) => (i === 2 ? 1 : win(B3.headline.enter[i], B3.headline.settle))),
    exit: EASE.in(prog(f, B3.headline.exit, B3.headline.exitDur)),
  };
  return {b1, b2, b3};
};

/** named scalars 0..1 for the QA sync check: the frame an event becomes visible = first frame its value crosses `thr` */
export const probes = (f: number): Record<string, number> => {
  const a = filmAnimAt(f);
  const h = headlineAt(f);
  return {
    'B1 headline settle': h.b1.enter[3],
    'B1 headline exit': h.b1.exit,
    'B2 chip 1': a.M.chip1.in,
    'B2 capsule forms': capsuleAppearAt(f),
    'B2 ring D': a.D.ring,
    'B2 ring S': a.S.amber,
    'B2 ring P': a.P.ring,
    'B2 headline settle': h.b2.enter[3],
    'B3 PM tile lights': a.M.pm,
    'B3 headline settle': h.b3.enter[0],
    'B3 thread M->D ends': threadAt(B3.threadD, f).head,
    'B3 pin opens': a.D.card,
    'B3 headline exit': h.b3.exit,
    'B3 reply 전달됨': a.S.reply,
    'B3 brief arrives': a.A.briefIn,
    'B3 pulse peak': glowAt(f) / 0.8,
  };
};

void clamp01;
