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
import {HARMONY_RING, ThemeProvider, DARK, LIGHT, CLEAN} from './theme';
import type {SurfaceTheme} from './theme';

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
  blur?: number; // px, applied to each side layer and the face individually (never the preserve-3d root)
  litEdge?: number; // 0..1 harmony bleed along the contact edge (thread-touched)
  dim?: boolean; // unconnected surface: darkened + pushed back
  dimAmt?: number; // film: 0..1 multiplier of the dim strength
  theme?: Partial<SurfaceTheme>;
  children: React.ReactNode;
}> = ({place, look, fontFloor, aerial, label, dark, blur = 0, litEdge = 0, dim, dimAmt = 1, theme, children}) => {
  const blurCss = blur > 0 ? `blur(${blur}px)` : undefined;
  const termFace = dark && look.agentBody;
  const faceBg = termFace ? look.agentBody! : look.faceTone;
  const rim = dark && look.darkRim ? look.darkRim : undefined;
  const pal = look.pal === 'dark' ? DARK : look.pal === 'clean' ? CLEAN : LIGHT;
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
          filter: blurCss,
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
      {look.drop && (
        <div
          style={{
            position: 'absolute',
            inset: look.drop.inset,
            borderRadius: look.radius,
            background: `rgba(0,0,0,${look.drop.alpha})`,
            filter: `blur(${look.drop.blur}px)`,
            transform: `translate3d(0, ${look.drop.dy}px, ${-T - 2}px)`,
          }}
        />
      )}
      {layers}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: look.radius,
          background: faceBg,
          boxShadow: rim ? `${look.contact}, inset 0 1.5px 0 ${rim}` : `${look.contact}, ${look.bevel}`,
          outline: rim ? `1.5px solid ${rim}` : `1px solid ${look.rimLine}`,
          outlineOffset: rim ? -1.5 : -1,
          filter: blurCss,
          overflow: 'hidden',
          fontFamily: FONT_FAMILY,
          color: pal.onSurface,
        }}
      >
        <ThemeProvider value={{pal, agentBody: look.agentBody, mono: look.mono, cursor: look.cursor, ...theme}}>
          <FontFloor.Provider value={fontFloor}>{children}</FontFloor.Provider>
        </ThemeProvider>
        <div style={{position: 'absolute', inset: 0, background: look.faceGradient, opacity: dark ? 0.25 : 1, pointerEvents: 'none'}} />
        {litEdge > 0 && (
          <>
            <div style={{position: 'absolute', inset: 0, borderRadius: look.radius, boxShadow: `inset 0 0 36px 0 rgba(61,190,139,${litEdge * 0.55})`, pointerEvents: 'none'}} />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: look.radius,
                padding: 3,
                background: HARMONY_RING,
                opacity: litEdge,
                WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
                WebkitMaskComposite: 'xor',
                pointerEvents: 'none',
              }}
            />
          </>
        )}
        {dim && look.dim && <div style={{position: 'absolute', inset: 0, background: look.dim.color, opacity: look.dim.strength * dimAmt, pointerEvents: 'none'}} />}
        {aerial > 0 && (
          <div style={{position: 'absolute', inset: 0, background: look.aerial.color, opacity: look.aerial.strength * aerial, pointerEvents: 'none'}} />
        )}
      </div>
    </div>
  );
};
