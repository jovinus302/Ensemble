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

/** chip morph: out 4f (.96 + fade), the new chip starts 2f after that */
export interface Morph {
  out: number;
  in: number;
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
    cursor: {x: number; y: number; a: number; toBanner: number}; // a collaborator's cursor; toBanner 0..1 blends the drift toward the banner date
    pin1: number; // "1" pin visibility
    card: number; // PM comment card open
    cardPin: number; // PM pin pop
    cardChip: number; // chip pop (전달됨)
    roll: number[]; // 3 digits of the banner date: 0 = 10.30, 1 = 11.06 (odometer roll per changing digit)
    chipMorph: Morph; // 전달됨 -> 반영됨 (also swaps the card sentence)
  };
  S: {
    bubble: number[]; // pop spring per original message (도윤1, 지은, 서연, 도윤2); may overshoot
    typing: number[]; // typing-dots bubble visibility before bubbles 서연, 도윤2 and the first replies (index = message 1..3)
    amber: number; // amber ring on 지은's question
    amberBreath: number;
    open: {do1: number; ji: number; reply: number; seo: number; do2: number; card: number; memo: number; minho: number; answer: number};
    reply: number; // reply bubble pop
    badge: number; // "전달됨" pop
    caret: number; // 0/1 blink
    send: number; // 0..1 beat kick
    dots: number; // frame, for the typing dots in the composer
    card: {pop: number; lit: number; solid: number; press: number; bounce: number; chip: Morph};
    cursor: {a: number; near: number; frame: number}; // 지은's cursor: near 0..1 = decelerating approach to [옮기기]
    memo: number;
    minho: number;
    answer: number;
    source: number;
  };
  P: {
    page: number; // slide-in
    rows: number[]; // 3 schedule rows
    ring: number; // amber ring on "광고 집행"
    ringBreath: number;
    scan: number; // 0..1 check pulse on the ad row (B4)
    adRoll: number; // ad date 11/1 -> 11/6
    boRing: number; // amber on 보도자료 배포 (B5)
    boChip: number; // chip pop
    boMorph: Morph; // 전달됨 · 반영 대기 -> 반영 대기
  };
  A: {
    lines: number[]; // 3 private lines scaleX
    typed: number; // characters typed into the inbox slot (empty prompt)
    caret: number; // 0/1 blink
    slotBorder: number; // 0 dashed idle .. 1 solid mint
    emptyOut: number; // 0..1 empty text leaves (4f)
    briefIn: number; // 0..1 brief chip in (2f after out)
    briefOut: number; // 0..1 brief chip leaves (B5 morph)
    typed2: number; // characters of "광고 일정 11/6로 변경"
    reflected: number; // chip pop 반영됨
    slotGlow: number; // 0..1 soft glow when something lands in the slot
  };
  V: {
    rows: number[]; // 4 rows open 0..1 (row 1 = 결정 is the capsule's row)
    decision: number; // 결정 row content visible
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

/** the two halves of a morph as styles: outgoing (visible while out < 1) and incoming (visible once in > 0) */
export const morphOutStyle = (m: Morph): React.CSSProperties => ({opacity: 1 - m.out, transform: `scale(${1 - 0.04 * m.out})`});
export const morphInStyle = (m: Morph): React.CSSProperties => ({opacity: Math.min(1, m.in * 2), transform: `scale(${0.9 + 0.1 * Math.min(1, m.in)})`});
