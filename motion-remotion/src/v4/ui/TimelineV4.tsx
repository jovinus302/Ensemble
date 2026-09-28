// Copy of src/v3/ui/Timeline.tsx (v3 file left untouched per design-v4 §4/§9).
// One behavioral difference: `excludeIds` — the beat's hero message is not
// drawn in the flat timeline because v4 draws it once, in the hero layer
// (HeroLift), with its own scale/Z/shadow. Everything else renders through
// v3's MessageRenderer, flat (no v3 Riser: hero=false for every row).
import React from 'react';
import {MESSAGES, contentYToBoardY, AREAS} from '../../v3/ui/content';
import {MessageRenderer} from '../../v3/ui/messages/MessageRenderer';

export interface TimelineV4Props {
  frame: number;
  scrollY: number;
  excludeIds?: string[];
}

export const TimelineV4: React.FC<TimelineV4Props> = ({frame, scrollY, excludeIds = []}) => {
  const {y0: vy0, y1: vy1} = AREAS.timelineViewport;
  return (
    <>
      {MESSAGES.filter((m) => frame >= m.appearFrame && !excludeIds.includes(m.id)).map((m) => {
        const boardY = contentYToBoardY(m.contentY[0], scrollY);
        const boardYEnd = contentYToBoardY(m.contentY[1], scrollY);
        if (boardYEnd < vy0 - 40 || boardY > vy1 + 40) return null;
        const fade = boardY < vy0 + 16 ? Math.max(0, Math.min(1, (boardY - vy0) / 16)) : 1;
        const content = <MessageRenderer msg={m} boardY={boardY} frame={frame} />;
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
