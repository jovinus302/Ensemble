// v5 teaser (540f = 18.0s, storyboard-v5.md §6): the film's scene read through the
// source-frame map in teaser.ts, with the teaser's own music and the film's SFX at their
// remapped frames. Max three headlines (B2 break, B3 connection, closing); the film's
// B4-B7 headlines are dropped. Bridges between segments are accelerated, blurred
// continuations of the same world (no cuts, no fades).
import React, {useEffect, useState} from 'react';
import {AbsoluteFill, Audio, Sequence, continueRender, delayRender, staticFile, useCurrentFrame} from 'remotion';
import {CameraMotionBlur} from '@remotion/motion-blur';
import {ensurePretendardLoaded, ensurePretendardVariableLoaded} from '../tokens/fonts';
import {FrameMapCtx, Scene} from './PitchV5';
import {sfxFile} from './timeline';
import {camMoving} from './camera';
import {TEASER_SFX, TV, inBridge, teaserCamera, teaserSource} from './teaser';

const CTX = {map: teaserSource, teaser: true, cam: teaserCamera};
const Sound: React.FC = () => (
  <>
    <Audio src={staticFile('audio/music-v5-teaser.wav')} volume={1} />
    {TEASER_SFX.map((e, i) => (
      <Sequence key={`${e.name}-${i}`} from={e.frame} durationInFrames={e.frames ?? Math.ceil(sfxFile(e.name).durationSec * 30) + 2} layout="none" name={`sfx ${e.label}`}>
        <Audio src={staticFile(sfxFile(e.name).file)} volume={e.volume} />
      </Sequence>
    ))}
  </>
);

const Film: React.FC = () => {
  const tf = useCurrentFrame();
  const blur = inBridge(tf) || camMoving(teaserSource(tf));
  return (
    <>
      {blur ? (
        <CameraMotionBlur shutterAngle={180} samples={6}>
          <Scene />
        </CameraMotionBlur>
      ) : (
        <Scene />
      )}
      <Sound />
    </>
  );
};

export const TeaserV5: React.FC = () => {
  const [handle] = useState(() => delayRender('loading fonts (TeaserV5)'));
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
  if (!ready) return <AbsoluteFill style={{backgroundColor: '#0E1311'}} />;
  return (
    <FrameMapCtx.Provider value={CTX}>
      <Film />
    </FrameMapCtx.Provider>
  );
};
