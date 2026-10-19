// v5 film timeline (storyboard-v5.md §3 / §4): THE one table of event frames.
// Beat boundaries come from public/audio/timing.json (via ./timing); every event
// is `beat start + offset` so nothing else in the code base carries a frame number.
// Offsets are written exactly as in the storyboard (absolute frame = beat start + offset).
import timingJson from '../../public/audio/timing.json';
import {atBeat} from './timing';
import type {BeatId} from './timing';

const at = (beat: BeatId, off: number) => atBeat(beat, off);

// ------------------------------------------------------------------ B1 (f0-180)
export const B1 = {
  // S bubbles: the first one is already mid-pop at f0 (first frame reads as a still)
  bubble: [at('B1', -6), at('B1', 12), at('B1', 24), at('B1', 36)],
  // the other four surfaces arrive on arcs from deep Z; stagger 10f, each its own entrance style
  enter: {D: at('B1', 6), M: at('B1', 16), P: at('B1', 26), A: at('B1', 36)},
  enterDur: 46,
  unfoldD: at('B1', 38), // artboard unfolds (scaleY)
  tilesM: at('B1', 50), // tiles pop on a grid, tileStagger apart
  tileStagger: 5,
  pageP: at('B1', 56), // document page slides in, rows follow
  typeA: at('B1', 66), // cursor types one line in the shared inbox slot
  headline: {reveal: at('B1', 15), settle: at('B1', 45), exit: at('B1', 150), exitDur: 6, stagger: 4},
  camSettle: at('B1', 45),
  still: at('B1', 140), // = the approved TA-B1f140 style frame
  camEnd: at('B1', 150),
  camMoveStart: at('B1', 156), // the single eased move of the scene: dolly toward M (ends on the bar line)
  camMoveEnd: at('B2', 0),
};

// ------------------------------------------------------------------ B2 (f180-360)
export const B2 = {
  chip1: at('B2', 0), // "결정 · 출시일 11/6" in M's caption band
  chip2: at('B2', 15), // "이유 · 인증 심사 지연"
  capsuleForm: at('B2', 30), // chips fold into the capsule (out 4f, in 2f later)
  capsuleMoveStart: at('B2', 36),
  capsuleMoveEnd: at('B2', 66), // trucks with the camera (<=40f)
  camMoveStart: at('B2', 30),
  camMoveEnd: at('B2', 66),
  spread: {start: at('B2', 60), end: at('B2', 90), px: 40}, // gaps open by ~40px
  dashed: [at('B2', 75), at('B2', 82), at('B2', 90)], // D, S, P (f255 / f262 / f270)
  dashGrow: 12,
  dashHang: 8,
  dashFall: 18,
  rings: {D: at('B2', 90), S: at('B2', 98), P: at('B2', 105)}, // amber rings, one by one
  ringDur: 14,
  headline: {reveal: at('B2', 100), settle: at('B2', 120), exit: at('B2', 176), exitDur: 6, stagger: 3}, // "맥락은" stays
};

// ------------------------------------------------------------------ B3 (f360-660)
export const B3 = {
  pmTile: at('B3', 0), // PM Agent tile lights (music motif entry)
  swap: {start: at('B3', 0), glideEnd: at('B3', 14), morph: at('B3', 14), settle: at('B3', 30)}, // T-type: "맥락은" -> "맥락을"
  absorb: {start: at('B3', 15), end: at('B3', 30)}, // capsule flies into the PM tile
  spreadBack: {start: at('B3', 0), end: at('B3', 30)},
  threadD: {start: at('B3', 30), end: at('B3', 60)}, // M -> D, camera still
  pin: at('B3', 60), // D comment pin opens + "전달됨"
  dimP: {start: at('B3', 60), end: at('B3', 90)}, // the untouched surface stays dark
  rowSwap: {start: at('B3', 111), end: at('B3', 127)}, // S: first message scrolls out, reply row makes room
  threadS: {start: at('B3', 105), end: at('B3', 135)},
  reply: at('B3', 135), // PM Agent reply + "전달됨"
  threadA: {start: at('B3', 150), end: at('B3', 180)},
  camMove: {start: at('B3', 145), end: at('B3', 180)}, // follows the thread tip to A (35f)
  brief: at('B3', 180), // capsule arrives in the shared inbox (downbeat f540)
  pulse: at('B3', 240), // the one glow pulse (downbeat f600)
  pulseHalf: 16,
  headline: {enter: [at('B3', 12), at('B3', 16), at('B3', 0), at('B3', 20)], settle: at('B3', 30), exit: at('B3', 90), exitDur: 6}, // [PM, Agent가, (맥락을 = traveller), 잇는다]
  wordGlide: 14,
};

export const BEAT_END = at('B3', 300); // f660: end of stage 1

// ------------------------------------------------------------------ B4 (f660-900): conflict + human decision
export const B4 = {
  camMove: {start: at('B4', 0), end: at('B4', 40)}, // the scene's one T-cam move: between P and S, pitch relaxes, push-in toward the card
  scan: {start: at('B4', 15), end: at('B4', 30)}, // thread M -> P ad row (f690 = check pulse)
  scanPulse: at('B4', 30),
  rowsOut: {start: at('B4', 30), end: at('B4', 45)}, // S: 서연 / 도윤 rows make room
  card: at('B4', 45), // decision card floats up (f705)
  cardDur: 18,
  headline: {reveal: at('B4', 60), settle: at('B4', 75), exit: at('B4', 132), exitDur: 6, stagger: 3}, // f735 -> f792
  cursorIn: at('B4', 80), // 지은's cursor appears near the card
  approach: {start: at('B4', 138), end: at('B4', 150)}, // stop-time f798-810: only the cursor decelerates
  click: at('B4', 150), // f810 music accent
  morph: at('B4', 158), // f818 chip 제안 -> 확정 · 지은, card lights solid, the beat's one bounce
};

// ------------------------------------------------------------------ B5 (f900-1080): follow-through
export const B5 = {
  camMove: {start: at('B5', 0), end: at('B5', 18)}, // truck right: S, A, D
  threadA: {start: at('B5', 15), end: at('B5', 45)}, // confirmed card -> A shared inbox
  briefOut: at('B5', 30), // old brief chip leaves, typing starts (f930)
  typing: {start: at('B5', 30), perChar: 2},
  reflected: at('B5', 60), // f960 chip 반영됨, P ad date flips
  roll: {start: at('B5', 75), dur: 25, stagger: 3}, // f975-1000 banner 10.30 -> 11.06
  dChip: at('B5', 100), // f1000 전달됨 -> 반영됨
  pChip: at('B5', 105), // f1005 P 보도자료 chip
  memo: at('B5', 120), // f1020 PM memo
  rowsOut: {start: at('B5', 110), end: at('B5', 124)},
  headline: {reveal: at('B5', 105), settle: at('B5', 120), exit: at('B5', 168), exitDur: 6, stagger: 3}, // f1020 -> f1068
  afterglow: {start: at('B5', 150), end: at('B6', 0)},
  cursorToBanner: {start: at('B5', 55), end: at('B5', 75)},
};

// ------------------------------------------------------------------ B6 (f1080-1320): memory
export const B6 = {
  capsuleOut: {start: at('B6', -24), end: at('B6', 0)}, // capsule re-emerges from the PM tile into M's caption band
  flip: {start: at('B6', 0), end: at('B6', 24)}, // date field 10/14 -> 2주 뒤
  rackIn: {start: at('B6', 0), end: at('B6', 24)},
  rackOut: {start: at('B6', 120), end: at('B6', 144)},
  forward: {start: at('B6', 24), end: at('B6', 48)}, // S steps forward
  back: {start: at('B6', 120), end: at('B6', 144)},
  rowsOut: {start: at('B6', 30), end: at('B6', 45)},
  minho: at('B6', 45), // f1125
  answer: at('B6', 75), // f1155
  source: at('B6', 83), // source chip
  capsuleToS: {start: at('B6', 24), end: at('B6', 60)},
  reverse: {start: at('B6', 90), end: at('B6', 120)}, // f1170-1200, drawn from the source chip back to M
  capsuleBack: {start: at('B6', 90), end: at('B6', 135)}, // settles in M's band f1215
  flipBack: {start: at('B6', 135), end: at('B6', 150)},
  orbit: {start: at('B6', 20), end: at('B6', 120)},
  headline: {reveal: at('B6', 135), settle: at('B6', 150), exit: at('B6', 210), exitDur: 6, stagger: 3}, // f1230 -> f1290
};

// ------------------------------------------------------------------ B7 (f1320-1500): context view
export const B7 = {
  camMove: {start: at('B7', 0), end: at('B7', 24)}, // pull back + rise
  even: {start: at('B7', 0), end: at('B7', 40)}, // pools merge into one key light
  afterglow: {start: at('B7', 0), end: at('B7', 60)},
  capsuleToV: {start: at('B7', 15), end: at('B7', 30)},
  vGrow: {start: at('B7', 30), end: at('B7', 45)},
  rows: [at('B7', 45), at('B7', 55), at('B7', 65)], // 목표 / 반영 / 다음 unfold from the 결정 row
  rowDur: 14,
  sources: {start: at('B7', 75), stagger: 6, dur: 18},
  headline: {reveal: at('B7', 78), settle: at('B7', 90), exit: at('B7', 135), exitDur: 6, stagger: 3}, // f1410 -> f1455
  chipMorph: at('B7', 15), // P chip 전달됨 · 반영 대기 -> 반영 대기
  still: at('B7', 120), // = the approved TA-B7f1440 style frame
};

// ------------------------------------------------------------------ Closing (f1500-1680)
export const C = {
  headline: {reveal: at('Closing', -36), settle: at('Closing', -20), morph: at('Closing', 36), land: at('Closing', 60), stagger: 4},
  recede: {start: at('Closing', 0), end: at('Closing', 30)},
  converge: {start: at('Closing', 0), end: at('Closing', 36)},
  underline: {start: at('Closing', 60), end: at('Closing', 75)},
  lockup: {start: at('Closing', 75), end: at('Closing', 90)},
  caption: at('Closing', 120),
  retreat: {start: at('Closing', 0), end: at('Closing', 60)},
};


// ------------------------------------------------------------------ SFX (names from timing.json "sfx")
export type SfxName = 'thread-draw' | 'capsule-arrive' | 'chip-morph' | 'click' | 'typing' | 'number-roll' | 'wordmark-land';
export interface SfxEvent {
  name: SfxName;
  frame: number;
  volume: number; // subtle: well under the music
  frames?: number; // trim length (typing loops)
  label: string;
}

export const SFX_EVENTS: SfxEvent[] = [
  {name: 'typing', frame: B1.typeA, volume: 0.35, frames: 18, label: 'B1 A types'},
  {name: 'chip-morph', frame: B2.chip1, volume: 0.65, label: 'B2 chip 1'},
  {name: 'chip-morph', frame: B2.chip2, volume: 0.65, label: 'B2 chip 2'},
  {name: 'chip-morph', frame: B2.capsuleForm, volume: 0.65, label: 'B2 capsule forms'},
  {name: 'click', frame: B2.dashed[0] + 20, volume: 0.6, label: 'B2 line 1 breaks'},
  {name: 'chip-morph', frame: B3.swap.morph, volume: 0.65, label: 'B3 word swap 은->을'},
  {name: 'capsule-arrive', frame: B3.absorb.end, volume: 0.75, label: 'B3 capsule absorbed'},
  {name: 'thread-draw', frame: B3.threadD.start, volume: 0.7, label: 'B3 thread M->D'},
  {name: 'click', frame: B3.pin, volume: 0.6, label: 'B3 pin opens'},
  {name: 'thread-draw', frame: B3.threadS.start, volume: 0.7, label: 'B3 thread ->S'},
  {name: 'chip-morph', frame: B3.reply, volume: 0.65, label: 'B3 reply 전달됨'},
  {name: 'thread-draw', frame: B3.threadA.start, volume: 0.7, label: 'B3 thread ->A'},
  {name: 'capsule-arrive', frame: B3.brief, volume: 0.75, label: 'B3 brief arrives (f540)'},
  // ---- stage 2
  {name: 'thread-draw', frame: B4.scan.start, volume: 0.5, label: 'B4 scan thread'},
  {name: 'chip-morph', frame: B4.card, volume: 0.55, label: 'B4 decision card rises'},
  {name: 'click', frame: B4.click, volume: 0.8, label: 'B4 click (music accent f810)'},
  {name: 'chip-morph', frame: B4.morph, volume: 0.7, label: 'B4 chip 제안 -> 확정'},
  {name: 'thread-draw', frame: B5.threadA.start, volume: 0.6, label: 'B5 thread -> A'},
  {name: 'typing', frame: B5.typing.start, volume: 0.35, frames: 26, label: 'B5 A types'},
  {name: 'chip-morph', frame: B5.reflected, volume: 0.65, label: 'B5 반영됨 (A) + P date flip'},
  {name: 'number-roll', frame: B5.roll.start, volume: 0.65, label: 'B5 banner number roll'},
  {name: 'chip-morph', frame: B5.dChip, volume: 0.6, label: 'B5 D chip 반영됨'},
  {name: 'chip-morph', frame: B5.pChip, volume: 0.5, label: 'B5 P chip 반영 대기'},
  {name: 'chip-morph', frame: B6.flip.start, volume: 0.6, label: 'B6 capsule date flip'},
  {name: 'chip-morph', frame: B6.answer, volume: 0.55, label: 'B6 PM answer'},
  {name: 'thread-draw', frame: B6.reverse.start, volume: 0.6, label: 'B6 reverse thread'},
  {name: 'capsule-arrive', frame: B6.capsuleBack.end, volume: 0.7, label: 'B6 capsule lands in M'},
  {name: 'capsule-arrive', frame: B7.capsuleToV.end, volume: 0.65, label: 'B7 capsule reaches V'},
  {name: 'chip-morph', frame: B7.rows[0], volume: 0.45, label: 'B7 V row 1'},
  {name: 'chip-morph', frame: B7.rows[1], volume: 0.45, label: 'B7 V row 2'},
  {name: 'chip-morph', frame: B7.rows[2], volume: 0.45, label: 'B7 V row 3'},
  {name: 'chip-morph', frame: C.headline.morph, volume: 0.5, label: 'C headline morph starts'},
  {name: 'wordmark-land', frame: C.headline.land, volume: 0.8, label: 'C wordmark lands (f1560)'},
];

export const sfxFile = (name: SfxName) => {
  const rec = timingJson.sfx.find((s) => s.file.endsWith(`/${name}.wav`));
  if (!rec) throw new Error(`[v5 timeline] sfx ${name} missing in timing.json`);
  return rec;
};

// events the sync check (QA d) compares against timing.json targets: label, frame of the visible/audible event
export const SYNC_EVENTS: {label: string; frame: number; target: number}[] = [
  {label: 'B1 headline settle (beat)', frame: B1.headline.settle, target: 45},
  {label: 'B1 headline exit (beat)', frame: B1.headline.exit, target: 150},
  {label: 'B1 camera move ends on bar line', frame: B1.camMoveEnd, target: 180},
  {label: 'B2 chip 1 (bar line)', frame: B2.chip1, target: 180},
  {label: 'B2 capsule forms', frame: B2.capsuleForm, target: 210},
  {label: 'B2 dashed 1 / 3 (beats)', frame: B2.dashed[0], target: 255},
  {label: 'B2 ring D (beat)', frame: B2.rings.D, target: 270},
  {label: 'B2 ring P (beat)', frame: B2.rings.P, target: 285},
  {label: 'B2 headline settle (bar line)', frame: B2.headline.settle, target: 300},
  {label: 'B3 PM tile + word swap (motif entry)', frame: B3.pmTile, target: 360},
  {label: 'B3 headline settle', frame: B3.headline.settle, target: 390},
  {label: 'B3 thread M->D ends on bar line', frame: B3.threadD.end, target: 420},
  {label: 'B3 pin opens (bar line)', frame: B3.pin, target: 420},
  {label: 'B3 headline exit', frame: B3.headline.exit, target: 450},
  {label: 'B3 reply 전달됨', frame: B3.reply, target: 495},
  {label: 'B3 capsule arrives (bar line)', frame: B3.brief, target: 540},
  {label: 'B3 pulse (bar line)', frame: B3.pulse, target: 600},
];
