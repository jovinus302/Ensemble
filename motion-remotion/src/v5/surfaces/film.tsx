// Film animation context for the v5 surface bodies. The style frames never
// provide it, so every body keeps its static render path byte-for-byte
// (StyleFrameV5 stills must stay reproducible). In PitchV5 the provider carries
// per-surface values that are pure functions of the current frame.
import React, {createContext, useContext} from 'react';

export interface ChipAnim {
  in: number; // 0..1 entrance (pop)
  out: number; // 0..1 exit (scale .96 + fade, 4f)
  type?: number; // 0..1 caption text reveal (live captions type in)
}

export interface FilmAnim {
  frame: number;
  M: {
    tile: number[]; // pop progress per tile in display order [도윤, PM, 지은, 서연]
    pm: number; // 0..1 PM Agent tile lit (harmony ring + avatar)
    pmAvatar: number; // avatar pop (may overshoot)
    pmPulse: number; // 0..1 one expanding ring when the tile lights
    band: number; // caption band open 0..1
    chip1: ChipAnim;
    chip2: ChipAnim;
    shimmer: number[]; // 0..1 sweep position per tile (micro motion), >1 = idle
    speaker: number[]; // 0..1 active-speaker outline per tile (beat-synced micro motion)
  };
  D: {
    unfold: number; // artboard scaleY
    sel: number; // selection frame
    ring: number; // amber ring on the banner date
    ringBreath: number; // 0..1 micro breathing
    cursor: {x: number; y: number; a: number}; // a collaborator's cursor drifting over the artboard (px in the canvas area), a = visibility
    pin1: number; // "1" pin visibility
    card: number; // PM comment card open
    cardPin: number; // PM pin pop
    cardChip: number; // "전달됨" chip pop
  };
  S: {
    bubble: number[]; // pop spring per original message (도윤1, 지은, 서연, 도윤2); may overshoot
    amber: number; // amber ring on 지은's question
    amberBreath: number;
    row1: number; // 1 -> 0: first message scrolls out
    replyRow: number; // 0 -> 1: room for the PM Agent reply row
    reply: number; // reply bubble pop
    badge: number; // "전달됨" pop
    caret: number; // 0/1 blink
    send: number; // 0..1 beat kick
    dots: number; // frame, for the typing dots in the composer
  };
  P: {
    page: number; // slide-in
    rows: number[]; // 3 schedule rows
    ring: number; // amber ring on "광고 집행"
    ringBreath: number;
  };
  A: {
    lines: number[]; // 3 private lines scaleX
    typed: number; // characters typed into the inbox slot
    caret: number; // 0/1 blink
    slotBorder: number; // 0 dashed idle .. 1 solid mint
    emptyOut: number; // 0..1 empty text leaves (4f)
    briefIn: number; // 0..1 brief chip in (2f after out)
  };
}

const Ctx = createContext<FilmAnim | undefined>(undefined);
export const FilmProvider = Ctx.Provider;
export const useFilm = () => useContext(Ctx);

/** a chip morph step: scale .96 + fade out, or pop in */
export const chipStyle = (c: ChipAnim): React.CSSProperties => ({
  opacity: Math.max(0, Math.min(1, c.in * (1 - c.out))),
  transform: `scale(${c.out > 0 ? 1 - 0.04 * c.out : 0.9 + 0.1 * Math.min(1, c.in)})`,
});
