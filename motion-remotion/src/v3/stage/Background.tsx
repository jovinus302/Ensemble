// v3 §3 "배경" — 2D layer outside the 3D rig: gradient + 3 drifting lights +
// vignette. Noise is a separate component (Noise.tsx) so it can sit above
// everything else in the 2D overlay stack.
import React from 'react';
import {sineLoop} from '../../tokens/motion';

export const Background: React.FC<{frame: number}> = ({frame}) => {
  const drift1 = 40 * (sineLoop(frame, 8000) * 2 - 1);
  const drift2 = 40 * (sineLoop(frame + 950, 8000) * 2 - 1);
  const drift3 = 40 * (sineLoop(frame + 1900, 8000) * 2 - 1);

  return (
    <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(180deg, #F4F1EA 0%, #F4F1EA 55%, #E6E1D6 100%)'}}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse 60% 55% at calc(30% + ${drift1}px) 25%, #FFFDF8, transparent 70%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse 50% 50% at 80% calc(75% + ${drift2}px), rgba(211,235,221,.55), transparent 70%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse 45% 45% at calc(90% + ${drift3}px) 10%, rgba(240,139,180,.12), transparent 70%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse 120% 100% at 50% 45%, transparent 55%, rgba(23,59,48,.14) 100%)',
        }}
      />
    </div>
  );
};
