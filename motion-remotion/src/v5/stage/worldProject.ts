// v5 world projection (storyboard-v5.md §7): world camera matrix x Surface
// matrix -> perspective divide. The CSS applied by WorldStage and the numbers
// computed here share this one definition, so anchors (pins, chips, thread
// ends) can be projected exactly. CSS order of the camera:
//   rotateX(pitch) rotateY(yaw) scale3d(s) translate3d(-t)
// applied in a container whose origin is the stage center; perspective origin
// is the stage center too.
export const STAGE_W = 1920;
export const STAGE_H = 1080;
export const PERSPECTIVE = 2200;

export interface WorldCamera {
  tx: number;
  ty: number;
  tz: number;
  yaw: number; // deg
  pitch: number; // deg
  s: number;
}

export interface SurfacePlacement {
  x: number;
  y: number;
  z: number;
  yaw: number; // deg, about the surface's own vertical axis through its center
  w: number;
  h: number;
}

export const cameraTransform = (c: WorldCamera) =>
  `rotateX(${c.pitch}deg) rotateY(${c.yaw}deg) scale3d(${c.s}, ${c.s}, ${c.s}) translate3d(${-c.tx}px, ${-c.ty}px, ${-c.tz}px)`;

export const surfaceTransform = (p: SurfacePlacement) => `translate3d(${p.x}px, ${p.y}px, ${p.z}px) rotateY(${p.yaw}deg)`;

export const cameraMatrix = (c: WorldCamera): DOMMatrix => {
  const m = new DOMMatrix();
  m.rotateAxisAngleSelf(1, 0, 0, c.pitch);
  m.rotateAxisAngleSelf(0, 1, 0, c.yaw);
  m.scaleSelf(c.s, c.s, c.s);
  m.translateSelf(-c.tx, -c.ty, -c.tz);
  return m;
};

export const surfaceMatrix = (p: SurfacePlacement): DOMMatrix => {
  const m = new DOMMatrix();
  m.translateSelf(p.x, p.y, p.z);
  m.rotateAxisAngleSelf(0, 1, 0, p.yaw);
  return m;
};

export const perspectiveDivide = (q: {x: number; y: number; z: number}, perspective = PERSPECTIVE) => {
  const d = perspective - q.z;
  return {x: STAGE_W / 2 + (q.x * perspective) / d, y: STAGE_H / 2 + (q.y * perspective) / d};
};

/** point in the surface's local top-left pixel space (u right, v down, z = lift above the face) -> screen px */
export const projectSurfacePoint = (cam: WorldCamera, p: SurfacePlacement, u: number, v: number, lift = 0) => {
  const m = cameraMatrix(cam).multiply(surfaceMatrix(p));
  const q = m.transformPoint(new DOMPoint(u - p.w / 2, v - p.h / 2, lift));
  return perspectiveDivide(q);
};

/** on-screen px per surface px at the surface center (horizontal) — used for the >=20px text rule */
export const surfaceScreenScale = (cam: WorldCamera, p: SurfacePlacement) => {
  const a = projectSurfacePoint(cam, p, 0, p.h / 2);
  const b = projectSurfacePoint(cam, p, 100, p.h / 2);
  return Math.hypot(b.x - a.x, b.y - a.y) / 100;
};

/** bounding box on screen of a surface face */
export const surfaceScreenBounds = (cam: WorldCamera, p: SurfacePlacement) => {
  const pts = [
    projectSurfacePoint(cam, p, 0, 0),
    projectSurfacePoint(cam, p, p.w, 0),
    projectSurfacePoint(cam, p, p.w, p.h),
    projectSurfacePoint(cam, p, 0, p.h),
  ];
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  return {x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys)};
};
