import React, {useEffect, useLayoutEffect, useState} from 'react';
import {AbsoluteFill, cancelRender, continueRender, delayRender, useCurrentFrame} from 'remotion';
import {ensurePretendardLoaded, ensurePretendardVariableLoaded, FONT_FAMILY} from '../tokens/fonts';
import {Background} from '../v3/stage/Background';
import {KineticHeadline} from '../v3/type/KineticHeadline';
import {COPY, assertHeldPose} from '../v4/config';
import {BoardThickness} from '../v4/ui/BoardThickness';
import {CalloutV4, DebugRing2D} from '../v4/callouts/CalloutV4';
import {projectAnchor} from '../v4/stage/projectV4';
import {StageV4PM} from './StageV4PM';
import {Board} from './Board';
import {MotionChat} from './MotionChat';
import {headlines, labels} from './content';
import {cameraAt, segmentAt, heroAt, roadmapAt, lastMessageAt, ramp, mix} from './motion';
import {measureMotion} from './measureMotion';

const Headline: React.FC<{text: string; top: number; center?: boolean; large?: boolean; opacity?: number}> = ({text, top, center, large, opacity = 1}) => <div data-motion-headline style={{opacity}}><KineticHeadline words={text.split(' ').map(word => ({text: word, accent: ['AI', 'PM이', '계획도', '담당자에게'].includes(word)}))} frame={400} variant={large ? 'T1' : 'T2'} align={center ? 'center' : 'left'} top={top} left={120} width={1680}/></div>;

const Scene: React.FC<{frame: number; measure: boolean; debug: boolean}> = ({frame, measure, debug}) => {
  const pose = cameraAt(frame), segment = segmentAt(frame), hero = heroAt(frame);
  const anchor = hero ? {x: hero.card.x + hero.card.w - 32, y: hero.card.y + 44} : undefined;
  const calloutDy = hero && anchor ? Math.min(-22, 570 - projectAnchor(pose, anchor, hero).y) : -22;
  const latest = lastMessageAt(frame);
  const closing = frame >= 1530;
  const openingFade = frame < 120 ? 1 - ramp(frame, 94, 20) : frame < 180 ? 0 : ramp(frame, 180, 20);
  const boardOpacity = closing ? 1 - ramp(frame, 1530, 24) : openingFade;
  if (frame < 180 || frame >= 210) assertHeldPose(`motion-${frame}`, pose);
  useLayoutEffect(() => {if (measure) measureMotion(frame);}, [frame, measure]);
  return <AbsoluteFill data-motion-frame={frame} data-camera={JSON.stringify(pose)} style={{background: '#F4F1EA'}}>
    <Background frame={400}/>
    {boardOpacity > 0 && <AbsoluteFill data-motion-stage style={{opacity: boardOpacity, clipPath: frame >= 180 && frame < 210 ? `inset(${mix(620, 220, ramp(frame, 180, 30))}px 0 0)` : undefined}}>
      <StageV4PM pose={pose} slab={frame < 210 ? <BoardThickness/> : undefined}
        board={frame < 180 ? <Board beat="B1" rise={0} overview/> : <Board beat={segment.beat} rise={0}
          activePM={!!latest && latest.speaker === 'AI PM' && frame - latest.from < 120}
          roadmap={roadmapAt(frame)} timeline={<MotionChat frame={Math.min(frame, 1529)} debug={debug}/>}/>}
        overlay={!closing && hero && frame >= 330 ? <AbsoluteFill style={{opacity: ramp(hero.rise, 0, 1), transform: 'translateZ(0)'}}>
          <CalloutV4 pose={pose} anchor={anchor!} hero={hero} label={labels[segment.beat]} chipDx={98} chipDy={calloutDy} fontSize={30} chipHeight={62}/>
          {debug && <DebugRing2D pose={pose} anchor={{x: hero.card.x + hero.card.w - 32, y: hero.card.y + 44}} hero={hero}/>}
        </AbsoluteFill> : undefined}/>
    </AbsoluteFill>}
    {frame < 59 && <Headline text={COPY.opening1} top={72} center large opacity={1 - ramp(frame, 53, 6)}/>}
    {frame >= 53 && frame < 120 && <Headline text={COPY.opening2} top={mix(72, 481.2, ramp(frame, 94, 20))} center large opacity={ramp(frame, 53, 6) * (1 - ramp(frame, 114, 6))}/>}
    {frame >= 114 && frame < 330 && <Headline text={COPY.opening3} top={mix(481.2, 64, ramp(frame, 180, 30))} center large opacity={ramp(frame, 114, 6) * (1 - ramp(frame, 324, 6))}/>}
    {frame >= 330 && frame < 1530 && <Headline text={headlines[segment.beat]} top={64} opacity={ramp(frame, segment.start, 6) * (1 - ramp(frame, segment.end - 6, 6))}/>}
    {closing && <>
      <div style={{transform: `scale(${mix(1, .94, ramp(frame, 1614, 12))})`, transformOrigin: '960px 540px'}}><Headline text={COPY.closing} top={481.2} center large opacity={ramp(frame, 1550, 4) * (1 - ramp(frame, 1614, 12))}/></div>
      <div data-wordmark style={{position: 'absolute', left: 0, top: 432, width: 1920, textAlign: 'center', color: '#173B30', fontFamily: FONT_FAMILY, fontSize: 148, fontWeight: 700, letterSpacing: '-6px', opacity: ramp(frame, 1626, 18), transform: `scale(${mix(.94, 1, ramp(frame, 1626, 18))})`}}>ensemble</div>
      <div style={{position: 'absolute', top: 635, width: 1920, textAlign: 'center', fontFamily: FONT_FAMILY, fontSize: 34, color: '#52635A', opacity: ramp(frame, 1644, 6)}}>사람과 Agent가 한 팀으로</div>
    </>}
  </AbsoluteFill>;
};

export const PitchV4PM: React.FC<{measure?: boolean; debugProjection?: boolean}> = ({measure = false, debugProjection = false}) => {
  const frame = useCurrentFrame();
  const [handle] = useState(() => delayRender('v4-pm 모션 글꼴 준비'));
  const [ready, setReady] = useState(false);
  useEffect(() => {Promise.all([ensurePretendardLoaded(), ensurePretendardVariableLoaded()]).then(() => {setReady(true); continueRender(handle);}).catch(cancelRender);}, [handle]);
  return ready ? <Scene frame={frame} measure={measure} debug={debugProjection}/> : <AbsoluteFill style={{background: '#F4F1EA'}}/>;
};
