import React from 'react';
import {colors, radius, type, textStyle} from '../tokens';
import {CheckCircleIcon, PersonReportIcon} from '../icons';

export type ProductState = 'checked' | 'self-report' | 'passed' | 'unverified';

export interface ProductStateBadgeProps {
  state: ProductState;
  label?: string;
}

// "완료 보고 ≠ passed": self-report must look visually weaker/neutral vs
// the verified-green pill (checked/passed) — this contrast is the point.
const styleFor: Record<ProductState, {bg: string; fg: string; verified: boolean; defaultLabel: string}> = {
  checked: {bg: colors.successContainer, fg: colors.success, verified: true, defaultLabel: 'checked · CI 통과'},
  passed: {bg: colors.successContainer, fg: colors.success, verified: true, defaultLabel: 'passed · human 승인'},
  'self-report': {bg: colors.surfaceContainer, fg: colors.onSurfaceVariant, verified: false, defaultLabel: 'self-report'},
  unverified: {bg: colors.surfaceContainer, fg: colors.onSurfaceVariant, verified: false, defaultLabel: 'unverified'},
};

export const ProductStateBadge: React.FC<ProductStateBadgeProps> = ({state, label}) => {
  const s = styleFor[state];
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 22,
        padding: '0 9px',
        borderRadius: radius.full,
        background: s.bg,
        border: s.verified ? 'none' : `1px solid ${colors.outlineVariant}`,
      }}
    >
      {s.verified ? (
        <CheckCircleIcon size={13} color={s.fg} />
      ) : (
        <PersonReportIcon size={13} color={s.fg} />
      )}
      <span style={textStyle(type.labelSm, s.fg)}>{label ?? s.defaultLabel}</span>
    </div>
  );
};
