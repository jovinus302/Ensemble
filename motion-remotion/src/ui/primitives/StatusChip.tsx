import React from 'react';
import {colors, radius, spacing, type, textStyle, statusChipColors, StatusChipState} from '../tokens';
import {CheckCircleIcon, HourglassIcon, HandIcon, ErrorTriangleIcon} from '../icons';

export {type StatusChipState} from '../tokens';

const iconFor: Record<StatusChipState, React.FC<{size?: number; color?: string}>> = {
  working: HourglassIcon,
  'needs-you': HandIcon,
  done: CheckCircleIcon,
  failed: ErrorTriangleIcon,
};

const labelFor: Record<StatusChipState, string> = {
  working: '작업 중',
  'needs-you': '결정 필요',
  done: '완료',
  failed: '실패',
};

export interface StatusChipProps {
  state: StatusChipState;
  label?: string;
}

export const StatusChip: React.FC<StatusChipProps> = ({state, label}) => {
  const c = statusChipColors[state];
  const Icon = iconFor[state];
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 24,
        padding: '0 10px',
        borderRadius: radius.full,
        background: c.bg,
      }}
    >
      <Icon size={16} color={c.iconColor} />
      <span style={textStyle(type.labelMd, colors.onSurface)}>{label ?? labelFor[state]}</span>
    </div>
  );
};
