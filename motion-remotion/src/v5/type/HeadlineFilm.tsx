// v5 film headline: words in a flex-wrap line (same metrics as HeadlineV5, so the
// settled state equals the style frame), each word inside its own mask. Enter =
// the word rises out of its mask, exit = it leaves through the top. Hidden words
// keep their space, so the line layout never jumps. Everything is driven by the
// per-word `enter` / `exit` progress passed in (pure function of the frame).
import React, {useLayoutEffect, useRef} from 'react';
import {FONT_FAMILY} from '../../tokens/fonts';

export interface FilmWord {
  text: string;
  accent?: boolean;
  enter: number; // 0..1
  exit: number; // 0..1
  hidden?: boolean; // keeps its space, paints nothing (a traveller word replaces it)
}

export const RevealWords: React.FC<{
  words: FilmWord[];
  color: string;
  accent: string;
  fontSize: number;
  width: number;
  justify?: 'flex-start' | 'center' | 'flex-end';
  tracking?: string; // letter-spacing (closing: tightens into the wordmark)
  opacity?: number;
  onRects?: (r: {x: number; y: number}[]) => void; // layout offsets of each word box inside this container (measured once)
}> = ({words, color, accent, fontSize, width, justify = 'flex-start', tracking = '-0.035em', opacity = 1, onRects}) => {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!onRects || !ref.current) return;
    onRects(Array.from(ref.current.children).map((el) => ({x: (el as HTMLElement).offsetLeft, y: (el as HTMLElement).offsetTop})));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: justify,
        gap: '0.32em',
        width,
        fontFamily: FONT_FAMILY,
        fontWeight: 800,
        fontSize,
        lineHeight: 1.02,
        letterSpacing: tracking,
        color,
        opacity,
      }}
    >
      {words.map((w, i) => (
        <WordBox key={i} {...w} accentColor={accent} />
      ))}
    </div>
  );
};

/** one masked word; also used on its own for the travelling word */
export const WordBox: React.FC<FilmWord & {accentColor: string; style?: React.CSSProperties; children?: React.ReactNode}> = ({text, accent, enter, exit, hidden, accentColor, style, children}) => {
  const y = (1 - enter) * 140 - exit * 140;
  return (
    <span style={{display: 'inline-block', overflow: 'hidden', padding: '0.12em 0.06em', margin: '-0.12em -0.06em', color: accent ? accentColor : undefined, visibility: hidden ? 'hidden' : 'visible', ...style}}>
      <span style={{display: 'inline-block', transform: `translateY(${y}%)`}}>{children ?? text}</span>
    </span>
  );
};
