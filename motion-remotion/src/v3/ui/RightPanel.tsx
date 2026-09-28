// v3 §2 "오른쪽 패널 = Product State" — tabs, goal block, acceptance-criteria
// rows (C1.1-C4.2, C3.1 is the beat-⑤ protagonist), decision block, evidence
// block. Positions are absolute, taken directly from storyboard-v3.md §2's
// fixed board-absolute y coordinates (not flex flow) so callout anchors
// (content.ts C3_1_CENTER) line up with the actual render — required for the
// §6 "콜아웃 투영" ±1px check. Risen +18 at rest, +40 from beat ⑤; C3.1 row
// itself additionally rises +70 with its badge popping 미검증 -> 검증됨.
//
// Round-3: C3.1 is made the unmistakable hero (bigger badge, its own cast
// shadow + soft success glow) and the other rows get veiled so the lift
// actually reads against something dimmer.
import React from 'react';
import {AREAS, PRODUCT_STATE} from './content';
import {px, colors, uiType, uiTextStyle, Z} from '../tokens/video';
import {Riser} from './primitives/Riser';
import {UnverifiedBadge, VerifiedBadge, ReportedTag} from './primitives/Badge';
import {EmbossChip} from './primitives/EmbossChip';
import {CastShadow} from '../fx/CastShadow';
import {Veil} from '../fx/Veil';

export interface RightPanelProps {
  frame: number;
  risen?: boolean;
  progress: number; // 0-5
  c31Verified?: boolean;
  c31Risen?: boolean;
  evidenceHighlightLast?: boolean;
  veilOtherRows?: boolean; // round-3: dim C1.1/C2.1/C4.1/C4.2 so C3.1 reads as hero
}

const PANEL_X = AREAS.rightPanel.x0;
const PANEL_Y = AREAS.rightPanel.y0; // 8, board-absolute
const PANEL_W = AREAS.rightPanel.x1 - AREAS.rightPanel.x0;
const PANEL_H = AREAS.rightPanel.y1 - AREAS.rightPanel.y0;
const PAD = 20;
const ROW_W = PANEL_W - PAD * 2;

// board-absolute Y -> local (panel-relative) Y
const local = (boardAbsY: number) => boardAbsY - PANEL_Y;

export const RightPanel: React.FC<RightPanelProps> = ({
  frame,
  risen,
  progress,
  c31Verified,
  c31Risen,
  evidenceHighlightLast,
  veilOtherRows,
}) => {
  const z = risen ? Z.rightPanelRisen : Z.rightPanelRest;

  return (
    <Riser x={PANEL_X} y={PANEL_Y} w={PANEL_W} h={PANEL_H} z={z} radius={28} background={colors.surface}>
      <div style={{position: 'relative', width: '100%', height: '100%'}}>
        {/* tabs, y 8-64 absolute -> local 0-56 */}
        <div style={{position: 'absolute', left: px(PAD), top: px(local(8)), display: 'flex', gap: px(8)}}>
          <div style={{padding: `${px(6)}px ${px(14)}px`, borderRadius: 9999, background: colors.secondaryContainer, ...uiTextStyle(uiType.titleSm, colors.onSecondaryContainer)}}>
            Product State
          </div>
          <div style={{padding: `${px(6)}px ${px(14)}px`, ...uiTextStyle(uiType.bodyMd, colors.onSurfaceVariant)}}>작업</div>
          <div style={{padding: `${px(6)}px ${px(14)}px`, ...uiTextStyle(uiType.bodyMd, colors.onSurfaceVariant)}}>맥락</div>
        </div>

        {/* goal block, y 72-196 absolute */}
        <div style={{position: 'absolute', left: px(PAD), top: px(local(72)), width: px(ROW_W)}}>
          <div style={uiTextStyle(uiType.labelMd, colors.onSurfaceVariant)}>{PRODUCT_STATE.goalLabel}</div>
          <div style={{marginTop: px(4), ...uiTextStyle(uiType.bodyMd, colors.onSurface)}}>{PRODUCT_STATE.goalText}</div>
          <div style={{marginTop: px(8), ...uiTextStyle(uiType.labelMd, colors.primary), fontVariantNumeric: 'tabular-nums'}}>인수 조건 {progress}/5</div>
        </div>

        {/* criteria rows, absolute y per content.ts Criterion.y (spec: y=244+i*56) */}
        <div style={{position: 'absolute', left: px(PAD), top: 0, width: px(ROW_W), height: '100%', transformStyle: 'preserve-3d'}}>
          {/* round-3: veil the non-hero rows (above and below C3.1) so the
              lift/hero contrast actually reads. C3.1's own band (y 356-412)
              is deliberately left uncovered. */}
          {veilOtherRows && (
            <>
              <Veil x={0} y={local(212)} w={ROW_W} h={356 - 212} amount={1} maxOpacity={0.5} />
              <Veil x={0} y={local(412)} w={ROW_W} h={524 - 412} amount={1} maxOpacity={0.5} />
            </>
          )}
          {PRODUCT_STATE.criteria.map((c) => {
            const isC31 = c.id === 'C3.1';
            const verified = isC31 ? Boolean(c31Verified) : false;
            const [y0, y1] = c.y;
            return (
              <div
                key={c.id}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: px(local(y0)),
                  width: '100%',
                  height: px(y1 - y0),
                  display: 'flex',
                  alignItems: 'center',
                  gap: px(10),
                  transformStyle: 'preserve-3d',
                  transform: isC31 && c31Risen ? `translateZ(${px(Z.panelC31Risen)}px)` : undefined,
                }}
              >
                {isC31 && c31Risen && verified && (
                  <>
                    {/* own contact shadow, cast onto the panel surface below this row's extra rise */}
                    <CastShadow x={0} y={0} w={ROW_W} h={y1 - y0} z={30} radius={16} />
                    {/* soft success glow — same filter-free radial-gradient technique as GlowField, success-toned */}
                    <div
                      style={{
                        position: 'absolute',
                        left: px(-40),
                        top: px(-40),
                        width: px(ROW_W + 80),
                        height: px(y1 - y0 + 80),
                        pointerEvents: 'none',
                        background: 'radial-gradient(circle 150px at 78% 50%, rgba(30,127,79,.4) 0%, rgba(30,127,79,.14) 45%, transparent 100%)',
                      }}
                    />
                  </>
                )}
                <div style={{flex: 1, minWidth: 0}}>
                  <div style={{...uiTextStyle(uiType.labelMd, colors.onSurfaceVariant)}}>{c.id}</div>
                  <div style={{...uiTextStyle(uiType.bodyMd, colors.onSurface), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{c.label}</div>
                </div>
                <div style={{display: 'flex', alignItems: 'center', flexShrink: 0}}>
                  {verified ? <VerifiedBadge hero={isC31} /> : <UnverifiedBadge />}
                  {c.reportedTag && !verified && <ReportedTag />}
                </div>
              </div>
            );
          })}
        </div>

        {/* decision block, y 536-640 absolute */}
        <div
          style={{
            position: 'absolute',
            left: px(PAD),
            top: px(local(536)),
            width: px(ROW_W),
            display: 'flex',
            alignItems: 'center',
            gap: px(8),
            opacity: veilOtherRows ? 0.55 : 1,
          }}
        >
          <span style={uiTextStyle(uiType.bodyMd, colors.onSurface)}>{PRODUCT_STATE.decisionBlock.label}</span>
          <EmbossChip label={PRODUCT_STATE.decisionBlock.chip} container={colors.secondaryContainer} onContainer={colors.onSecondaryContainer} />
        </div>

        {/* evidence block, y 656-884 absolute */}
        <div
          style={{
            position: 'absolute',
            left: px(PAD),
            top: px(local(656)),
            width: px(ROW_W),
            display: 'flex',
            flexDirection: 'column',
            gap: px(6),
            opacity: veilOtherRows ? 0.55 : 1,
          }}
        >
          {PRODUCT_STATE.evidence.map((e, i) => {
            const isLast = i === PRODUCT_STATE.evidence.length - 1;
            if (isLast && !evidenceHighlightLast) return null;
            return (
              <div key={e} style={uiTextStyle(uiType.bodySm, colors.onSurfaceVariant)}>
                {e}
              </div>
            );
          })}
        </div>
      </div>
    </Riser>
  );
};
