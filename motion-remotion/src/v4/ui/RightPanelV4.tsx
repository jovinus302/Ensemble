// Adapted copy of src/v3/ui/RightPanel.tsx (v3 file untouched, design-v4 §9).
// Differences, all from the v4 frontal 3-layer model:
//  - the panel is part of the board layer: flat (z=0) with a hairline
//    elevation, not v3's Riser at Z+18/+40 (that would be a 4th depth layer);
//  - `heroRowId` leaves that criterion's slot empty — the row is drawn once,
//    in the hero layer, by <CriterionHeroRow/> below;
//  - no per-row translateZ / CastShadow / glow (the hero layer owns lift and shadow).
// Positions stay the literal board-absolute y values from content.ts.
import React from 'react';
import {AREAS, PRODUCT_STATE} from '../../v3/ui/content';
import type {Criterion} from '../../v3/ui/content';
import {px, colors, uiTextStyle} from '../../v3/tokens/video';
import {uiTypeV4 as uiType, SECONDARY_FONT} from './typeV4';
import {UnverifiedBadge, VerifiedBadge, ReportedTag} from './BadgeV4';
import {EmbossChip} from '../../v3/ui/primitives/EmbossChip';

export const PANEL_X = AREAS.rightPanel.x0;
export const PANEL_Y = AREAS.rightPanel.y0;
export const PANEL_W = AREAS.rightPanel.x1 - AREAS.rightPanel.x0;
export const PANEL_H = AREAS.rightPanel.y1 - AREAS.rightPanel.y0;
export const PANEL_PAD = 20;
export const ROW_W = PANEL_W - PANEL_PAD * 2;

const local = (boardAbsY: number) => boardAbsY - PANEL_Y;

export interface RightPanelV4Props {
  progress: number;
  verifiedIds?: string[];
  reportedIds?: string[]; // round D: "보고됨" comes from the product state, not content.ts
  showDecision?: boolean;
  evidenceCount?: number;
  heroRowId?: string;
}

const RowBody: React.FC<{c: Criterion; verified: boolean; reported?: boolean; hero?: boolean}> = ({c, verified, reported, hero}) => (
  <>
    <div style={{position: 'relative', flex: 1, minWidth: 0}}>
      <div style={uiTextStyle(uiType.labelMd, colors.onSurfaceVariant)}>{c.id}</div>
      <div style={{...uiTextStyle(uiType.bodyMd, colors.onSurface), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{c.label}</div>
    </div>
    <div style={{position: 'relative', display: 'flex', alignItems: 'center', flexShrink: 0}}>
      {verified ? <VerifiedBadge hero={hero} /> : <UnverifiedBadge />}
      {reported && !verified && <ReportedTag />}
    </div>
  </>
);

// Board-logical rect of a criterion row's hero card: the row plus a margin.
// Vertical margin is 2 (v3's risen row used 6): the lift magnifies the card
// ~1.05x and perspective pushes it ~6px away from the screen center, so a
// larger margin made the card's lower edge touch the next row's label (measured).
const HERO_ROW_MARGIN = {x: 12, y: 2};
export const criterionHeroRect = (id: string) => {
  const c = PRODUCT_STATE.criteria.find((r) => r.id === id)!;
  return {x: PANEL_X + PANEL_PAD - HERO_ROW_MARGIN.x, y: c.y[0] - HERO_ROW_MARGIN.y, w: ROW_W + 2 * HERO_ROW_MARGIN.x, h: c.y[1] - c.y[0] + 2 * HERO_ROW_MARGIN.y};
};

// The hero version of a criterion row, laid out inside a HeroLift card box
// (coordinates relative to the card, which is criterionHeroRect(id)).
export const CriterionHeroRow: React.FC<{id: string; verified: boolean; reported?: boolean}> = ({id, verified, reported}) => {
  const c = PRODUCT_STATE.criteria.find((r) => r.id === id)!;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: px(16),
        background: colors.surface,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.9), 0 0 0 1px rgba(23,59,48,.06)',
      }}
    >
      {/* soft success glow behind the badge — filter-free radial gradient, like v3's risen row */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: px(16),
          background: 'radial-gradient(circle 150px at 78% 50%, rgba(30,127,79,.28) 0%, rgba(30,127,79,.08) 50%, transparent 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: px(HERO_ROW_MARGIN.x),
          top: px(HERO_ROW_MARGIN.y),
          width: px(ROW_W),
          height: px(c.y[1] - c.y[0]),
          display: 'flex',
          alignItems: 'center',
          gap: px(10),
        }}
      >
        <RowBody c={c} verified={verified} reported={reported} hero />
      </div>
    </div>
  );
};

export const RightPanelV4: React.FC<RightPanelV4Props> = ({progress, verifiedIds = [], reportedIds = [], showDecision = true, evidenceCount = 3, heroRowId}) => (
  <div
    style={{
      position: 'absolute',
      left: px(PANEL_X),
      top: px(PANEL_Y),
      width: px(PANEL_W),
      height: px(PANEL_H),
      borderRadius: px(28),
      background: colors.surface,
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,.9), 0 1px 2px rgba(23,59,48,.08), 0 0 0 1px rgba(23,59,48,.05)',
    }}
  >
    {/* tabs */}
    <div style={{position: 'absolute', left: px(PANEL_PAD), top: px(local(8)), display: 'flex', gap: px(8)}}>
      <div style={{padding: `${px(6)}px ${px(14)}px`, borderRadius: 9999, background: colors.secondaryContainer, ...uiTextStyle(uiType.titleSm, colors.onSecondaryContainer)}}>
        Product State
      </div>
      <div style={{padding: `${px(6)}px ${px(14)}px`, ...uiTextStyle(uiType.bodyMd, colors.onSurfaceVariant)}}>작업</div>
      <div style={{padding: `${px(6)}px ${px(14)}px`, ...uiTextStyle(uiType.bodyMd, colors.onSurfaceVariant)}}>맥락</div>
    </div>

    {/* goal block */}
    <div style={{position: 'absolute', left: px(PANEL_PAD), top: px(local(72)), width: px(ROW_W)}}>
      <div style={uiTextStyle(uiType.labelMd, colors.onSurfaceVariant)}>{PRODUCT_STATE.goalLabel}</div>
      <div style={{marginTop: px(4), ...uiTextStyle(uiType.bodyMd, colors.onSurface)}}>{PRODUCT_STATE.goalText}</div>
      <div style={{marginTop: px(8), ...uiTextStyle(uiType.labelMd, colors.primary), fontVariantNumeric: 'tabular-nums'}}>인수 조건 {progress}/5</div>
    </div>

    {/* criteria rows */}
    {PRODUCT_STATE.criteria.map((c) => {
      if (c.id === heroRowId) return null;
      const [y0, y1] = c.y;
      return (
        <div
          key={c.id}
          style={{
            position: 'absolute',
            left: px(PANEL_PAD),
            top: px(local(y0)),
            width: px(ROW_W),
            height: px(y1 - y0),
            display: 'flex',
            alignItems: 'center',
            gap: px(10),
          }}
        >
          <RowBody c={c} verified={verifiedIds.includes(c.id)} reported={reportedIds.includes(c.id)} />
        </div>
      );
    })}

    {/* decision block (from ③ on) */}
    {showDecision && (
    <div style={{position: 'absolute', left: px(PANEL_PAD), top: px(local(536)), width: px(ROW_W), display: 'flex', alignItems: 'center', gap: px(8)}}>
      <span style={uiTextStyle(uiType.bodyMd, colors.onSurface)}>{PRODUCT_STATE.decisionBlock.label}</span>
      <EmbossChip label={PRODUCT_STATE.decisionBlock.chip} container={colors.secondaryContainer} onContainer={colors.onSecondaryContainer} fontSize={SECONDARY_FONT} />
    </div>
    )}

    {/* evidence block */}
    <div style={{position: 'absolute', left: px(PANEL_PAD), top: px(local(656)), width: px(ROW_W), display: 'flex', flexDirection: 'column', gap: px(6)}}>
      {PRODUCT_STATE.evidence.map((e, i) => {
        if (i >= evidenceCount) return null;
        return (
          <div key={e} style={uiTextStyle(uiType.bodySm, colors.onSurfaceVariant)}>
            {e}
          </div>
        );
      })}
    </div>
  </div>
);
