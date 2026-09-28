import React from 'react';
import {Composition} from 'remotion';
import {PitchVideo} from './compositions/PitchVideo';
import {UiMockupFlat} from './ui/UiMockupFlat';
import {PitchV3} from './v3/PitchV3';
import {StyleFrameV3} from './v3/StyleFrameV3';
import {StyleFrameV4} from './v4/StyleFrameV4';
import {StyleFrameV4PM} from './v4pm/StyleFrameV4PM';
import {PitchV4PM} from './v4pm/PitchV4PM';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Full timeline per storyboard-v2.md (1500f = 50s). S05-S08 are Phase 2b —
          the world simply holds its S04 end-state visually for those frames for now. */}
      <Composition
        id="Full"
        component={PitchVideo}
        durationInFrames={1500}
        fps={30}
        width={1920}
        height={1080}
      />
      {/* Phase 2a deliverable: S01-S04, 0-750f (0-25s). */}
      <Composition
        id="Preview2a"
        component={PitchVideo}
        durationInFrames={750}
        fps={30}
        width={1920}
        height={1080}
      />
      {/* Flat hi-fi product UI still, prep for 2.5D showcase pass. */}
      <Composition
        id="UiMockupFlat"
        component={UiMockupFlat}
        durationInFrames={1}
        fps={30}
        width={1440}
        height={900}
      />
      {/* v3 (spec-v3-architect.md): CSS-3D "floating workspace" pitch video.
          Full beat-by-beat motion is NOT implemented yet — see PitchV3.tsx
          header comment. Registered so the composition list is stable. */}
      <Composition
        id="PitchV3"
        component={PitchV3}
        durationInFrames={1710}
        fps={30}
        width={1920}
        height={1080}
      />
      {/* v3 style frames (spec §5/§7 step 11): SF1 f185, SF2 f505, SF3 f1305. */}
      <Composition
        id="StyleFrameV3"
        component={StyleFrameV3}
        durationInFrames={1}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{frame: 185, debugProjection: false}}
      />
      {/* v4 style frames (review/design-v4.md r1 §3): SF1a / SF1b / SF2 / SF3, chosen by `still`. */}
      <Composition
        id="StyleFrameV4"
        component={StyleFrameV4}
        durationInFrames={1}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{still: 'SF1a' as const, debugProjection: false, heroRise: 1, measure: false}}
      />
      <Composition
        id="StyleFrameV4PM"
        component={StyleFrameV4PM}
        durationInFrames={1}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{still: 'B6' as const, debugProjection: false, heroRise: 1, measure: false}}
      />
      <Composition id="PitchV4PM" component={PitchV4PM} durationInFrames={1710} fps={30} width={1920} height={1080} defaultProps={{measure: false, debugProjection: false}}/>
    </>
  );
};
