// QA composition (not a deliverable): logs the smallest on-screen UI text per reading frame, so the >= 20px rule can be checked over the whole film.
import React, {useEffect} from 'react';
import {AbsoluteFill} from 'remotion';
import {camMoving} from './camera';
import {qaTextPx} from './PitchV5';
import {TOTAL_FRAMES} from './timing';

export const QaV5: React.FC = () => {
  useEffect(() => {
    const worst: Record<string, {px: number; f: number}> = {};
    for (let f = 45; f < Math.min(TOTAL_FRAMES, 1500); f += 3) { // the closing recede (f1500+) is not for reading
      if (camMoving(f)) continue; // text only has to hold in reading frames
      for (const r of qaTextPx(f)) {
        if (r.e < 0.999) continue; // surface still arriving
        if (!worst[r.id] || r.px < worst[r.id].px) worst[r.id] = {px: Math.round(r.px * 10) / 10, f};
      }
    }
    // eslint-disable-next-line no-console
    console.log('QA-TEXT ' + JSON.stringify(worst));
  }, []);
  return <AbsoluteFill />;
};
