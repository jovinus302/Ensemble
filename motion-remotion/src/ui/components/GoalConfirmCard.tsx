import React from 'react';
import {colors, radius, spacing, type, textStyle, elevation} from '../tokens';
import {ProductStateBadge, ProductState} from './ProductStateBadge';

export interface GoalCriterion {
  id: string;
  label: string;
  badgeState: ProductState;
  badgeLabel: string;
}

export interface GoalConfirmCardProps {
  id?: string;
  goalText: string;
  criteria: GoalCriterion[];
  footerNote: string;
}

export const GoalConfirmCard: React.FC<GoalConfirmCardProps> = ({id, goalText, criteria, footerNote}) => (
  <div
    id={id}
    style={{
      background: colors.surface,
      borderRadius: radius.xl,
      boxShadow: elevation.level1,
      padding: spacing[4],
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}
  >
    <span style={textStyle(type.labelMd, colors.onSurfaceVariant)}>목표</span>
    <span style={textStyle(type.bodyLg, colors.onSurface, {fontWeight: 500})}>{goalText}</span>
    <div style={{display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2}}>
      {criteria.map((c) => (
        <div key={c.id} style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8}}>
          <span style={textStyle(type.bodyMd, colors.onSurface)}>
            <span style={{color: colors.onSurfaceVariant, marginRight: 6}}>{c.id}</span>
            {c.label}
          </span>
          <ProductStateBadge state={c.badgeState} label={c.badgeLabel} />
        </div>
      ))}
    </div>
    <div style={{borderTop: `1px solid ${colors.outlineVariant}`, marginTop: 4, paddingTop: 8}}>
      <span style={textStyle(type.bodySm, colors.onSurfaceVariant)}>{footerNote}</span>
    </div>
  </div>
);
