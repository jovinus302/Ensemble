// v5 film animation values as pure functions of the frame (no DOM): the surface
// body values, light amounts, headline word progress, thread tips, capsule
// pop. PitchV5 renders them; scripts/qa/sync.ts runs the same functions to
// measure when each event actually becomes visible (QA step d).
import {AGENT, B7COPY} from './content';
import {BEAT, EASE, LAND, SPR, beatKick, blink, breathe, clamp01, eased, lerp, prog, sp} from './anim';
import {B1, B2, B3, B4, B5, B6, B7, C} from './timeline';
import type {FilmAnim, Morph} from './surfaces/film';

export const TYPED_LINE = B7COPY.agentLine;

/** chip morph rule (storyboard §7): the outgoing chip scales .96 + fades over 4f; the incoming one starts 2f after that and is visible on the event frame T */
export const morphAt = (f: number, T: number) => ({out: prog(f, T - 8, 4), inStart: T - 2});
const mph = (f: number, T: number): Morph => {
  const m = morphAt(f, T);
  return {out: m.out, in: f < m.inStart ? 0 : sp(f, m.inStart, SPR.soft)};
};
const bell = (f: number, center: number, half: number) => {
  const x = (f - center) / half;
  return Math.abs(x) >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * x);
};
const e = (f: number, w: {start: number; end: number}, ease: (t: number) => number = EASE.inout) => ease(prog(f, w.start, w.end - w.start));

const sweep = (f: number, i: number) => {
  const ph = ((((f - i * 11) % 60) + 60) % 60) / 60;
  return ph < 0.4 ? ph / 0.4 : 2;
};

// the active speaker rotates every two beats over the three people (the PM Agent tile never speaks)
const speakerAt = (f: number, tile: number) => {
  if (tile === 1 || f < B1.tilesM + 30) return 0;
  const who = [0, 2, 3][Math.floor(f / (2 * BEAT)) % 3];
  return who === tile ? Math.sin(Math.PI * ((f % (2 * BEAT)) / (2 * BEAT))) * (1 - e(f, {start: B7.camMove.start - 20, end: B7.camMove.start + 10})) : 0;
};

/** M's caption band: B2 (chips) and again B6 (the capsule settles back in it) */
export const bandAt = (f: number) =>
  Math.max(eased(f, B2.chip1 - 4, 10) * (1 - eased(f, B2.capsuleMoveStart + 4, 14)), eased(f, B6.capsuleBack.end - 20, 12) * (1 - eased(f, B7.camMove.start + 12, 14)));

/** the capsule's date field: "10/14" -> "2주 뒤" (B6 start) -> back to "10/14" when it lands in M */
export const capsuleDateAt = (f: number) => {
  const open = eased(f, B6.capsuleOut.start + 10, 14);
  if (f < B6.flipBack.start) return {open, a: '10/14', b: '2주 뒤', t: e(f, B6.flip, EASE.out)};
  return {open: open * (1 - eased(f, B7.capsuleToV.start, 10)), a: '2주 뒤', b: '10/14', t: e(f, B6.flipBack, EASE.out)};
};

export const filmAnimAt = (f: number): FilmAnim => {
  const mOut = morphAt(f, B2.capsuleForm).out;
  const brief = morphAt(f, B3.brief);
  const pmLit = eased(f, B3.pmTile, 12, EASE.out);
  const settleBreath = (start: number) => eased(f, start, B2.ringDur) * breathe(f, 60, B2.headline.settle);
  const typed2 = f < B5.typing.start ? 0 : Math.min(TYPED_LINE.length, Math.floor((f - B5.typing.start) / B5.typing.perChar) + 1);
  const rowsB4 = e(f, B4.rowsOut);
  const rowsB6 = e(f, B6.rowsOut);
  const rowsB5 = e(f, B5.rowsOut);
  const rowSwap3 = EASE.inout(prog(f, B3.rowSwap.start, B3.rowSwap.end - B3.rowSwap.start));
  const adRoll = eased(f, B5.reflected, 14, EASE.inout);
  const cardRise = eased(f, B4.card, B4.cardDur);
  const solid = eased(f, B4.click, 12); // the card lights solid as a wipe spreading from the button, starting on the click
  const approach = 1 - Math.pow(1 - prog(f, B4.approach.start, B4.approach.end - B4.approach.start), 3);
  return {
    frame: f,
    M: {
      tile: [0, 1, 2, 3].map((i) => eased(f, B1.tilesM + i * B1.tileStagger, 16)),
      pm: pmLit,
      pmAvatar: sp(f, B3.pmTile + 2, SPR.pop),
      pmPulse: prog(f, B3.pmTile, 26),
      band: bandAt(f),
      chip1: {in: eased(f, B2.chip1, 10), out: mOut, type: prog(f, B2.chip1 + 2, 12)},
      chip2: {in: eased(f, B2.chip2, 10), out: mOut, type: prog(f, B2.chip2 + 2, 12)},
      shimmer: [0, 1, 2, 3].map((i) => sweep(f, i)),
      speaker: [0, 1, 2, 3].map((i) => speakerAt(f, i)),
    },
    D: {
      unfold: eased(f, B1.unfoldD, 22),
      sel: eased(f, B1.unfoldD + 16, 10),
      ring: eased(f, B2.rings.D, B2.ringDur) * (1 - eased(f, B5.roll.start, 12)),
      ringBreath: settleBreath(B2.rings.D),
      cursor: {
        x: Math.sin((2 * Math.PI * f) / 90) * 28,
        y: Math.cos((2 * Math.PI * f) / 120) * 16,
        a: eased(f, B1.unfoldD + 26, 10) * (1 - eased(f, B5.roll.start + B5.roll.dur + 10, 20)),
        toBanner: e(f, B5.cursorToBanner) * (1 - eased(f, B5.roll.start + B5.roll.dur, 20)),
      },
      pin1: 1 - eased(f, B3.pin - 8, 6, EASE.in),
      card: eased(f, B3.pin, 18),
      cardPin: sp(f, B3.pin + 2, SPR.soft),
      cardChip: sp(f, B3.pin + 14, SPR.soft),
      roll: [0, 1, 2].map((i) => eased(f, B5.roll.start + i * B5.roll.stagger, B5.roll.dur - 2 * B5.roll.stagger, EASE.out)),
      chipMorph: mph(f, B5.dChip),
    },
    S: {
      bubble: B1.bubble.map((s) => sp(f, s, SPR.pop)),
      typing: [1, 2, 3].map((i) => clamp01((f - (B1.bubble[i] - 16)) / 2) * (1 - clamp01((f - B1.bubble[i] + 2) / 3))),
      amber: eased(f, B2.rings.S, B2.ringDur),
      amberBreath: settleBreath(B2.rings.S),
      open: {
        do1: 1 - rowSwap3,
        ji: 1 - rowsB5,
        reply: rowSwap3 * (1 - rowsB6),
        seo: 1 - rowsB4,
        do2: 1 - rowsB4,
        card: cardRise * (1 - rowsB6),
        memo: rowsB5 * (1 - rowsB6),
        minho: rowsB6,
        answer: rowsB6,
      },
      reply: sp(f, B3.reply, SPR.soft),
      badge: sp(f, B3.reply + 6, SPR.soft),
      caret: blink(f, 2 * BEAT),
      send: beatKick(f),
      dots: f,
      card: {
        pop: cardRise,
        lit: 0.55 + 0.45 * solid,
        solid,
        press: bell(f, B4.click, 5),
        flash: prog(f, B4.click, 14),
        bounce: bell(f, B4.morph + 5, 9),
        chip: mph(f, B4.morph),
      },
      cursor: {a: eased(f, B4.cursorIn, 8) * (1 - eased(f, B4.morph + 30, 10)), near: approach, frame: f},
      memo: f < B5.memo ? 0 : sp(f, B5.memo, SPR.soft),
      minho: f < B6.minho ? 0 : sp(f, B6.minho, SPR.pop),
      answer: f < B6.answer ? 0 : sp(f, B6.answer, SPR.soft),
      source: f < B6.source ? 0 : sp(f, B6.source, SPR.soft),
    },
    P: {
      page: eased(f, B1.pageP, 26),
      rows: [0, 1, 2].map((i) => eased(f, B1.pageP + 14 + i * 4, 14)),
      ring: eased(f, B2.rings.P, B2.ringDur) * (1 - eased(f, B5.reflected + 4, 12)),
      ringBreath: settleBreath(B2.rings.P),
      scan: bell(f, B4.scanPulse + 3, 10),
      adRoll,
      boRing: eased(f, B5.pChip, 14),
      boChip: f < B5.pChip ? 0 : sp(f, B5.pChip, SPR.soft),
      boMorph: mph(f, B7.chipMorph),
    },
    A: {
      lines: [0, 1, 2].map((i) => eased(f, B1.enter.A + 14 + i * 4, 16)),
      typed: Math.max(0, Math.min(AGENT.inboxEmpty.length, Math.floor((f - B1.typeA) / 3) + 1)),
      caret: blink(f, 2 * BEAT),
      slotBorder: f >= B3.brief ? 1 : 0,
      emptyOut: brief.out,
      briefIn: f < brief.inStart ? 0 : sp(f, brief.inStart, SPR.soft),
      briefOut: prog(f, B5.typing.start - 6, 4),
      typed2,
      reflected: f < B5.reflected ? 0 : sp(f, B5.reflected, SPR.soft),
      slotGlow: Math.max(bell(f, B3.brief + 14, 20), 0.6 * bell(f, B5.reflected + 8, 16)),
    },
    V: {
      rows: [eased(f, B7.rows[0], B7.rowDur), eased(f, B7.vGrow.start, B7.vGrow.end - B7.vGrow.start), eased(f, B7.rows[1], B7.rowDur), eased(f, B7.rows[2], B7.rowDur)],
      decision: eased(f, B7.vGrow.start + 6, 8),
    },
  };
};

// ---- light amounts (pool / lit edge / dim / dof)
export const pmLitAt = (f: number) => eased(f, B3.pmTile, 12, EASE.out);
export const capNearMAt = (f: number) => (f < B2.capsuleForm ? 0 : 1 - eased(f, B2.capsuleMoveStart, B2.capsuleMoveEnd + 30 - B2.capsuleMoveStart, EASE.soft));
const pScan = (f: number) => eased(f, B4.scan.end - 6, 16, EASE.out);
export const litAt = (f: number) => ({
  M: Math.max(0.55 * capNearMAt(f) * eased(f, B2.capsuleForm, 10), pmLitAt(f)),
  D: eased(f, B3.threadD.end - 6, 16, EASE.out),
  S: eased(f, B3.threadS.end - 6, 16, EASE.out),
  P: 0.5 * pScan(f) + 0.5 * e(f, B7.even), // half pool after the scan (reflection pending); full once everything is even
  A: eased(f, B3.threadA.end - 6, 16, EASE.out),
});
/** pools breathe with the beat on lit surfaces (1 on every beat, so f600 / f1440 keep the approved stills) */
export const poolBreath = (f: number) => 0.93 + 0.07 * (0.5 + 0.5 * Math.cos((2 * Math.PI * f) / BEAT)); // smooth (no jump on the beat)
export const evenAt = (f: number) => e(f, B7.even);
export const poolFadeAt = (f: number) => 1 - e(f, C.recede, EASE.soft); // closing: the light leaves the walls
export const dimPAt = (f: number) => EASE.soft(prog(f, B3.dimP.start, B3.dimP.end - B3.dimP.start)) * (1 - 0.5 * pScan(f)) * (1 - e(f, B7.even));
export const dofAAt = (f: number, from: number) => lerp(from, 1.5, eased(f, B3.threadA.end - 12, 16, EASE.out)) - 0.3 * evenAt(f);
export const dofPAt = (f: number, from: number) => lerp(from, 1.2, evenAt(f));
/** rack focus (B6): everything but S pushes into depth, then releases; the closing recede reuses it for all surfaces */
export const rackAt = (f: number) => e(f, B6.rackIn, EASE.out) * (1 - e(f, B6.rackOut, EASE.inout));
export const recedeAt = (f: number) => e(f, C.recede, EASE.inout);
export const capGlowAt = (f: number) => (f < B2.capsuleForm ? 0 : 1 - eased(f, B3.absorb.start, B3.absorb.end - B3.absorb.start, EASE.in));
export const capsuleAppearAt = (f: number) => (f < B2.capsuleForm - 2 ? 0 : sp(f, B2.capsuleForm - 2, SPR.snappy, 14));
export const glowAt = (f: number) => 0.8 * bell(f, B3.pulse, B3.pulseHalf);

/** afterglow of the earlier threads: faint through B6, .4 once B7 lights everything evenly */
export const afterglowAt = (f: number) => 0.12 * e(f, B5.afterglow) + 0.28 * e(f, B7.afterglow) * (1 - e(f, C.converge, EASE.soft)) + 0.6 * e(f, C.converge, EASE.soft);
/** the full-strength threads (B3 branches, scan, B5 thread) fade into the afterglow routes */
export const threadFadeAt = (f: number) => 1 - e(f, B5.afterglow, EASE.soft);

// ---- thread tips: snappy leading edge, smooth body (spring pair)
const ARRIVED = 0.995;
const arrivalCache = new Map<number, number>();
/** spring duration (frames) so the snappy tip has landed (>= ARRIVED) exactly `dur` frames after it leaves */
export const snappyDurFor = (dur: number) => {
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
/** a snappy spring landing exactly at `end` (wordmark tracking, capsule moves) */
export const landAt = (f: number, start: number, end: number) => (f < start ? 0 : sp(f, start, SPR.snappy, snappyDurFor(end - start)));

// ---- headline word progress
/** each word's window is stretched by 1/LAND so the last word has visibly landed (>= .98) on the settle frame */
const win = (f: number, start: number, settle: number) => EASE.out(prog(f, start, (settle - start) / LAND));
const words = (f: number, n: number, h: {reveal: number; settle: number; stagger: number}) => [...Array(n).keys()].map((i) => win(f, h.reveal + i * h.stagger, h.settle));
const exitOf = (f: number, h: {exit: number; exitDur: number}) => EASE.in(prog(f, h.exit, h.exitDur));

export const headlineAt = (f: number) => {
  const b2Exit = exitOf(f, B2.headline);
  return {
    b1: {enter: words(f, 4, B1.headline), exit: exitOf(f, B1.headline)},
    b2: {enter: words(f, 4, B2.headline), exit: [0, b2Exit, b2Exit, b2Exit]},
    b3: {
      enter: [0, 1, 2, 3].map((i) => (i === 2 ? 1 : win(f, B3.headline.enter[i], B3.headline.settle))),
      exit: EASE.in(prog(f, B3.headline.exit, B3.headline.exitDur)),
    },
    b4: {enter: words(f, 4, B4.headline), exit: exitOf(f, B4.headline)},
    b5: {enter: words(f, 3, B5.headline), exit: exitOf(f, B5.headline)},
    b6: {enter: words(f, 3, B6.headline), exit: exitOf(f, B6.headline)},
    b7: {enter: words(f, 3, B7.headline), exit: exitOf(f, B7.headline)},
    c: {
      enter: words(f, 4, {reveal: C.headline.reveal, settle: C.headline.settle, stagger: C.headline.stagger}),
      squeeze: EASE.out(prog(f, C.headline.morph, 12)), // tracking tightens
      out: prog(f, C.headline.morph + 8, 4), // headline leaves (4f) ...
      wordmark: landAt(f, C.headline.morph + 14, C.headline.land), // ... and the wordmark lands 2f later, exactly on the final hit
    },
  };
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
    'B2 headline exit': h.b2.exit[1],
    'B3 PM tile lights': a.M.pm,
    'B3 headline settle': h.b3.enter[0],
    'B3 thread M->D ends': threadAt(B3.threadD, f).head,
    'B3 pin opens': a.D.card,
    'B3 headline exit': h.b3.exit,
    'B3 reply 전달됨': a.S.reply,
    'B3 brief arrives': a.A.briefIn,
    'B3 pulse peak': glowAt(f) / 0.8,
    'B4 scan thread lands': threadAt(B4.scan, f).head,
    'B4 card rises': a.S.card.pop,
    'B4 headline settle': h.b4.enter[3],
    'B4 headline exit': h.b4.exit,
    'B4 click press': a.S.card.press,
    'B4 chip -> 확정': a.S.card.chip.in,
    'B5 thread -> A lands': threadAt(B5.threadA, f).head,
    'B5 반영됨 chip (A)': a.A.reflected,
    'B5 banner roll': a.D.roll[0],
    'B5 D chip 반영됨': a.D.chipMorph.in,
    'B5 P chip': a.P.boChip,
    'B5 memo': a.S.memo,
    'B5 headline settle': h.b5.enter[2],
    'B5 headline exit': h.b5.exit,
    'B6 date flip': capsuleDateAt(f).t,
    'B6 rack focus': rackAt(f),
    'B6 minho': a.S.minho,
    'B6 answer': a.S.answer,
    'B6 reverse thread lands': threadAt(B6.reverse, f).head,
    'B6 headline settle': h.b6.enter[2],
    'B6 headline exit': h.b6.exit,
    'B7 capsule -> V row': a.V.decision,
    'B7 V row 目標': a.V.rows[0],
    'B7 headline settle': h.b7.enter[2],
    'B7 headline exit': h.b7.exit,
    'C headline settle': h.c.enter[3],
    'C headline morph starts': h.c.squeeze,
    'C wordmark lands': h.c.wordmark,
  };
};

void clamp01;
