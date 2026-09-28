// Copy of src/v3/ui/Timeline.tsx (v3 file left untouched per design-v4 §4/§9).
// Behavioral differences:
//  - `excludeIds`: the beat's hero message is not drawn in the flat timeline
//    because v4 draws it once, in the hero layer (HeroLift);
//  - messages come from contentV4 (M2+ shifted down to make room for M1b);
//  - M1b (the AI PM's landing reply) is drawn with `pmReply` progress 0..1
//    (opacity + a 12-logical-px rise) instead of the v3 appearFrame clock.
// Rows render through MessageRendererV4, flat (no v3 Riser).
import React from 'react';
import {contentYToBoardY, AREAS} from '../../v3/ui/content';
import {MessageRendererV4} from './messages/MessageRendererV4';
import {MESSAGES_V4, PM_REPLY} from './contentV4';
import {px} from '../../v3/tokens/video';

export interface TimelineV4Props {
  frame: number;
  scrollY: number;
  excludeIds?: string[];
  pmReply?: number; // 0 = not posted yet, 1 = fully shown
  approvedIds?: string[]; // round D: cards drawn in their approved state (product-state driven)
}

export const TimelineV4: React.FC<TimelineV4Props> = ({frame, scrollY, excludeIds = [], pmReply = 1, approvedIds = []}) => {
  const {y0: vy0, y1: vy1} = AREAS.timelineViewport;
  const reply = pmReply > 0 ? [PM_REPLY] : [];
  return (
    <>
      {[...MESSAGES_V4.filter((m) => frame >= m.appearFrame), ...reply]
        .filter((m) => !excludeIds.includes(m.id))
        .map((m) => (approvedIds.includes(m.id) && 'approved' in m.content ? {...m, content: {...m.content, approved: true}} : m))
        .map((m) => {
          const boardY = contentYToBoardY(m.contentY[0], scrollY);
          const boardYEnd = contentYToBoardY(m.contentY[1], scrollY);
          if (boardYEnd < vy0 - 40 || boardY > vy1 + 40) return null;
          const fade = boardY < vy0 + 16 ? Math.max(0, Math.min(1, (boardY - vy0) / 16)) : 1;
          const isReply = m.id === PM_REPLY.id;
          const opacity = fade * (isReply ? pmReply : 1);
          const rise = isReply ? (1 - pmReply) * 12 : 0;
          const content = <MessageRendererV4 msg={m} boardY={boardY} frame={frame} />;
          return opacity < 1 || rise > 0 ? (
            <div key={m.id} style={{opacity, transform: rise > 0 ? `translateY(${px(rise)}px)` : undefined}}>
              {content}
            </div>
          ) : (
            <React.Fragment key={m.id}>{content}</React.Fragment>
          );
        })}
    </>
  );
};
