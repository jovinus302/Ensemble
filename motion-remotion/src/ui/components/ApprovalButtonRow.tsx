import React from 'react';
import {colors, radius, spacing, type, textStyle} from '../tokens';

export interface ApprovalButtonRowProps {
  primaryLabel: string;
  secondaryLabel: string;
  variant?: 'plan' | 'choice' | 'approval';
  id?: string;
}

// Reusable action row: tonal primary button + text secondary button.
// variant is accepted for semantic tagging (future 2.5D layer keying) —
// visual treatment is intentionally the same tonal/text pairing across
// plan-approval / D1-choice / approval-card contexts per DESIGN.md.
export const ApprovalButtonRow: React.FC<ApprovalButtonRowProps> = ({
  primaryLabel,
  secondaryLabel,
  variant = 'approval',
  id,
}) => (
  <div id={id} data-variant={variant} style={{display: 'flex', gap: spacing[2], marginTop: spacing[1]}}>
    <button
      style={{
        border: 'none',
        cursor: 'default',
        background: colors.primaryContainer,
        color: colors.onPrimaryContainer,
        borderRadius: radius.full,
        padding: '8px 16px',
        ...textStyle(type.labelLg, colors.onPrimaryContainer),
      }}
    >
      {primaryLabel}
    </button>
    <button
      style={{
        border: 'none',
        cursor: 'default',
        background: 'transparent',
        color: colors.primary,
        borderRadius: radius.full,
        padding: '8px 14px',
        ...textStyle(type.labelLg, colors.primary),
      }}
    >
      {secondaryLabel}
    </button>
  </div>
);
