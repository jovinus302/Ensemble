// World map coordinates — storyboard-v2.md §1.1 / §1.2. World canvas is 3840x2160.
export const WORLD_W = 3840;
export const WORLD_H = 2160;

export const nodes = {
  pm: {x: 1920, y: 1080, size: 143}, // 220 * 0.65 per §0.1 art direction (compact, richest element)
  user: {x: 1180, y: 760, r: 74},
  designer: {x: 1180, y: 1400, r: 74},
  research: {x: 2660, y: 760, size: 137},
  proto: {x: 2660, y: 1400, size: 137},
} as const;

// S01 tangled chaos lines (approximate hand-drawn curves scaled from style-frame geometry into world space)
export const chaosLines = {
  direct1: `M ${nodes.user.x - 552},${nodes.user.y - 380} C ${nodes.user.x - 420},${nodes.user.y - 460} ${nodes.user.x - 340},${nodes.user.y - 290} ${nodes.user.x - 220},${nodes.user.y - 360} C ${nodes.user.x - 100},${nodes.user.y - 430} ${nodes.user.x},${nodes.user.y - 460} ${nodes.user.x + 76},${nodes.user.y - 413}`,
  direct2: `M ${nodes.designer.x - 552},${nodes.designer.y + 320} C ${nodes.designer.x - 410},${nodes.designer.y + 380} ${nodes.designer.x - 330},${nodes.designer.y + 220} ${nodes.designer.x - 220},${nodes.designer.y + 280} C ${nodes.designer.x - 90},${nodes.designer.y + 350} ${nodes.designer.x},${nodes.designer.y + 320} ${nodes.designer.x + 76},${nodes.designer.y + 287}`,
  cross1: `M ${nodes.user.x - 552},${nodes.user.y + 320} C ${nodes.user.x - 360},${nodes.user.y + 260} ${nodes.user.x - 300},${nodes.user.y + 40} ${nodes.user.x - 180},${nodes.user.y + 30} C ${nodes.user.x - 70},${nodes.user.y + 20} ${nodes.user.x},${nodes.user.y - 10} ${nodes.user.x + 76},${nodes.user.y - 33}`,
  cross2: `M ${nodes.designer.x - 552},${nodes.designer.y - 320} C ${nodes.designer.x - 380},${nodes.designer.y - 260} ${nodes.designer.x - 320},${nodes.designer.y - 100} ${nodes.designer.x - 190},${nodes.designer.y - 70} C ${nodes.designer.x - 80},${nodes.designer.y - 45} ${nodes.designer.x},${nodes.designer.y - 40} ${nodes.designer.x + 76},${nodes.designer.y - 33}`,
} as const;

// S04+ formal assignment / handoff lines (straight lines PM <-> each node)
export const assignLines = {
  pmUser: {x1: nodes.pm.x, y1: nodes.pm.y, x2: nodes.user.x, y2: nodes.user.y},
  pmDesigner: {x1: nodes.pm.x, y1: nodes.pm.y, x2: nodes.designer.x, y2: nodes.designer.y},
  pmResearch: {x1: nodes.pm.x, y1: nodes.pm.y, x2: nodes.research.x, y2: nodes.research.y},
  pmProto: {x1: nodes.pm.x, y1: nodes.pm.y, x2: nodes.proto.x, y2: nodes.proto.y},
} as const;

export const pathLength = (p: {x1: number; y1: number; x2: number; y2: number}) =>
  Math.hypot(p.x2 - p.x1, p.y2 - p.y1);

export const pointOnLine = (p: {x1: number; y1: number; x2: number; y2: number}, t: number) => ({
  x: p.x1 + (p.x2 - p.x1) * t,
  y: p.y1 + (p.y2 - p.y1) * t,
});
