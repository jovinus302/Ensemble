// v4: real slab thickness for the board (the opening's (0,-40,0) pose must
// show a side face, not v3's single offset plane). All inputs are
// board-logical and go through px() (K=2 DOM scale).
//
// Rendered by StageV4 in its OWN rig (the `slab` prop), composited behind the
// board rig — never in the same 3D context as the board body. When these
// planes shared the body's context, Chrome dropped body pixels near the side
// face (and, with a back face, bled grey through a frontal board).
//
// Geometry:
//  - four straight side planes, one per edge between the corner arcs, standing
//    perpendicular to the board and extending back to z=-T. Faces point
//    OUTWARD with backface-visibility: hidden, so a face only draws when the
//    camera sees its outside (none do at (0,0,0)).
//  - the rounded corners as a stack of discs parallel to the board at depths
//    0..-T (their inner parts are covered by the board face painted on top).
import React from 'react';
import {px, colors} from '../../v3/tokens/video';
import {BOARD_W, BOARD_H} from '../../v3/ui/content';
import {BOARD_THICKNESS, BOARD_RADIUS} from '../config';

const shade = (hex: string, k: number) => {
  const h = hex.replace('#', '');
  const c = (i: number) => Math.round(Math.max(0, Math.min(255, parseInt(h.slice(i, i + 2), 16) * k)));
  return `rgb(${c(0)},${c(2)},${c(4)})`;
};

// key light direction in board-plane terms (from upper-left)
const LIGHT = {x: -0.6, y: -0.8};
const faceShade = (nx: number, ny: number) => 0.84 + 0.12 * Math.max(0, nx * LIGHT.x + ny * LIGHT.y);

const CORNER_LAYERS = 24;

export const BoardThickness: React.FC = () => {
  const T = BOARD_THICKNESS;
  const W = BOARD_W;
  const H = BOARD_H;
  const r = BOARD_RADIUS;
  // Each edge walked counter-clockwise (screen space) so the div's front side
  // (+z before rotation) ends up facing outward: normal = (-sin a, cos a).
  const edges = [
    {x: W - r, y: 0, len: W - 2 * r, ang: 180}, // top, normal (0,-1)
    {x: 0, y: r, len: H - 2 * r, ang: 90}, // left, normal (-1,0)
    {x: r, y: H, len: W - 2 * r, ang: 0}, // bottom, normal (0,1)
    {x: W, y: H - r, len: H - 2 * r, ang: -90}, // right, normal (1,0)
  ];
  const corners = [
    {cx: r, cy: r},
    {cx: W - r, cy: r},
    {cx: W - r, cy: H - r},
    {cx: r, cy: H - r},
  ];
  return (
    <>
      {corners.flatMap((c, ci) =>
        Array.from({length: CORNER_LAYERS}, (_, i) => {
          const z = -T * ((i + 1) / CORNER_LAYERS);
          return (
            <div
              key={`c${ci}-${i}`}
              style={{
                position: 'absolute',
                left: px(c.cx - r),
                top: px(c.cy - r),
                width: px(2 * r),
                height: px(2 * r),
                borderRadius: '50%',
                background: shade(colors.boardSlab, 0.86 - 0.08 * ((i + 1) / CORNER_LAYERS)),
                transform: `translateZ(${px(z)}px)`,
              }}
            />
          );
        }),
      )}
      {edges.map((e, i) => {
        const a = (e.ang * Math.PI) / 180;
        const k = faceShade(-Math.sin(a), Math.cos(a));
        return (
          <div
            key={`e${i}`}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: px(e.len),
              height: px(T),
              transformOrigin: '0 0',
              // point (u,v) of this div -> (start + u*dir, z = -v)
              transform: `translate3d(${px(e.x)}px, ${px(e.y)}px, 0px) rotateZ(${e.ang}deg) rotateX(-90deg)`,
              backfaceVisibility: 'hidden',
              background: `linear-gradient(180deg, ${shade(colors.boardSlab, k)} 0%, ${shade(colors.boardSlab, k * 0.9)} 100%)`,
            }}
          />
        );
      })}
    </>
  );
};
