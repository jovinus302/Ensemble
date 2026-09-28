// v3 §5/§7 step 10-11 — StyleFrameV3: renders exactly one of SF1/SF2/SF3 from
// storyboard-v3.md §5, selected by the `frame` prop (185 -> SF1, 505 -> SF2,
// 1305 -> SF3). Poses/state are pinned to the spec's literal values rather
// than derived from PitchV3's approximate getCamera() timeline, so these
// stills are reviewable independent of the (not-yet-implemented) full motion.
import React, {useEffect, useState} from 'react';
import {AbsoluteFill, continueRender, delayRender} from 'remotion';
import {ensurePretendardLoaded, ensurePretendardVariableLoaded} from '../tokens/fonts';
import {Stage, Rig, TypeRig} from './stage/Stage';
import {STYLE_FRAME_POSES} from './stage/camera';
import {Board} from './ui/Board';
import {KineticHeadline} from './type/KineticHeadline';
import {GlowField} from './fx/GlowField';
import {Callout, DebugAnchorDot3D} from './callouts/Callout';
import {C3_1_CENTER} from './ui/content';
import {projectPoint} from './stage/project';

export interface StyleFrameV3Props {
  frame?: number;
  debugProjection?: boolean;
}

const SF1: React.FC<{frame: number}> = ({frame}) => {
  const pose = STYLE_FRAME_POSES.SF1;
  return (
    <Stage frame={frame}>
      <Rig pose={pose}>
        {/* whole-board blur is only valid when no risen layers exist (§3 DOF) — true here: beat① hasn't started yet. */}
        <div style={{filter: 'blur(3px)', transformStyle: 'preserve-3d', position: 'absolute', inset: 0}}>
          <Board frame={frame} scrollY={0} panelProgress={0} ry={pose.ry} />
          <div style={{position: 'absolute', inset: 0, background: 'rgba(244,241,234,.35)'}} />
        </div>
      </Rig>
      <TypeRig pose={pose}>
        <GlowField x={560} y={260} w={800} h={220} frame={frame} pad={120} />
        <KineticHeadline
          words={[{text: '잇는'}, {text: '건'}, {text: '이제'}, {text: 'PM', accent: true}]}
          frame={400}
          variant="T1"
          align="center"
          top={300}
        />
      </TypeRig>
    </Stage>
  );
};

const SF2: React.FC<{frame: number}> = ({frame}) => {
  const pose = STYLE_FRAME_POSES.SF2;
  return (
    <Stage frame={frame}>
      <Rig pose={pose}>
        <Board frame={frame} scrollY={0} heroId="M2" heroZ={90} glowId="M2" panelProgress={0} ry={pose.ry} />
      </Rig>
      <TypeRig pose={pose}>
        <KineticHeadline
          words={[{text: '목표만'}, {text: '말하면,'}, {text: '배정은'}, {text: 'PM이', accent: true}]}
          frame={400}
          variant="T2"
          align="left"
          top={96}
          left={120}
          width={1200}
        />
      </TypeRig>
      <Callout pose={pose} anchor={{x: 620, y: 250, z: 90 + 24}} label="담당 자동 배정" dotColor="#2B6A52" side="right" chipOffsetX={210} chipOffsetY={-56} />
      <Callout pose={pose} anchor={{x: 620, y: 340, z: 90 + 24}} label="선행 작업 대기" dotColor="#9A5B00" side="right" chipOffsetX={230} chipOffsetY={48} />
    </Stage>
  );
};

const SF3: React.FC<{frame: number; debugProjection?: boolean}> = ({frame, debugProjection}) => {
  const pose = STYLE_FRAME_POSES.SF3;
  return (
    <Stage frame={frame}>
      <Rig pose={pose}>
        <Board
          frame={frame}
          scrollY={1650}
          heroId="M14"
          heroZ={140}
          panelRisen
          panelProgress={3}
          c31Verified
          c31Risen
          evidenceHighlightLast
          ry={pose.ry}
        />
        {debugProjection && <DebugAnchorDot3D x={C3_1_CENTER.x} y={C3_1_CENTER.y} z={40 + 70} />}
      </Rig>
      <TypeRig pose={pose}>
        <KineticHeadline
          words={[{text: '판정은'}, {text: '보고가'}, {text: '아닌'}, {text: '증거로', zEmphasis: 80}]}
          frame={400}
          variant="T2"
          align="left"
          top={96}
          left={120}
          width={1200}
        />
      </TypeRig>
      <Callout pose={pose} anchor={{x: C3_1_CENTER.x, y: C3_1_CENTER.y, z: 40 + 70}} label="검증됨" dotColor="#1E7F4F" side="right" chipOffsetX={170} chipOffsetY={-120} />
      {debugProjection &&
        (() => {
          const p = projectPoint(pose, C3_1_CENTER.x, C3_1_CENTER.y, 40 + 70);
          return (
            <div
              style={{
                position: 'absolute',
                left: p.x - 6,
                top: p.y - 6,
                width: 12,
                height: 12,
                borderRadius: '50%',
                border: '2px solid #2B6A52',
                background: 'transparent',
              }}
            />
          );
        })()}
    </Stage>
  );
};

const StyleFrameV3Inner: React.FC<{frame: number; debugProjection?: boolean}> = ({frame, debugProjection}) => {
  if (frame <= 300) return <SF1 frame={frame} />;
  if (frame <= 900) return <SF2 frame={frame} />;
  return <SF3 frame={frame} debugProjection={debugProjection} />;
};

export const StyleFrameV3: React.FC<StyleFrameV3Props> = ({frame = 185, debugProjection}) => {
  const [handle] = useState(() => delayRender('loading fonts (StyleFrameV3)'));
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
  return <StyleFrameV3Inner frame={frame} debugProjection={debugProjection} />;
};
