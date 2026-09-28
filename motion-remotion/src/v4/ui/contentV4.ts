// v4 timeline content (design-v4 r3 B, "착지 즉시 PM이 답한다"). v3's
// content.ts is untouched; this layers one new message on top of it.
//
// M1b — the AI PM's reply to 김도윤's goal (M1), shown right after the board
// lands. PM voice (DESIGN.md: 누가 · 무엇을 · 언제 · 무엇이 필요한가, no hype).
// It promises the plan rather than announcing started work, because beat ②
// then shows that plan still waiting for approval ("승인 필요", "계획 승인").
//
// Placement: M1's visible rows end at contentY 89 (name 24 + 2 + one text
// line 23 from 40), so M1b sits at 101 (12 gap). The pmBubble layout is
// avatar 40 / name 24 + 4 + bubble 43 = 71 tall -> 101–172. Every later
// message (M2…M15) moves down by MESSAGE_SHIFT so M2's plan card starts at
// 184, 12 below M1b. Frames that need the old board positions of M2+ add
// MESSAGE_SHIFT to their scrollY.
import {MESSAGES} from '../../v3/ui/content';
import type {TimelineMessage} from '../../v3/ui/content';

export const MESSAGE_SHIFT = 42;

export const PM_REPLY: TimelineMessage = {
  id: 'M1b',
  contentY: [101, 172],
  appearFrame: 0, // visibility is driven by BoardV4's `pmReply` progress, not the v3 frame clock
  beatTag: 'O',
  content: {kind: 'pmBubble', time: '', text: '담당과 순서는 제가 정리할게요. 계획을 곧 올립니다.'},
};

export const MESSAGES_V4: TimelineMessage[] = MESSAGES.flatMap((m) => {
  if (m.id === 'divider' || m.id === 'M1') return [m];
  return [{...m, contentY: [m.contentY[0] + MESSAGE_SHIFT, m.contentY[1] + MESSAGE_SHIFT] as [number, number]}];
});

export const messageByIdV4 = (id: string) => (id === PM_REPLY.id ? PM_REPLY : MESSAGES_V4.find((m) => m.id === id)!);
