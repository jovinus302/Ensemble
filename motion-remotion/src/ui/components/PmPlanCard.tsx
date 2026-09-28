import React from 'react';
import {colors, radius, spacing, type, textStyle, harmonyGradient, elevation} from '../tokens';
import {ApprovalButtonRow} from './ApprovalButtonRow';
import {StatusChip} from '../primitives/StatusChip';

export interface PmPlanCardProps {
  id?: string;
  title: string;
  conclusion: string;
  bullets: {who: string; what: string}[];
  needsYouLabel: string;
  primaryLabel: string;
  secondaryLabel: string;
}

// PM summary/plan message: white card, radius xl, elevation level1, 3px
// harmony-gradient vertical bar on the left edge.
export const PmPlanCard: React.FC<PmPlanCardProps> = ({
  id,
  title,
  conclusion,
  bullets,
  needsYouLabel,
  primaryLabel,
  secondaryLabel,
}) => (
  <div
    id={id}
    style={{
      position: 'relative',
      background: colors.surface,
      borderRadius: radius.xl,
      boxShadow: elevation.level1,
      padding: `${spacing[3]}px ${spacing[4]}px`,
      maxWidth: spacing.messageMax,
      overflow: 'hidden',
    }}
  >
    <div style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: harmonyGradient}} />
    <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
      <span style={textStyle(type.titleLg, colors.onSurface)}>{title}</span>
      <span style={textStyle(type.bodyLg, colors.onSurface)}>{conclusion}</span>
      <div style={{display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2}}>
        {bullets.map((b, i) => (
          <div key={i} style={{display: 'flex', gap: 6}}>
            <span style={textStyle(type.bodyMd, colors.onSurface, {fontWeight: 600})}>{b.who}</span>
            <span style={textStyle(type.bodyMd, colors.onSurfaceVariant)}>— {b.what}</span>
          </div>
        ))}
      </div>
      <div style={{marginTop: 4}}>
        <StatusChip state="needs-you" label={needsYouLabel} />
      </div>
      <ApprovalButtonRow primaryLabel={primaryLabel} secondaryLabel={secondaryLabel} variant="plan" />
    </div>
  </div>
);
