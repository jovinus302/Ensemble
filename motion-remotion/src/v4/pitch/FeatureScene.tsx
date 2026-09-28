// PitchV4 after the opening (f388–1834): six frontal beats + closing, all
// driven by pitchTimeline.ts. Same layers as the stills: StageV4 (background +
// wall shadow + board rig), BoardV4 with the product state, veils, one hero in
// HeroLift, 2D callouts (Z-inclusive projection), headlines in the type layer.
import React from 'react';
import {Easing, interpolate} from 'remotion';
import {px} from '../../v3/tokens/video';
import {contentYToBoardY, AREAS, BOARD_H} from '../../v3/ui/content';
import type {TimelineMessage} from '../../v3/ui/content';
import {Veil} from '../../v3/fx/Veil';
import {GlowField} from '../../v3/fx/GlowField';
import {FONT_FAMILY} from '../../tokens/fonts';
import {colors, inkColor} from '../../v3/tokens/video';
import {StageV4, TypeLayer} from '../stage/StageV4';
import {BoardV4} from '../ui/BoardV4';
import {HeroLift} from '../ui/HeroLift';
import {CriterionHeroRow, criterionHeroRect} from '../ui/RightPanelV4';
import {MessageRendererV4, GOAL_CARD_H} from '../ui/messages/MessageRendererV4';
import {messageByIdV4} from '../ui/contentV4';
import {CalloutV4} from '../callouts/CalloutV4';
import {STATES} from '../stateV4';
import {assertHeldPose} from '../config';
import type {Rect} from '../stage/projectV4';
import {BeatHeadline} from './BeatHeadline';
import {cameraAt, stageAt, APPEAR_AT, revealAt, heroAt, HEADLINES, veilsAt, CLOSING} from './pitchTimeline';

const FOCUS_VEIL = 0.4; // same as the stills

// Hero card rect in board-logical px for a message at the current scroll.
const messageHeroRect = (m: TimelineMessage, scroll: number): Rect => {
  const y = contentYToBoardY(m.contentY[0], scroll);
  const h = m.contentY[1] - m.contentY[0];
  if (m.content.kind === 'planCard') return {x: 376, y, w: 440, h: 360}; // MessageRenderer's fitted plan card
  if (m.content.kind === 'goalCheckCard') return {x: 376, y, w: 632, h: Math.min(h, GOAL_CARD_H)};
  return {x: 376, y, w: 632, h};
};

// ---- callouts: [label, dot color, window, anchor fn, placement] ----
interface CalloutSpec {
  label: string;
  dot: string;
  from: number;
  to: number;
  side: 'left' | 'right';
  chipDx: number;
  chipDy: number;
  anchor: (scroll: number) => {x: number; y: number};
  onHero?: boolean; // anchor sits on the current hero card
}
const teamRowY = (i: number) => 360 + 20 + 10 + i * 54 + 22;
const M2_CARD_Y = (scroll: number) => contentYToBoardY(messageByIdV4('M2').contentY[0], scroll);
const planRowY = (scroll: number, i: number) => M2_CARD_Y(scroll) + 20 + 24 + 6 + 21 + 16 + i * 52 + 22 - 6; // as StyleFrameV4
const msgY = (id: string, scroll: number) => contentYToBoardY(messageByIdV4(id).contentY[0], scroll);
const C31 = criterionHeroRect('C3.1');

const CALLOUTS: CalloutSpec[] = [
  // ① team section (board plane); chips in the timeline's empty area
  {label: '사람 팀원', dot: '#CDBBA5', from: 446, to: 500, side: 'right', chipDx: 110, chipDy: 0, anchor: () => ({x: 344, y: teamRowY(1)})},
  {label: 'AI 팀원', dot: '#5B84EC', from: 470, to: 548, side: 'right', chipDx: 110, chipDy: 0, anchor: () => ({x: 344, y: teamRowY(3)})},
  {label: 'AI PM', dot: '#2B6A52', from: 500, to: 548, side: 'right', chipDx: 110, chipDy: 0, anchor: () => ({x: 344, y: teamRowY(0)})},
  // ② = SF2
  {label: '담당 자동 배정', dot: '#2B6A52', from: 634, to: 754, side: 'right', chipDx: 150, chipDy: -64, anchor: (s) => ({x: 732, y: planRowY(s, 0)}), onHero: true},
  {label: '선행 작업 대기', dot: '#9A5B00', from: 650, to: 754, side: 'right', chipDx: 84, chipDy: 64, anchor: (s) => ({x: 779, y: planRowY(s, 2)}), onHero: true},
  // ③ handoff card fields -> chips in the sidebar's empty band
  {label: '맥락 5요소', dot: '#2B6A52', from: 840, to: 968, side: 'left', chipDx: 60, chipDy: -69, anchor: (s) => ({x: 378, y: msgY('M10', s) + 72}), onHero: true},
  {label: '결정 이유까지', dot: '#2B6A52', from: 870, to: 968, side: 'left', chipDx: 60, chipDy: -33, anchor: (s) => ({x: 378, y: msgY('M10', s) + 130}), onHero: true},
  // ④ result -> PM check -> next owner starts (message avatars' left edge)
  {label: '사람의 결과', dot: '#B9C7BE', from: 1016, to: 1074, side: 'left', chipDx: 56, chipDy: -13, anchor: (s) => ({x: 376, y: msgY('M11', s) + 18})},
  {label: 'PM이 확인', dot: '#2B6A52', from: 1062, to: 1130, side: 'left', chipDx: 56, chipDy: -100, anchor: (s) => ({x: 376, y: msgY('M12', s) + 20})},
  {label: '자동 시작', dot: '#E5764F', from: 1110, to: 1226, side: 'left', chipDx: 56, chipDy: -192, anchor: (s) => ({x: 376, y: msgY('M13', s) + 18})},
  // ⑤ = SF3
  {label: '검증됨', dot: '#1E7F4F', from: 1364, to: 1460, side: 'right', chipDx: 120, chipDy: -96, anchor: () => ({x: C31.x + C31.w - 14, y: C31.y + C31.h / 2}), onHero: true},
  // ⑥ goal check card: remaining criterion chip, then the PM's next-step CTA
  {label: '남은 조건 1', dot: '#9A5B00', from: 1540, to: 1646, side: 'left', chipDx: 60, chipDy: -71, anchor: (s) => ({x: 378, y: msgY('M15', s) + 95}), onHero: true},
  {label: '다음 일 제안', dot: '#2B6A52', from: 1570, to: 1646, side: 'left', chipDx: 60, chipDy: -82, anchor: (s) => ({x: 378, y: msgY('M15', s) + 172}), onHero: true},
];
const CALLOUT_FADE = 8;

const Closing: React.FC<{frame: number}> = ({frame}) => {
  const {headline, wordmark, tagline} = CLOSING;
  const collapse = interpolate(frame, [headline.collapseFrom, headline.collapseTo], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.65, 0, 0.35, 1)});
  const wm = interpolate(frame, [wordmark.from, wordmark.settle], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.2, 0, 0, 1)});
  const tg = interpolate(frame, [tagline.enter, tagline.enter + 12], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.2, 0, 0, 1)});
  return (
    <>
      {frame >= headline.enter && collapse < 1 && (
        // the sentence gathers toward the wordmark: tracking tightens, scaleX -> 0, drifts to center
        <div style={{position: 'absolute', inset: 0, transformOrigin: '960px 123px', transform: `translateY(${collapse * 360}px) scaleX(${1 - collapse})`, opacity: 1 - collapse, letterSpacing: `${-0.1 * collapse}em`}}>
          <BeatHeadline copy={headline.copy} accent={['PM이']} variant="T1" align="center" enter={headline.enter} frame={frame} top={64} />
        </div>
      )}
      {wm > 0 && (
        <div style={{position: 'absolute', left: 0, width: 1920, top: 400, height: 180, overflow: 'hidden', display: 'flex', justifyContent: 'center'}}>
          <span style={{fontFamily: FONT_FAMILY, fontWeight: 600, fontSize: 150, lineHeight: '180px', letterSpacing: '-0.01em', color: colors.brandInk, transform: `translateY(${(1 - wm) * 100}%)`, display: 'inline-block'}}>ensemble</span>
        </div>
      )}
      {tg > 0 && (
        <div style={{position: 'absolute', left: 0, width: 1920, top: 610, textAlign: 'center', fontFamily: FONT_FAMILY, fontWeight: 600, fontSize: 36, color: inkColor, opacity: tg, transform: `translateY(${(1 - tg) * 16}px)`}}>
          {tagline.copy}
        </div>
      )}
    </>
  );
};

export const FeatureScene: React.FC<{frame: number}> = ({frame}) => {
  const cam = cameraAt(frame);
  const {pose, scroll} = cam;
  if (!cam.moving) assertHeldPose(`PitchV4 f${frame}`, pose);
  const state = STATES[stageAt(frame)];
  const veils = veilsAt(frame);
  const hero = heroAt(frame);
  const heroMsg = hero && hero.w.kind === 'message' ? messageByIdV4(hero.w.id) : null;
  const heroRect: Rect | null = hero ? (heroMsg ? messageHeroRect(heroMsg, scroll) : C31) : null;
  const heroInfo = hero && heroRect ? {card: heroRect, rise: hero.rise} : undefined;
  const heroReveal = heroMsg ? revealAt(frame)[heroMsg.id] ?? 1 : 1;
  const heroContent = heroMsg && state.approvedMessages.includes(heroMsg.id) && 'approved' in heroMsg.content ? {...heroMsg, content: {...heroMsg.content, approved: true}} : heroMsg;
  const boardFade = interpolate(frame, [CLOSING.boardFade.from, CLOSING.boardFade.to], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  const board = (
    <BoardV4
      frame={frame}
      scrollY={scroll}
      state={state}
      appearAt={APPEAR_AT}
      reveal={revealAt(frame)}
      heroMessageId={heroMsg?.id}
      heroRowId={hero && hero.w.kind === 'criterion' ? hero.w.id : undefined}
      overlay={
        <>
          {veils.sidebar > 0.001 && <Veil x={AREAS.sidebar.x0} y={0} w={AREAS.sidebar.x1 - AREAS.sidebar.x0} h={BOARD_H} amount={veils.sidebar} maxOpacity={FOCUS_VEIL} />}
          {veils.main > 0.001 && <Veil x={AREAS.main.x0} y={0} w={AREAS.main.x1 - AREAS.main.x0} h={BOARD_H} amount={veils.main} maxOpacity={FOCUS_VEIL} />}
          {veils.panel > 0.001 && <Veil x={AREAS.rightPanel.x0} y={AREAS.rightPanel.y0} w={AREAS.rightPanel.x1 - AREAS.rightPanel.x0} h={AREAS.rightPanel.y1 - AREAS.rightPanel.y0} amount={veils.panel} maxOpacity={FOCUS_VEIL} />}
          {hero && heroRect && (
            <HeroLift
              card={heroRect}
              rise={hero.rise}
              radius={heroMsg ? 20 : 16}
              under={heroMsg?.id === 'M2' ? <GlowField x={px(heroRect.x)} y={px(heroRect.y)} w={px(heroRect.w)} h={px(heroRect.h)} frame={frame} pad={px(48)} /> : undefined}
              boardChildren={
                heroContent ? (
                  heroReveal < 1 ? (
                    <div style={{opacity: heroReveal}}>
                      <MessageRendererV4 msg={heroContent} boardY={heroRect.y} frame={frame} />
                    </div>
                  ) : (
                    <MessageRendererV4 msg={heroContent} boardY={heroRect.y} frame={frame} />
                  )
                ) : undefined
              }
            >
              {!heroMsg && <CriterionHeroRow id="C3.1" verified={state.verifiedIds.includes('C3.1')} reported={state.reportedIds.includes('C3.1')} />}
            </HeroLift>
          )}
        </>
      }
    />
  );

  const callouts = CALLOUTS.filter((c) => frame >= c.from && frame < c.to).map((c) => {
    const o = Math.min(
      interpolate(frame, [c.from, c.from + CALLOUT_FADE], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
      interpolate(frame, [c.to - CALLOUT_FADE, c.to], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
    );
    const onHero = c.onHero && heroInfo ? heroInfo : undefined;
    const el = (
      <CalloutV4 pose={pose} anchor={c.anchor(scroll)} hero={onHero} label={c.label} dotColor={c.dot} side={c.side} chipDx={c.chipDx} chipDy={c.chipDy} fontSize={c.label === '검증됨' ? 36 : 32} chipHeight={c.label === '검증됨' ? 64 : 60} />
    );
    return o < 1 ? (
      <div key={c.label} style={{position: 'absolute', inset: 0, opacity: o}}>
        {el}
      </div>
    ) : (
      <React.Fragment key={c.label}>{el}</React.Fragment>
    );
  });

  return (
    <StageV4
      frame={frame}
      pose={pose}
      boardOpacity={frame >= CLOSING.boardFade.from ? boardFade : undefined}
      board={board}
      overlay={
        <>
          <TypeLayer>
            {HEADLINES.filter((h) => frame >= h.enter && frame < h.exit + 8).map((h) => (
              <BeatHeadline key={h.id} copy={h.copy} accent={h.accent} variant="T2" enter={h.enter} exit={h.exit} frame={frame} top={h.top} left={h.left ?? 120} strike={h.strike} />
            ))}
            <Closing frame={frame} />
          </TypeLayer>
          {callouts}
        </>
      }
    />
  );
};
