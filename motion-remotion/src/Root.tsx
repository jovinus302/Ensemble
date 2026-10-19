import React from 'react';
import {Composition} from 'remotion';
import {StyleFrameV4} from './v4/StyleFrameV4';
import {OpeningV4} from './v4/OpeningV4';
import {OPENING} from './v4/opening';
import {PitchV4} from './v4/PitchV4';
import {PITCH_TOTAL} from './v4/pitch/pitchTimeline';
import {StyleFrameV5} from './v5/StyleFrameV5';
import {PitchV5} from './v5/PitchV5';
import {TeaserV5} from './v5/TeaserV5';
import {QaV5} from './v5/QaV5';
import {TEASER_FRAMES, TOTAL_FRAMES} from './v5/timing';

export const RemotionRoot: React.FC = () => {
  return (
    <>
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
      {/* v4 opening segment only (storyboard-v4.md O, design-v4 §5 rotation check). */}
      <Composition
        id="OpeningV4"
        component={OpeningV4}
        durationInFrames={OPENING.end}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{measure: false}}
      />
      {/* v4 full pitch video (storyboard-v4.md, 1834f = 61.1s). */}
      <Composition id="PitchV4" component={PitchV4} durationInFrames={PITCH_TOTAL} fps={30} width={1920} height={1080} />
      {/* v5 style frame SF-A (storyboard-v5.md §5): world options A1/A2/A3. */}
      <Composition
        id="StyleFrameV5"
        component={StyleFrameV5}
        durationInFrames={1}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{still: 'A1' as const, measure: false}}
      />
      {/* v5 pitch film (storyboard-v5.md, 1680f = 56.0s). Stage 1: B1-B3 animated, later beats hold. */}
      <Composition id="PitchV5" component={PitchV5} durationInFrames={TOTAL_FRAMES} fps={30} width={1920} height={1080} />
      {/* v5 teaser (storyboard-v5.md §6, 540f = 18.0s): the same scene read through source-frame remapping */}
      <Composition id="QaV5" component={QaV5} durationInFrames={1} fps={30} width={64} height={36} />
      <Composition id="TeaserV5" component={TeaserV5} durationInFrames={TEASER_FRAMES} fps={30} width={1920} height={1080} />
    </>
  );
};
