// v4 opening segment (storyboard-v4.md segment O, f0–264): ① → ② → word swap
// "사람이"→"AI PM이" → ③, board entrance at (0,-40,0) (SF1a), 30f rotation +
// push-in to frontal (SF1b framing), ③ re-set above the landed board.
// Timeline and poses: opening.ts. Built for the design-v4 §5 rotation check.
// Props: measure (log the per-frame pose table and the oblique-band count).
import React, {useEffect, useLayoutEffect, useMemo, useState} from 'react';
import {AbsoluteFill, continueRender, delayRender, interpolate, Easing, useCurrentFrame} from 'remotion';
import {ensurePretendardLoaded, ensurePretendardVariableLoaded, FONT_FAMILY} from '../tokens/fonts';
import {RevealUnit} from '../primitives/Headline';
import {type as typeScale, inkColor, accentColor} from '../v3/tokens/video';
import {KineticHeadline} from '../v3/type/KineticHeadline';
import {StageV4, TypeLayer} from './stage/StageV4';
import {BoardV4} from './ui/BoardV4';
import {BoardThickness} from './ui/BoardThickness';
import {COPY} from './config';
import {OPENING, openingPose, obliqueBandFrames, boardEnterProgress} from './opening';

const T1 = typeScale.T1;
const LINE_H = T1.fontSize * T1.lineHeight + 0.15 * T1.fontSize; // RevealUnit box (lh + .15em mask pad)
const CENTER_TOP = 540 - LINE_H / 2;
const STAGGER = 6;

const lineStyle: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  width: 1920,
  top: CENTER_TOP,
  display: 'flex',
  justifyContent: 'center',
  gap: '0.32em',
  fontFamily: FONT_FAMILY,
  fontWeight: T1.fontWeight,
  fontSize: T1.fontSize,
  lineHeight: T1.lineHeight,
  letterSpacing: T1.letterSpacing,
  color: inkColor,
};

// Rendered width of a T1 word (canvas, same font/weight/tracking as the line).
const measureT1 = (text: string) => {
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = `${T1.fontWeight} ${T1.fontSize}px ${FONT_FAMILY}`;
  (ctx as unknown as {letterSpacing: string}).letterSpacing = `${-0.03 * T1.fontSize}px`;
  return ctx.measureText(text).width;
};

const OpeningType: React.FC<{frame: number}> = ({frame}) => {
  const OLD = '사람이';
  const NEW = 'AI PM이';
  const widths = useMemo(() => ({old: measureT1(OLD), next: measureT1(NEW)}), []);
  const {swap, recede} = OPENING;
  const slotW = interpolate(frame, [swap.widthFrom, swap.widthTo], [widths.old, widths.next], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.2, 0, 0, 1),
  });
  const r = interpolate(frame, [recede.from, recede.to], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.3, 0, 0.8, 0.15)});
  const b = OPENING.lineB.enter;
  const word = (text: string, i: number) => (
    <RevealUnit key={text} frame={frame} enterStart={b + i * STAGGER} exitStart={100000}>
      <span style={{display: 'inline-block'}}>{text}</span>
    </RevealUnit>
  );
  return (
    <>
      {/* ① */}
      {frame < OPENING.lineA.exit + 10 && (
        <div style={lineStyle}>
          {COPY.opening1.split(' ').map((t, i) => (
            <RevealUnit key={t} frame={frame} enterStart={OPENING.lineA.enter + i * STAGGER} exitStart={OPENING.lineA.exit}>
              <span style={{display: 'inline-block'}}>{t}</span>
            </RevealUnit>
          ))}
        </div>
      )}
      {/* ② -> swap -> ③ (centered), then recedes */}
      {frame >= b && r < 1 && (
        <div style={{...lineStyle, transform: `translateZ(${-300 * r}px)`, opacity: 1 - r}}>
          {word('다음', 0)}
          {word('일은', 1)}
          <span style={{position: 'relative', display: 'inline-block', width: slotW, height: LINE_H}}>
            <span style={{position: 'absolute', left: 0, top: 0}}>
              <RevealUnit frame={frame} enterStart={b + 2 * STAGGER} exitStart={swap.oldExit}>
                <span style={{display: 'inline-block'}}>{OLD}</span>
              </RevealUnit>
            </span>
            {frame >= swap.newEnter && (
              <span style={{position: 'absolute', left: 0, top: 0, whiteSpace: 'nowrap'}}>
                <RevealUnit frame={frame} enterStart={swap.newEnter} exitStart={100000}>
                  <span style={{display: 'inline-block', color: accentColor}}>{NEW}</span>
                </RevealUnit>
              </span>
            )}
          </span>
          {word('챙긴다', 3)}
        </div>
      )}
      {/* ③ re-set in the SF1b headline band — same component/props as StyleFrameV4 SF1b */}
      {frame >= OPENING.lineC.enter && (
        <KineticHeadline
          words={COPY.opening3.split(' ').map((text) => ({text, accent: text === 'AI' || text === 'PM이'}))}
          frame={frame - OPENING.lineC.enter}
          variant="T1"
          align="center"
          top={64}
        />
      )}
    </>
  );
};

const OpeningInner: React.FC<{measure?: boolean}> = ({measure}) => {
  const frame = useCurrentFrame();
  const pose = openingPose(frame);
  const enter = boardEnterProgress(frame);
  const boardVisible = frame >= OPENING.boardEnter.from;
  useLayoutEffect(() => {
    if (!measure) return;
    // eslint-disable-next-line no-console
    console.log('V4OPENING ' + JSON.stringify({frame, ry: Math.round(pose.ry * 100) / 100, s: Math.round(pose.s * 1000) / 1000, band: obliqueBandFrames()}));
  }, [measure, frame, pose.ry, pose.s]);
  return (
    <StageV4
      frame={frame}
      pose={pose}
      // entrance fades the whole board group; after it, the plain (still-identical) DOM
      boardOpacity={frame < OPENING.boardEnter.to ? (boardVisible ? enter : 0) : undefined}
      slab={boardVisible && pose.ry !== 0 ? <BoardThickness /> : undefined}
      board={<BoardV4 frame={frame} scrollY={0} />}
      overlay={
        <TypeLayer>
          <OpeningType frame={frame} />
        </TypeLayer>
      }
    />
  );
};

export const OpeningV4: React.FC<{measure?: boolean}> = ({measure}) => {
  const [handle] = useState(() => delayRender('loading fonts (OpeningV4)'));
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
  return <OpeningInner measure={measure} />;
};
