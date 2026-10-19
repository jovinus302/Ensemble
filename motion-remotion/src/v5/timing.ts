// v5 timing: every beat boundary / accent frame comes from public/audio/timing.json
// (music is the master clock, storyboard-v5.md §1.5). No frame numbers are
// hard-coded here; event offsets inside a beat are added by later rounds as
// offsets from `beatStart(id)`.
import timing from '../../public/audio/timing.json';

export const FPS = timing.fps;
export const FRAMES_PER_BAR = timing.framesPerBar;
export const FRAMES_PER_BEAT = FRAMES_PER_BAR / 4;
export const TOTAL_FRAMES = timing.totalFrames;
export const TEASER_FRAMES = timing.teaser.totalFrames;

export type BeatId = 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6' | 'B7' | 'Closing';

const section = (id: BeatId) => {
  const s = timing.sections.find((x) => x.id === id);
  if (!s) throw new Error(`[v5 timing] unknown section ${id}`);
  return s;
};

export const beatStart = (id: BeatId) => section(id).startFrame;
export const beatEnd = (id: BeatId) => section(id).endFrame;
/** absolute frame of an event given as an offset from the beat start */
export const atBeat = (id: BeatId, offset: number) => beatStart(id) + offset;

export const DOWNBEATS: readonly number[] = timing.downbeats;
export const isDownbeat = (f: number) => DOWNBEATS.includes(f);
export const isBeat = (f: number) => f % FRAMES_PER_BEAT === 0;

export const accentFrame = (label: string, teaser = false) => {
  const list = teaser ? timing.teaser.accents : timing.accents;
  const a = list.find((x) => x.label === label);
  if (!a) throw new Error(`[v5 timing] unknown accent ${label}`);
  return a.plannedFrame;
};
