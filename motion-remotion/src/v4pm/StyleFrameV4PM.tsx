import React, {useEffect, useLayoutEffect, useState} from 'react';
import {AbsoluteFill, cancelRender, continueRender, delayRender} from 'remotion';
import {ensurePretendardLoaded, ensurePretendardVariableLoaded} from '../tokens/fonts';
import {KineticHeadline} from '../v3/type/KineticHeadline';
import {TypeLayer} from '../v4/stage/StageV4';
import {StageV4PM} from './StageV4PM';
import {BoardThickness} from '../v4/ui/BoardThickness';
import {CalloutV4, DebugRing2D} from '../v4/callouts/CalloutV4';
import {assertHeldPose, COPY} from '../v4/config';
import {Board} from './Board';
import {ANCHOR, CARD, STILLS, headlines, labels, poseFor, type Beat, type Still} from './content';
import {measureFrame} from './measure';
import {Background} from '../v3/stage/Background';

type Props = {still: Still; heroRise: number; debugProjection: boolean; measure: boolean};
const Scene: React.FC<Props> = ({still, heroRise, debugProjection, measure}) => {
  const opening = still === 'O1' || still === 'O2' || still === 'OH';
  const beat: Beat = opening ? 'B1' : still;
  const pose = poseFor(still);
  assertHeldPose(still, pose);
  const hero = {card: CARD, rise: opening ? 0 : heroRise};
  const headline = still === 'O1' ? '' : opening ? COPY.opening3 : headlines[beat];
  useLayoutEffect(() => {if (measure) measureFrame(still, heroRise);}, [still, heroRise, measure]);
  if (still === 'OH') return <AbsoluteFill><Background frame={400}/><div data-pm-headline><KineticHeadline words={COPY.opening3.split(' ').map(text => ({text, accent: ['AI', 'PM이'].includes(text)}))} frame={400} variant="T1" align="center" top={481.2}/></div></AbsoluteFill>;
  return <StageV4PM pose={pose}
    slab={still === 'O1' ? <BoardThickness/> : undefined}
    board={<Board beat={beat} rise={heroRise} debug={debugProjection && !opening} overview={opening} landed={still === 'O2'}/>}
    overlay={<>
      {headline && <div data-pm-headline><TypeLayer><KineticHeadline words={headline.split(' ').map(text => ({text, accent: ['PM이', '계획도', '담당자에게'].includes(text)}))} frame={400} variant={still === 'O2' ? 'T1' : 'T2'} align={still === 'O2' ? 'center' : 'left'} top={64} left={120} width={1680}/></TypeLayer></div>}
      {!opening && <CalloutV4 pose={pose} anchor={ANCHOR} hero={hero} label={labels[beat]} chipDx={98} chipDy={-22} fontSize={30} chipHeight={62}/>}
      {debugProjection && !opening && <DebugRing2D pose={pose} anchor={ANCHOR} hero={hero}/>}
    </>}/ >;
};
export const StyleFrameV4PM: React.FC<Props> = (props) => {
  if (!STILLS.includes(props.still)) throw new Error(`알 수 없는 스틸: ${props.still}`);
  if (props.heroRise < 0 || props.heroRise > 1) throw new Error('부상 범위는 0~1입니다.');
  const [handle] = useState(() => delayRender('v4-pm 글꼴 준비'));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all([ensurePretendardLoaded(), ensurePretendardVariableLoaded()]).then(() => {setReady(true); continueRender(handle);}).catch(cancelRender);
  }, [handle]);
  if (!ready) return <AbsoluteFill style={{background: '#F4F1EA'}}/>;
  return <Scene {...props}/>;
};
