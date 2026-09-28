// v4 full pitch video (storyboard-v4.md, 1834f = 61.1s @30fps): the opening
// (OpeningScene, f0–388) then six frontal beats + closing (FeatureScene).
import React, {useEffect, useState} from 'react';
import {AbsoluteFill, continueRender, delayRender, useCurrentFrame} from 'remotion';
import {ensurePretendardLoaded, ensurePretendardVariableLoaded} from '../tokens/fonts';
import {OpeningScene} from './OpeningV4';
import {FeatureScene} from './pitch/FeatureScene';
import {OPENING_END, CAMERA_KEYS} from './pitch/pitchTimeline';
import {EXIT_FRAMES} from './pitch/BeatHeadline';

// ③ (top band) leaves 8f before ①'s camera move, which starts at OPENING_END.
const OPENING_LINE_EXIT = CAMERA_KEYS[1].move - EXIT_FRAMES;

export const PitchV4Scene: React.FC<{frame: number}> = ({frame}) =>
  frame < OPENING_END ? <OpeningScene frame={frame} lineCExitAt={OPENING_LINE_EXIT} /> : <FeatureScene frame={frame} />;

export const PitchV4: React.FC = () => {
  const frame = useCurrentFrame();
  const [handle] = useState(() => delayRender('loading fonts (PitchV4)'));
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
  return <PitchV4Scene frame={frame} />;
};
