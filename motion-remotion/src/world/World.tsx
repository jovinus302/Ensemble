import React from 'react';
import {colors, harmonyGradientStops} from '../tokens/colors';
import {WORLD_W, WORLD_H, nodes, chaosLines, assignLines, pathLength, pointOnLine} from './coords';
import {getWorldState} from './state';
import {FONT_FAMILY} from '../tokens/fonts';

const PersonGlyph: React.FC<{cx: number; cy: number; stroke?: string}> = ({cx, cy, stroke = colors.onSurfaceVariant}) => (
  <g>
    <circle cx={cx} cy={cy - 16} r={16} fill="none" stroke={stroke} strokeWidth={4} strokeLinecap="round" />
    <path
      d={`M ${cx - 36},${cy + 36} C ${cx - 36},${cy + 11} ${cx - 20},${cy - 1} ${cx},${cy - 1} C ${cx + 20},${cy - 1} ${cx + 36},${cy + 11} ${cx + 36},${cy + 36}`}
      fill="none"
      stroke={stroke}
      strokeWidth={4}
      strokeLinecap="round"
    />
  </g>
);

const SearchGlyph: React.FC<{cx: number; cy: number; stroke: string}> = ({cx, cy, stroke}) => (
  <g>
    <circle cx={cx - 8} cy={cy - 8} r={16} fill="none" stroke={stroke} strokeWidth={4.5} strokeLinecap="round" />
    <line x1={cx + 4} y1={cy + 4} x2={cx + 22} y2={cy + 22} stroke={stroke} strokeWidth={4.5} strokeLinecap="round" />
  </g>
);

const BoltGlyph: React.FC<{cx: number; cy: number; fill: string}> = ({cx, cy, fill}) => (
  <path
    d={`M ${cx + 16},${cy - 30} L ${cx - 11},${cy + 10} L ${cx + 1},${cy + 10} L ${cx - 4},${cy + 40} L ${cx + 26},${cy - 4} L ${cx + 7},${cy - 4} Z`}
    fill={fill}
  />
);

const BatonGlyph: React.FC<{cx: number; cy: number}> = ({cx, cy}) => (
  <g transform={`translate(${cx},${cy})`}>
    <path d="M -24,20 L 22,-24" stroke={colors.onPrimaryContainer} strokeWidth={4} strokeLinecap="round" />
    <path d="M -26,10 Q 0,36 32,4" fill="none" stroke={colors.onPrimaryContainer} strokeWidth={2.5} opacity={0.45} strokeLinecap="round" />
    <circle cx={24} cy={-26} r={7} fill="url(#harmony)" />
  </g>
);

const AiBadge: React.FC<{x: number; y: number}> = ({x, y}) => (
  <g filter="url(#shadowSoft)">
    <rect x={x} y={y} width={40} height={26} rx={13} fill={colors.tertiaryContainer} />
    <text x={x + 20} y={y + 18} textAnchor="middle" fontWeight={700} fontSize={15} fill={colors.onTertiaryContainer} fontFamily={FONT_FAMILY}>
      AI
    </text>
  </g>
);

export const World: React.FC<{frame: number}> = ({frame}) => {
  const s = getWorldState(frame);

  // approximate length of the bezier chaos paths (used only for the dash-flow pattern, not pixel-exact)
  const chaosDash = '2 14';

  const assignLen = {
    pmUser: pathLength(assignLines.pmUser),
    pmDesigner: pathLength(assignLines.pmDesigner),
    pmResearch: pathLength(assignLines.pmResearch),
    pmProto: pathLength(assignLines.pmProto),
  };

  const tokenPos = pointOnLine(assignLines.pmResearch, s.handoffToken.t);
  const trail = [0.1, 0.07, 0.05, 0.035, 0.022, 0.012].map((back) => pointOnLine(assignLines.pmResearch, Math.max(s.handoffToken.t - back, 0)));

  const tokenPos2 = pointOnLine(assignLines.pmProto, s.handoffToken2.t);
  const trail2 = [0.1, 0.07, 0.05, 0.035, 0.022, 0.012].map((back) => pointOnLine(assignLines.pmProto, Math.max(s.handoffToken2.t - back, 0)));

  const activeResearchStroke = mixColor(colors.outlineVariant, colors.voice2, s.assign.pmResearch.activeColor);
  const activeProtoStroke = mixColor(colors.outlineVariant, colors.voice3, s.assign.pmProto.activeColor);

  // hand-cursor loop anchors: User-side tangle <-> Designer-side tangle (mirrored about
  // the world's vertical center), s.cursorPacket.travelP sweeps 0->1->0 between them.
  const cursorAnchorA = {x: nodes.user.x - 90, y: nodes.user.y - 330};
  const cursorAnchorB = {x: nodes.designer.x - 90, y: nodes.designer.y + 330};
  const cursorPos = {
    x: cursorAnchorA.x + (cursorAnchorB.x - cursorAnchorA.x) * s.cursorPacket.travelP,
    y: cursorAnchorA.y + (cursorAnchorB.y - cursorAnchorA.y) * s.cursorPacket.travelP,
  };
  const cursorDx = cursorPos.x - cursorAnchorA.x;
  const cursorDy = cursorPos.y - cursorAnchorA.y;

  // dark-mode ghosting: peripheral node fill/stroke drift toward paper-toned outlines as bg goes to ink
  const nodeStroke = mixColor(colors.onSurfaceVariant, colors.darkOnSurface, s.darkAmount);
  const nodeFill = mixColor(colors.surface, colors.darkSurface, s.darkAmount);
  const labelFill = mixColor(colors.onSurface, colors.darkOnSurface, s.darkAmount);

  const drift = {
    user: s.peripheralDrift(0),
    designer: s.peripheralDrift(1.7),
    research: s.peripheralDrift(3.1),
    proto: s.peripheralDrift(4.6),
  };

  return (
    <svg
      width={WORLD_W}
      height={WORLD_H}
      viewBox={`0 0 ${WORLD_W} ${WORLD_H}`}
      style={{position: 'absolute', top: 0, left: 0, backgroundColor: s.bgColor}}
    >
      <defs>
        <pattern id="grain" width={28} height={28} patternUnits="userSpaceOnUse">
          <circle cx={2} cy={2} r={1.1} fill={colors.brandInk} opacity={0.045} />
        </pattern>
        <linearGradient id="harmony" x1="0%" y1="0%" x2="100%" y2="100%">
          {harmonyGradientStops.map((st) => (
            <stop key={st.offset} offset={st.offset} stopColor={st.color} />
          ))}
        </linearGradient>
        {/* PM ring: shape stays concentric/axis-aligned with the node (round 5 fix) --
            "working" motion comes from rotating the gradient fill only, never the ring shape */}
        <linearGradient id="harmonyRing" x1="0%" y1="0%" x2="100%" y2="100%" gradientTransform={`rotate(${s.pmRingRotationDeg}, 0.5, 0.5)`}>
          {harmonyGradientStops.map((st) => (
            <stop key={st.offset} offset={st.offset} stopColor={st.color} />
          ))}
        </linearGradient>
        <radialGradient id="harmonyGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={colors.harmony1} stopOpacity={0.95} />
          <stop offset="100%" stopColor={colors.harmony1} stopOpacity={0} />
        </radialGradient>
        <filter id="shadowSoft" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx={0} dy={4} stdDeviation={5} floodColor={colors.brandInk} floodOpacity={0.08} />
        </filter>
        {/* per art-direction: shadow reserved for the PM node only; other nodes get a much lighter touch above */}
        <filter id="shadowHero" x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx={0} dy={10} stdDeviation={15} floodColor={colors.brandInk} floodOpacity={0.12} />
        </filter>
      </defs>

      <rect x={0} y={0} width={WORLD_W} height={WORLD_H} fill="url(#grain)" />

      {/* --- empty PM slot (S01-S02): breathing scale, dashed outline --- */}
      {s.pmSlotOpacity > 0.001 && (
        <g opacity={s.pmSlotOpacity} transform={`translate(${nodes.pm.x},${nodes.pm.y}) scale(${s.pmSlotScale})`}>
          <rect x={-65} y={-65} width={130} height={130} rx={22} fill="none" stroke={colors.outlineVariant} strokeWidth={3} strokeDasharray="3 11" strokeLinecap="round" />
          <text x={0} y={100} textAnchor="middle" fontSize={22} fontWeight={400} fill={colors.outline} fontFamily={FONT_FAMILY}>
            PM 없음
          </text>
        </g>
      )}

      {/* --- S01 chaos lines: continuous dash-flow (manual, ongoing), fade out once PM lands ---
          orchestrator review round: thicker + darker so the flow reads at a glance, not just on close inspection */}
      {s.chaos.direct1.opacity > 0.001 && (
        <g>
          <path d={chaosLines.direct1} fill="none" stroke={colors.onSurfaceVariant} strokeWidth={5} strokeLinecap="round" opacity={s.chaos.direct1.opacity} strokeDasharray={chaosDash} strokeDashoffset={s.chaos.direct1.flowOffset} />
          <path d={chaosLines.direct2} fill="none" stroke={colors.onSurfaceVariant} strokeWidth={5} strokeLinecap="round" opacity={s.chaos.direct2.opacity} strokeDasharray={chaosDash} strokeDashoffset={s.chaos.direct2.flowOffset} />
          <path d={chaosLines.cross1} fill="none" stroke={colors.outline} strokeWidth={4.5} strokeLinecap="round" opacity={s.chaos.cross1.opacity} strokeDasharray={chaosDash} strokeDashoffset={s.chaos.cross1.flowOffset} />
          <path d={chaosLines.cross2} fill="none" stroke={colors.outline} strokeWidth={4.5} strokeLinecap="round" opacity={s.chaos.cross2.opacity} strokeDasharray={chaosDash} strokeDashoffset={s.chaos.cross2.flowOffset} />
        </g>
      )}

      {/* --- hand cursor + context packet: continuously carries the packet between the
          User-side and Designer-side tangle (loop, not a one-shot) --- */}
      {s.cursorPacket.opacity > 0.001 && (
        <g opacity={s.cursorPacket.opacity} transform={`translate(${cursorDx},${cursorDy}) scale(${s.cursorPacket.touchScale})`}>
          <circle cx={nodes.user.x - 27} cy={nodes.user.y - 289} r={s.cursorPacket.ripple.r} fill="none" stroke={colors.secondary} strokeWidth={2} opacity={s.cursorPacket.ripple.opacity} />
          <g transform={`translate(${nodes.user.x - 90},${nodes.user.y - 330}) rotate(18)`} filter="url(#shadowSoft)">
            <path d="M0,0 L0,34 L8,27 L13,38 L20,35 L15,24 L26,24 Z" fill={colors.onSurface} />
          </g>
          <g transform={`translate(${nodes.user.x - 51},${nodes.user.y - 304})`} filter="url(#shadowSoft)">
            <rect x={0} y={0} width={46} height={30} rx={7} fill={colors.surface} stroke={colors.outlineVariant} strokeWidth={2} />
            <rect x={8} y={9} width={20} height={4} rx={2} fill={colors.outline} />
            <rect x={8} y={17} width={30} height={4} rx={2} fill={colors.outlineVariant} />
          </g>
        </g>
      )}

      {/* --- S04 assignment lines, SMOOTH spring draw + endpoint pulse --- */}
      {s.assign.pmUser.draw > 0.001 && (
        <>
          <line {...assignLines.pmUser} stroke={colors.outlineVariant} strokeWidth={4} strokeLinecap="round" strokeDasharray={assignLen.pmUser} strokeDashoffset={assignLen.pmUser * (1 - s.assign.pmUser.draw)} />
          <circle cx={nodes.user.x} cy={nodes.user.y} r={6 * s.assign.pmUser.pulse} fill={colors.onSurfaceVariant} opacity={0.5} />
        </>
      )}
      {s.assign.pmDesigner.draw > 0.001 && (
        <>
          <line {...assignLines.pmDesigner} stroke={colors.outlineVariant} strokeWidth={4} strokeLinecap="round" strokeDasharray={assignLen.pmDesigner} strokeDashoffset={assignLen.pmDesigner * (1 - s.assign.pmDesigner.draw)} />
          <circle cx={nodes.designer.x} cy={nodes.designer.y} r={6 * s.assign.pmDesigner.pulse} fill={colors.onSurfaceVariant} opacity={0.5} />
        </>
      )}
      {s.assign.pmProto.draw > 0.001 && (
        <>
          <line
            {...assignLines.pmProto}
            stroke={activeProtoStroke}
            strokeWidth={4 + 2 * s.assign.pmProto.activeColor}
            strokeLinecap="round"
            strokeDasharray={assignLen.pmProto}
            strokeDashoffset={assignLen.pmProto * (1 - s.assign.pmProto.draw)}
          />
          <circle cx={nodes.proto.x} cy={nodes.proto.y} r={6 * s.assign.pmProto.pulse} fill={colors.voice3} opacity={0.5} />
        </>
      )}
      {s.assign.pmResearch.draw > 0.001 && (
        <>
          <line {...assignLines.pmResearch} stroke={activeResearchStroke} strokeWidth={6} strokeLinecap="round" strokeDasharray={assignLen.pmResearch} strokeDashoffset={assignLen.pmResearch * (1 - s.assign.pmResearch.draw)} />
          <circle cx={nodes.research.x} cy={nodes.research.y} r={7 * s.assign.pmResearch.pulse} fill={colors.voice2} opacity={0.5} />
        </>
      )}

      {/* --- handoff hero: shrink + travel token, comet trail, cascading context-5 packet --- */}
      {s.handoffToken.visible && (
        <g opacity={s.handoffToken.groupOpacity} transform={`translate(${tokenPos.x},${tokenPos.y}) scale(${s.handoffToken.shrink})`}>
          {trail.map((p, i) => (
            <circle key={i} cx={p.x - tokenPos.x} cy={p.y - tokenPos.y} r={4 + i * 1.6} fill={colors.voice2} opacity={0.45 - i * 0.07} />
          ))}
          <circle cx={0} cy={0} r={30} fill="url(#harmonyGlow)" />
          <circle cx={0} cy={0} r={17} fill="url(#harmony)" filter="url(#shadowSoft)" />
          <g transform="translate(-20,-78)" filter="url(#shadowSoft)">
            <rect x={0} y={0} width={96} height={40} rx={10} fill={colors.surface} stroke={colors.outlineVariant} strokeWidth={2} />
            {[colors.harmony1, colors.harmony2, colors.harmony3, colors.harmony4, colors.primary].map((c, i) => {
              const cascadeIn = Math.max(Math.min(s.handoffToken.barsIn * 5 - i, 1), 0);
              const foldOut = 1 - Math.max(Math.min(s.handoffToken.barsOut * 5 - (4 - i), 1), 0);
              const scaleY = cascadeIn * foldOut;
              return <rect key={c} x={10 + i * 12} y={12 + (1 - scaleY) * 8} width={6} height={16 * scaleY} rx={3} fill={c} />;
            })}
          </g>
        </g>
      )}

      {/* --- handoff hero 2 (PM -> prototype agent): second beat so S04's back half isn't a dead hold --- */}
      {s.handoffToken2.visible && (
        <g opacity={s.handoffToken2.groupOpacity} transform={`translate(${tokenPos2.x},${tokenPos2.y}) scale(${s.handoffToken2.shrink})`}>
          {trail2.map((p, i) => (
            <circle key={i} cx={p.x - tokenPos2.x} cy={p.y - tokenPos2.y} r={4 + i * 1.6} fill={colors.voice3} opacity={0.45 - i * 0.07} />
          ))}
          <circle cx={0} cy={0} r={30} fill="url(#harmonyGlow)" />
          <circle cx={0} cy={0} r={17} fill="url(#harmony)" filter="url(#shadowSoft)" />
          <g transform="translate(-20,38)" filter="url(#shadowSoft)">
            <rect x={0} y={0} width={96} height={40} rx={10} fill={colors.surface} stroke={colors.outlineVariant} strokeWidth={2} />
            {[colors.harmony1, colors.harmony2, colors.harmony3, colors.harmony4, colors.primary].map((c, i) => {
              const cascadeIn = Math.max(Math.min(s.handoffToken2.barsIn * 5 - i, 1), 0);
              const foldOut = 1 - Math.max(Math.min(s.handoffToken2.barsOut * 5 - (4 - i), 1), 0);
              const scaleY = cascadeIn * foldOut;
              return <rect key={c} x={10 + i * 12} y={12 + (1 - scaleY) * 8} width={6} height={16 * scaleY} rx={3} fill={c} />;
            })}
          </g>
        </g>
      )}

      {/* --- PM node (materializes S03+): squash/stretch pop + draw-on harmony ring --- */}
      {s.pmVisible && (
        <g transform={`translate(${nodes.pm.x},${nodes.pm.y}) scale(${s.pmScaleUniform * s.pmScaleX}, ${s.pmScaleUniform * s.pmScaleY})`} filter="url(#shadowHero)">
          <g transform={`scale(${0.7 + 0.3 * s.pmRingDraw})`} opacity={s.pmRingDraw}>
            <rect
              x={-nodes.pm.size / 2 - 6}
              y={-nodes.pm.size / 2 - 6}
              width={nodes.pm.size + 12}
              height={nodes.pm.size + 12}
              rx={26}
              fill="none"
              stroke="url(#harmonyRing)"
              strokeWidth={4}
            />
          </g>
          <rect x={-nodes.pm.size / 2} y={-nodes.pm.size / 2} width={nodes.pm.size} height={nodes.pm.size} rx={20} fill={colors.primaryContainer} stroke={colors.primary} strokeWidth={3} />
          <BatonGlyph cx={0} cy={-10} />
          <text x={0} y={nodes.pm.size / 2 + 34} textAnchor="middle" fontSize={20} fontWeight={700} fill={colors.onPrimaryContainer} fontFamily={FONT_FAMILY}>
            PM
          </text>
        </g>
      )}

      {/* --- User --- */}
      <g opacity={s.peripheralOpacity} transform={`translate(${drift.user.dx},${drift.user.dy}) scale(${s.peripheralPop(0)})`} style={{transformOrigin: `${nodes.user.x}px ${nodes.user.y}px`}}>
        <circle cx={nodes.user.x} cy={nodes.user.y} r={nodes.user.r} fill={nodeFill} stroke={nodeStroke} strokeWidth={4} />
        <PersonGlyph cx={nodes.user.x} cy={nodes.user.y} stroke={nodeStroke} />
        <text x={nodes.user.x} y={nodes.user.y + nodes.user.r + 44} textAnchor="middle" fontSize={28} fontWeight={600} fill={labelFill} fontFamily={FONT_FAMILY}>
          사용자
        </text>
      </g>

      {/* --- Designer --- */}
      <g opacity={s.peripheralOpacity} transform={`translate(${drift.designer.dx},${drift.designer.dy}) scale(${s.peripheralPop(1)})`} style={{transformOrigin: `${nodes.designer.x}px ${nodes.designer.y}px`}}>
        <circle cx={nodes.designer.x} cy={nodes.designer.y} r={nodes.designer.r} fill={nodeFill} stroke={nodeStroke} strokeWidth={4} />
        <PersonGlyph cx={nodes.designer.x} cy={nodes.designer.y} stroke={nodeStroke} />
        <text x={nodes.designer.x} y={nodes.designer.y + nodes.designer.r + 44} textAnchor="middle" fontSize={28} fontWeight={600} fill={labelFill} fontFamily={FONT_FAMILY}>
          디자이너
        </text>
      </g>

      {/* --- 조사 Agent --- */}
      <g opacity={s.peripheralOpacity} transform={`translate(${drift.research.dx},${drift.research.dy}) scale(${s.peripheralPop(2)})`} style={{transformOrigin: `${nodes.research.x}px ${nodes.research.y}px`}}>
        <rect x={nodes.research.x - nodes.research.size / 2} y={nodes.research.y - nodes.research.size / 2} width={nodes.research.size} height={nodes.research.size} rx={24} fill={colors.voice2Container} stroke={colors.voice2} strokeWidth={4} />
        <SearchGlyph cx={nodes.research.x - 10} cy={nodes.research.y - 5} stroke={colors.voice2On} />
        <AiBadge x={nodes.research.x + nodes.research.size / 2 - 41} y={nodes.research.y - nodes.research.size / 2 - 24} />
        <text x={nodes.research.x} y={nodes.research.y + nodes.research.size / 2 + 44} textAnchor="middle" fontSize={28} fontWeight={600} fill={labelFill} fontFamily={FONT_FAMILY}>
          조사 Agent
        </text>
      </g>

      {/* --- 프로토타입 Agent --- */}
      <g opacity={s.peripheralOpacity} transform={`translate(${drift.proto.dx},${drift.proto.dy}) scale(${s.peripheralPop(3)})`} style={{transformOrigin: `${nodes.proto.x}px ${nodes.proto.y}px`}}>
        <rect x={nodes.proto.x - nodes.proto.size / 2} y={nodes.proto.y - nodes.proto.size / 2} width={nodes.proto.size} height={nodes.proto.size} rx={24} fill={colors.voice3Container} stroke={colors.voice3} strokeWidth={4} />
        <BoltGlyph cx={nodes.proto.x - 10} cy={nodes.proto.y} fill={colors.voice3On} />
        <AiBadge x={nodes.proto.x + nodes.proto.size / 2 - 41} y={nodes.proto.y - nodes.proto.size / 2 - 24} />
        <text x={nodes.proto.x} y={nodes.proto.y + nodes.proto.size / 2 + 44} textAnchor="middle" fontSize={28} fontWeight={600} fill={labelFill} fontFamily={FONT_FAMILY}>
          프로토타입 Agent
        </text>
      </g>
    </svg>
  );
};

function mixColor(a: string, b: string, t: number): string {
  const pa = hex(a);
  const pb = hex(b);
  const r = Math.round(pa.r + (pb.r - pa.r) * t);
  const g = Math.round(pa.g + (pb.g - pa.g) * t);
  const bch = Math.round(pa.b + (pb.b - pa.b) * t);
  return `rgb(${r}, ${g}, ${bch})`;
}
function hex(h: string) {
  const c = h.replace('#', '');
  return {r: parseInt(c.substring(0, 2), 16), g: parseInt(c.substring(2, 4), 16), b: parseInt(c.substring(4, 6), 16)};
}
