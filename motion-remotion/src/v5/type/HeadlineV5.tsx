// v5 headline, settled state only (no reveal): color / accent / size are theme
// props. Words listed in `accentWords` take the accent color. An optional
// cursor (theme R) ends the line.
import React from 'react';
import {FONT_FAMILY} from '../../tokens/fonts';
import {Cursor} from '../surfaces/theme';

export const HeadlineV5: React.FC<{
  copy: string;
  accentWords?: number; // how many leading words are accented
  color: string;
  accent: string;
  fontSize: number;
  width: number;
  cursor?: string;
}> = ({copy, accentWords = 0, color, accent, fontSize, width, cursor}) => {
  const words = copy.split(' ');
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.32em',
        width,
        fontFamily: FONT_FAMILY,
        fontWeight: 800,
        fontSize,
        lineHeight: 1.02,
        letterSpacing: '-0.035em',
        color,
      }}
    >
      {words.map((w, i) => (
        <span key={i} style={{display: 'inline-block', color: i < accentWords ? accent : undefined}}>
          {w}
          {cursor && i === words.length - 1 && <Cursor color={cursor} />}
        </span>
      ))}
    </div>
  );
};
