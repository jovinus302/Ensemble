import React, {useEffect, useState} from 'react';
import {AbsoluteFill, continueRender, delayRender, useCurrentFrame} from 'remotion';
import {Camera} from '../Camera';
import {World} from '../world/World';
import {Headline} from '../primitives/Headline';
import {scenes} from '../scenes/scenes';
import {ensurePretendardLoaded} from '../tokens/fonts';

export const PitchVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const [handle] = useState(() => delayRender('loading Pretendard'));
  const [fontReady, setFontReady] = useState(false);

  useEffect(() => {
    ensurePretendardLoaded()
      .then(() => {
        setFontReady(true);
        continueRender(handle);
      })
      .catch((err) => {
        console.error(err);
        continueRender(handle);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!fontReady) {
    return <AbsoluteFill style={{backgroundColor: '#F6F6F3'}} />;
  }

  return (
    <AbsoluteFill>
      <Camera>
        <World frame={frame} />
      </Camera>
      {scenes
        .filter((s) => s.implemented)
        .map((s) => (
          <Headline key={s.id} scene={s} frame={frame} />
        ))}
    </AbsoluteFill>
  );
};
