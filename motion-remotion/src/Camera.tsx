import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {getCamera} from './world/camera';

// Camera wrapper: translate/scale the persistent world so (centerX, centerY) is
// centered in the viewport at the given zoom. zoom=1.0 means viewport width (1920)
// maps to 1920 world units. Continuous across scene boundaries — never remounts
// the World, so camera moves never look like a cut.
export const Camera: React.FC<{children: React.ReactNode}> = ({children}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const cam = getCamera(frame);

  const scale = cam.zoom;
  const tx = width / 2 - cam.centerX * scale;
  const ty = height / 2 - cam.centerY * scale;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width,
        height,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transformOrigin: '0 0',
        }}
      >
        {children}
      </div>
    </div>
  );
};
