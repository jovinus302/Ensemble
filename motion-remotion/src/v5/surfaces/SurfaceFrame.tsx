// A tool window as a physical slab in the world: a stack of rounded-rect
// layers forms the extruded side (each layer shades lit -> dark across its
// width following the key light, and darkens with depth), the face carries
// the material (tone + sheen + bevel + rim line), and an "aerial" wash lightens
// far surfaces. Placed with surfaceTransform() so projectSurfacePoint() matches.
// Layers are plain parallel planes (no perpendicular side faces) - see the
// v4 BoardThickness note about Chrome's 3D sorting.
import React, {createContext, useContext} from 'react';
import type {SurfacePlacement} from '../stage/worldProject';
import {surfaceTransform} from '../stage/worldProject';
import type {WorldLook} from '../config';
import {FONT_FAMILY} from '../../tokens/fonts';
import {colors} from '../../v3/tokens/video';

// on-screen text floor (>= 20px): per-surface minimum logical font size
const FontFloor = createContext(20);
export const useFs = () => {
  const floor = useContext(FontFloor);
  return (n: number) => Math.max(n, floor);
};

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const mix = (a: string, b: string, t: number) => {
  const A = hex(a);
  const B = hex(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
};

export const SurfaceFrame: React.FC<{
  place: SurfacePlacement;
  look: WorldLook;
  fontFloor: number;
  aerial: number; // 0..1 how far back (wash strength multiplier)
  label: string;
  dark?: boolean; // dark body: no gloss streak over it
  children: React.ReactNode;
}> = ({place, look, fontFloor, aerial, label, dark, children}) => {
  const T = look.thickness;
  const N = Math.max(3, Math.min(14, Math.round(T / 5)));
  const layers = Array.from({length: N}, (_, i) => {
    const t = (i + 1) / N;
    const lit = mix(look.edgeLit, '#000000', look.edgeDepthDarken * t);
    const dark = mix(look.edgeDark, '#000000', look.edgeDepthDarken * t);
    return (
      <div
        key={i}
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: look.radius,
          background: `linear-gradient(${look.edgeAngle}deg, ${lit} 0%, ${dark} 100%)`,
          transform: `translateZ(${-T * t}px)`,
        }}
      />
    );
  });
  return (
    <div
      data-surface={label}
      style={{
        position: 'absolute',
        left: -place.w / 2,
        top: -place.h / 2,
        width: place.w,
        height: place.h,
        transformStyle: 'preserve-3d',
        transform: surfaceTransform(place),
      }}
    >
      {layers}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: look.radius,
          background: look.faceTone,
          boxShadow: `${look.contact}, ${look.bevel}`,
          outline: `1px solid ${look.rimLine}`,
          outlineOffset: -1,
          overflow: 'hidden',
          fontFamily: FONT_FAMILY,
          color: colors.onSurface,
        }}
      >
        <FontFloor.Provider value={fontFloor}>{children}</FontFloor.Provider>
        <div style={{position: 'absolute', inset: 0, background: look.faceGradient, opacity: dark ? 0.25 : 1, pointerEvents: 'none'}} />
        {aerial > 0 && (
          <div style={{position: 'absolute', inset: 0, background: look.aerial.color, opacity: look.aerial.strength * aerial, pointerEvents: 'none'}} />
        )}
      </div>
    </div>
  );
};
