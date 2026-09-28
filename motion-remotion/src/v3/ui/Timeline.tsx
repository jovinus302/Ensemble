// v3 §2/§6 — message list. Implements the preserve-3d-safe scroll approach
// (§6 대책1): no overflow:hidden on the scrollable region; instead (a) an
// opaque channel-header band (Z+4) covers anything scrolled above y=64, (b)
// messages entering the y<80 band fade via plain opacity (safe: these are
// leaf/non-preserve-3d divs), (c) messages fully outside the viewport are not
// rendered at all (frame culling).
import React from 'react';
import {MESSAGES, contentYToBoardY, AREAS} from './content';
import {MessageRenderer} from './messages/MessageRenderer';

export interface TimelineProps {
  frame: number;
  scrollY: number;
  heroId?: string;
  heroZ?: number;
  glowId?: string;
}

export const Timeline: React.FC<TimelineProps> = ({frame, scrollY, heroId, heroZ, glowId}) => {
  const {y0: vy0, y1: vy1} = AREAS.timelineViewport;

  return (
    <>
      {MESSAGES.filter((m) => frame >= m.appearFrame).map((m) => {
        const boardY = contentYToBoardY(m.contentY[0], scrollY);
        const boardYEnd = contentYToBoardY(m.contentY[1], scrollY);
        if (boardYEnd < vy0 - 40 || boardY > vy1 + 40) return null; // culled, not in viewport
        const isHero = heroId === m.id;
        // §6 대책1(b): fade messages entering the top band — but never wrap a
        // hero (z>0) card in an opacity div, since that div is flat-by-default
        // and would flatten the card's translateZ per the preserve-3d rule.
        // Non-hero rows are z=0 already, so flattening them changes nothing.
        const fade = !isHero && boardY < vy0 + 16 ? Math.max(0, Math.min(1, (boardY - vy0) / 16)) : 1;
        const content = <MessageRenderer msg={m} boardY={boardY} frame={frame} hero={isHero} heroZ={heroZ} glow={glowId === m.id} />;
        return fade < 1 ? (
          <div key={m.id} style={{opacity: fade}}>
            {content}
          </div>
        ) : (
          <React.Fragment key={m.id}>{content}</React.Fragment>
        );
      })}
    </>
  );
};
