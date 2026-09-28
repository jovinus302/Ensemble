// v4 style frames (review/design-v4.md r1 §3): SF1a opening start pose
// (0,-40,0), SF1b landed frontal, SF2 beat 2 (plan), SF3 beat 5 (verdict).
// Every still is a held pose from config.STILL_POSES, checked by
// assertHeldPose. Board content/state is v3's content.ts at the v3 beat
// frames (185 / 505 / 1305), per design-v4 §2's "v3 6 beats as the starting point".
//
// Props: still (which frame), debugProjection (overlay the anchor's 3D dot and
// its 2D projection), heroRise (0..1, default 1 — 0 renders the pre-rise state
// for the "before and after the lift" anchor check), measure (log on-screen
// sizes to the console, see measure.ts).
import React, {useEffect, useLayoutEffect, useState} from 'react';
import {AbsoluteFill, continueRender, delayRender} from 'remotion';
import {ensurePretendardLoaded, ensurePretendardVariableLoaded} from '../tokens/fonts';
import {px} from '../v3/tokens/video';
import {contentYToBoardY, messageById, AREAS, BOARD_H} from '../v3/ui/content';
import {messageByIdV4, MESSAGE_SHIFT, PM_REPLY} from './ui/contentV4';
import {Veil} from '../v3/fx/Veil';
import {MessageRendererV4} from './ui/messages/MessageRendererV4';
import {KineticHeadline} from '../v3/type/KineticHeadline';
import {GlowField} from '../v3/fx/GlowField';
import {StageV4, TypeLayer} from './stage/StageV4';
import {BoardV4} from './ui/BoardV4';
import {BoardThickness} from './ui/BoardThickness';
import {HeroLift} from './ui/HeroLift';
import {CriterionHeroRow, criterionHeroRect} from './ui/RightPanelV4';
import {CalloutV4, DebugDot3D, DebugRing2D} from './callouts/CalloutV4';
import {STILL_POSES, assertHeldPose, COPY} from './config';
import type {StillId} from './config';
import {measureStill} from './measure';
import type {TextTarget} from './measure';

export interface StyleFrameV4Props {
  still?: StillId;
  debugProjection?: boolean;
  heroRise?: number;
  measure?: boolean;
}

// Headline words: each space-separated word of the COPY string is one
// KineticHeadline unit (frame 400 = fully in), so the rendered text is the
// checked copy by construction.
const HEADLINE_FRAME = 400;
const wordsOf = (copy: string, accented: string[] = []) => copy.split(' ').map((text) => ({text, accent: accented.includes(text)}));
const M1_TEXT = (messageById('M1').content as {text: string}).text;
// Focus veil strength over out-of-focus units (v3 Veil default is .55; lighter
// here so veiled UI text stays legible — it is still >= 20px on screen).
const FOCUS_VEIL = 0.4;

// ---------------------------------------------------------------- SF1a / SF1b
const SF1a: React.FC = () => {
  const pose = STILL_POSES.SF1a;
  assertHeldPose('SF1a', pose);
  // No headline: this still isolates the perspective hypothesis (design-v4 §2).
  // The slab (side faces) is only passed for the rotated pose: at (0,0,0)
  // every side face is back-facing and would draw nothing.
  return <StageV4 frame={185} pose={pose} slab={<BoardThickness />} board={<BoardV4 frame={185} scrollY={0} pmReply={0} pmActivation={0} />} />;
};

const SF1b: React.FC = () => {
  const pose = STILL_POSES.SF1b;
  assertHeldPose('SF1b', pose);
  return (
    <StageV4
      frame={185}
      pose={pose}
      // landed: the AI PM has replied under M1 and its row reads "지휘 중" (design-v4 r3 B)
      board={<BoardV4 frame={185} scrollY={0} pmReply={1} pmActivation={1} />}
      overlay={
        <TypeLayer>
          <KineticHeadline
            words={wordsOf(COPY.opening3, ['AI', 'PM이'])}
            frame={HEADLINE_FRAME}
            variant="T1"
            align="center"
            top={64}
          />
        </TypeLayer>
      }
    />
  );
};

// ---------------------------------------------------------------- SF2 (beat 2)
const SF2_FRAME = 505;
const SF2_SCROLL = 40; // between v3's beat-2 scroll 0 -> 80; keeps M1 fully below the header band
const M2 = messageByIdV4('M2'); // v4 content: sits under the AI PM's reply M1b
const PLAN_CARD = {x: 376, y: contentYToBoardY(M2.contentY[0], SF2_SCROLL), w: 440, h: 360}; // MessageRenderer's fitted plan card (v3 round 7)
// plan-card row geometry (MessageRenderer): padding 20, title 24, +6, conclusion 21, +16, rows 44 + gap 8
// (the final -6 is the measured offset of the rendered chip centers vs. this nominal sum; see log-v4-sf.md)
const planRowCenterY = (i: number) => PLAN_CARD.y + 20 + 24 + 6 + 21 + 16 + i * 52 + 22 - 6;

const SF2: React.FC<{rise: number; debug?: boolean}> = ({rise, debug}) => {
  const pose = STILL_POSES.SF2;
  assertHeldPose('SF2', pose);
  const hero = {card: PLAN_CARD, rise};
  // anchors sit ~3 logical inside each chip's right edge (edges measured after
  // round 3's 13px chip labels: 735.3 / 781.9 logical)
  const a1 = {x: 732, y: planRowCenterY(0)};
  const a2 = {x: 779, y: planRowCenterY(2)};
  return (
    <StageV4
      frame={SF2_FRAME}
      pose={pose}
      board={
        <BoardV4
          frame={SF2_FRAME}
          scrollY={SF2_SCROLL}
          heroMessageId="M2"
          overlay={
            <>
            {/* out-of-focus units veiled (design-v4 §2): sidebar and right panel */}
            <Veil x={AREAS.sidebar.x0} y={0} w={AREAS.sidebar.x1 - AREAS.sidebar.x0} h={BOARD_H} amount={1} maxOpacity={FOCUS_VEIL} />
            <Veil x={AREAS.rightPanel.x0} y={AREAS.rightPanel.y0} w={AREAS.rightPanel.x1 - AREAS.rightPanel.x0} h={AREAS.rightPanel.y1 - AREAS.rightPanel.y0} amount={1} maxOpacity={FOCUS_VEIL} />
            <HeroLift
              card={PLAN_CARD}
              rise={rise}
              under={<GlowField x={px(PLAN_CARD.x)} y={px(PLAN_CARD.y)} w={px(PLAN_CARD.w)} h={px(PLAN_CARD.h)} frame={SF2_FRAME} pad={px(48)} />}
              boardChildren={<MessageRendererV4 msg={M2} boardY={PLAN_CARD.y} frame={SF2_FRAME} />}
            >
              {debug && <DebugDot3D x={a1.x - PLAN_CARD.x} y={a1.y - PLAN_CARD.y} />}
            </HeroLift>
            </>
          }
        />
      }
      overlay={
        <>
          <TypeLayer>
            <KineticHeadline
              words={wordsOf(COPY.beat2, ['PM이'])}
              frame={HEADLINE_FRAME}
              variant="T2"
              align="left"
              top={72}
              left={120}
              width={1680}
            />
          </TypeLayer>
          <CalloutV4 pose={pose} anchor={a1} hero={hero} label="담당 자동 배정" dotColor="#2B6A52" chipDx={150} chipDy={-64} fontSize={32} chipHeight={60} />
          <CalloutV4 pose={pose} anchor={a2} hero={hero} label="선행 작업 대기" dotColor="#9A5B00" chipDx={84} chipDy={64} fontSize={32} chipHeight={60} />
          {debug && <DebugRing2D pose={pose} anchor={a1} hero={hero} />}
        </>
      }
    />
  );
};

// ---------------------------------------------------------------- SF3 (beat 5)
const SF3_FRAME = 1305;
const C31_CARD = criterionHeroRect('C3.1');
// hero badge's right edge (row right = card.x + 12 + ROW_W), row center y
const SF3_ANCHOR = {x: C31_CARD.x + C31_CARD.w - 14, y: C31_CARD.y + C31_CARD.h / 2};

const SF3: React.FC<{rise: number; debug?: boolean}> = ({rise, debug}) => {
  const pose = STILL_POSES.SF3;
  assertHeldPose('SF3', pose);
  const hero = {card: C31_CARD, rise};
  return (
    <StageV4
      frame={SF3_FRAME}
      pose={pose}
      board={
        <BoardV4
          frame={SF3_FRAME}
          scrollY={1650 + MESSAGE_SHIFT} // v3's beat-5 scroll, plus the M1b shift: same rows on screen
          heroRowId="C3.1"
          progress={3}
          verifiedIds={['C1.1', 'C2.1']}
          evidenceHighlightLast
          overlay={
            <>
              {/* out-of-focus units veiled (design-v4 §2): sidebar + timeline column */}
              <Veil x={AREAS.sidebar.x0} y={0} w={AREAS.main.x1 - AREAS.sidebar.x0} h={BOARD_H} amount={1} maxOpacity={FOCUS_VEIL} />
              <HeroLift card={C31_CARD} rise={rise} radius={16}>
                <CriterionHeroRow id="C3.1" verified />
                {debug && <DebugDot3D x={SF3_ANCHOR.x - C31_CARD.x} y={SF3_ANCHOR.y - C31_CARD.y} />}
              </HeroLift>
            </>
          }
        />
      }
      overlay={
        <>
          <TypeLayer>
            <KineticHeadline
              words={wordsOf(COPY.beat5)}
              frame={HEADLINE_FRAME}
              variant="T2"
              align="left"
              top={72}
              left={120}
              width={1680}
            />
          </TypeLayer>
          <CalloutV4 pose={pose} anchor={SF3_ANCHOR} hero={hero} label="검증됨" dotColor="#1E7F4F" chipDx={120} chipDy={-96} />
          {debug && <DebugRing2D pose={pose} anchor={SF3_ANCHOR} hero={hero} />}
        </>
      }
    />
  );
};

// ---------------------------------------------------------------- measurement targets
const TARGETS: Record<StillId, TextTarget[]> = {
  SF1a: [{label: 'M1_messageBody', text: M1_TEXT}],
  SF1b: [
    {label: 'pmReply_messageBody', text: (PM_REPLY.content as {text: string}).text},
    {label: 'pmChip', text: '지휘 중', pill: true},
    {label: 'M1_messageBody', text: M1_TEXT},
    {label: 'panelGoal_bodyMd', text: '검증할 고객 문제 하나를 확정하고, 프로토타입에 대한 고객 반응을 확인한다'},
    {label: 'headline_word', text: '챙긴다'},
  ],
  SF2: [
    {label: 'M1_messageBody', text: M1_TEXT},
    {label: 'hero_row_bodyMd', text: '조사 Agent'},
    {label: 'hero_row_bodySm', text: '경쟁사·대안 5곳 조사'},
    {label: 'hero_chip_ready', text: '바로 시작', pill: true, within: '[data-v4="hero"]'},
    {label: 'hero_chip_waiting', text: '대기 · 문제 확정 후', pill: true, within: '[data-v4="hero"]'},
    {label: 'panelGoal_bodyMd', text: '검증할 고객 문제 하나를 확정하고, 프로토타입에 대한 고객 반응을 확인한다'},
    {label: 'headline_word', text: '말하면,'},
  ],
  SF3: [
    {label: 'hero_row_bodyMd', text: '사용 흐름이 문제 ①을 다룸', within: '[data-v4="hero"]'},
    {label: 'hero_badge', text: '검증됨', pill: true, within: '[data-v4="hero"]'},
    {label: 'panel_row_bodyMd', text: '인터뷰 기록 5건'},
    {label: 'timeline_messageBody', text: '사용 흐름 초안 올렸어요.'},
    {label: 'neighbor_above_C2.1', text: '경쟁·대안 조사 보고서'},
    {label: 'neighbor_below_C4.1', text: 'C4.1'},
    {label: 'headline_word', text: '증거로'},
  ],
};

const Inner: React.FC<Required<Pick<StyleFrameV4Props, 'still' | 'heroRise'>> & {debug?: boolean}> = ({still, heroRise, debug}) => {
  if (still === 'SF1a') return <SF1a />;
  if (still === 'SF1b') return <SF1b />;
  if (still === 'SF2') return <SF2 rise={heroRise} debug={debug} />;
  return <SF3 rise={heroRise} debug={debug} />;
};

const Measured: React.FC<{still: StillId; measure?: boolean; children: React.ReactNode}> = ({still, measure, children}) => {
  useLayoutEffect(() => {
    if (measure) measureStill(still, TARGETS[still]);
  }, [still, measure]);
  return <>{children}</>;
};

export const StyleFrameV4: React.FC<StyleFrameV4Props> = ({still = 'SF1a', debugProjection, heroRise = 1, measure}) => {
  const [handle] = useState(() => delayRender('loading fonts (StyleFrameV4)'));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all([ensurePretendardLoaded(), ensurePretendardVariableLoaded()])
      .then(() => {
        setReady(true);
        continueRender(handle);
      })
      .catch((err) => {
        console.error(err);
        continueRender(handle);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!ready) return <AbsoluteFill style={{backgroundColor: '#F4F1EA'}} />;
  return (
    <Measured still={still} measure={measure}>
      <Inner still={still} heroRise={heroRise} debug={debugProjection} />
    </Measured>
  );
};
