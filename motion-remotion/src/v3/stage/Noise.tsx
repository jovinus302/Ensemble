// v3 §3 "노이즈" — 256px seeded gaussian tile, generated once to a canvas
// dataURL (no feTurbulence, no SVG filters), 2D overlay, mix-blend-mode:
// multiply, opacity .07, background-position seeded-shifted every 2f.
import React, {useMemo} from 'react';

const SEED = 20260928;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const buildNoiseTile = (): string => {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const rand = mulberry32(SEED);
  for (let i = 0; i < size * size; i++) {
    const v = Math.floor(rand() * 255);
    img.data[i * 4 + 0] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
};

const seededOffset = (frameBucket: number) => {
  const rand = mulberry32(SEED + frameBucket * 977);
  return {x: Math.floor(rand() * 256), y: Math.floor(rand() * 256)};
};

export const Noise: React.FC<{frame: number}> = ({frame}) => {
  const dataUrl = useMemo(() => {
    if (typeof document === 'undefined') return null;
    return buildNoiseTile();
  }, []);
  if (!dataUrl) return null;
  const bucket = Math.floor(frame / 2);
  const {x, y} = seededOffset(bucket);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `url(${dataUrl})`,
        backgroundSize: '256px 256px',
        backgroundPosition: `${x}px ${y}px`,
        mixBlendMode: 'multiply',
        opacity: 0.07,
        pointerEvents: 'none',
      }}
    />
  );
};
