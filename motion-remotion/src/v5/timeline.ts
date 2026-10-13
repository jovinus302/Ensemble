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

export const BEAT_END = at('B3', 300); // f660: end of stage 1 (later beats are placeholder holds)

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
