// v3 §7 step 10 — full 1710f/30fps/1920x1080 composition. Per the task scope
// (spec §7 step 11), FULL beat-by-beat motion (per-beat kinetic headline
// treatments, precise callout timing, card pop choreography) is explicitly
// NOT implemented in this pass — only SF1-3 stills were required and those
// are rendered via StyleFrameV3, which pins the exact documented poses/state
// per beat instead of relying on this file's approximations.
//
// This composition exists so `Full`-style full-duration registration doesn't
// crash: it holds a simplified per-beat state (camera via getCamera() +
// holdDrift, a coarse scrollY/heroId/headline map from storyboard-v3.md §4)
// across the whole timeline. Treat it as a scaffold for the next pass, not a
// reviewed deliverable.
import React, {useEffect, useState} from 'react';
import {AbsoluteFill, continueRender, delayRender, useCurrentFrame} from 'remotion';
import {ensurePretendardLoaded, ensurePretendardVariableLoaded} from '../tokens/fonts';
import {Stage, Rig, TypeRig} from './stage/Stage';
import {getCamera, holdDrift} from './stage/camera';
import {Board} from './ui/Board';
import {KineticHeadline} from './type/KineticHeadline';
import {SCROLL_Y_FOR_BEAT, PROGRESS_BY_BEAT, BeatId} from './ui/content';

interface BeatWindow {
  beat: BeatId | null;
  start: number;
  end: number;
  headline: string;
  heroId?: string;
}

// Coarse frame ranges from storyboard-v3.md §4 (arrival columns).
const BEATS: BeatWindow[] = [
  {beat: null, start: 0, end: 210, headline: '잇는 건 이제 PM'},
  {beat: 1, start: 210, end: 390, headline: '사람과 Agent, 한 채널에'},
  {beat: 2, start: 390, end: 630, headline: '목표만 말하면, 배정은 PM이', heroId: 'M2'},
  {beat: 3, start: 630, end: 840, headline: '맥락은 통째로 넘어간다', heroId: 'M10'},
  {beat: 4, start: 840, end: 1110, headline: "아무도 '시작해'라고 안 했다", heroId: 'M13'},
  {beat: 5, start: 1110, end: 1350, headline: '판정은 보고가 아닌 증거로', heroId: 'M14'},
  {beat: 6, start: 1350, end: 1530, headline: '일이 끝나도, 목표를 본다', heroId: 'M15'},
  {beat: null, start: 1530, end: 1710, headline: '다음 일은, PM이 챙긴다'},
];

const beatWindowFor = (frame: number): BeatWindow => BEATS.find((b) => frame >= b.start && frame < b.end) ?? BEATS[BEATS.length - 1];

const PitchV3Inner: React.FC = () => {
  const frame = useCurrentFrame();
  const base = getCamera(frame);
  const drift = holdDrift(frame);
  const pose = {...base, ry: base.ry + drift.ry, tx: base.tx + drift.tx};

  const win = beatWindowFor(frame);
  const scrollY = win.beat ? SCROLL_Y_FOR_BEAT[win.beat] : 0;
  const progress = win.beat ? PROGRESS_BY_BEAT[win.beat] : 0;

  return (
    <Stage frame={frame}>
      <Rig pose={pose}>
        <Board frame={frame} scrollY={scrollY} heroId={win.heroId} heroZ={90} panelRisen={(win.beat ?? 0) >= 5} panelProgress={progress} />
      </Rig>
      <TypeRig pose={pose}>
        <KineticHeadline words={win.headline.split(' ').map((t) => ({text: t}))} frame={frame - win.start} variant={win.beat ? 'T2' : 'T1'} align={win.beat ? 'left' : 'center'} top={win.beat ? 96 : 300} left={120} width={1200} />
      </TypeRig>
    </Stage>
  );
};

export const PitchV3: React.FC = () => {
  const [handle] = useState(() => delayRender('loading fonts (PitchV3)'));
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
  return <PitchV3Inner />;
};
