// Round-3 fix: same K-doubling bug as EmbossChip/Badge — buttons were raw
// logical numbers instead of px()-doubled, rendering at half size.
import React from 'react';
import {colors, uiType, embossChipShadow, px} from '../../tokens/video';

export const PrimaryButton: React.FC<{label: string; bg?: string; fg?: string}> = ({label, bg = colors.primary, fg = colors.onPrimary}) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      height: px(40),
      padding: `0 ${px(20)}px`,
      borderRadius: 9999,
      background: bg,
      color: fg,
      fontFamily: 'Pretendard',
      fontSize: px(uiType.labelLg.fontSize),
      lineHeight: `${px(uiType.labelLg.lineHeight)}px`,
      fontWeight: 600,
      boxShadow: '0 6px 14px -6px rgba(23,59,48,.35)',
      whiteSpace: 'nowrap',
    }}
  >
    {label}
  </div>
);

export const TextButton: React.FC<{label: string; color?: string}> = ({label, color = colors.primary}) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      height: px(40),
      padding: `0 ${px(12)}px`,
      color,
      fontFamily: 'Pretendard',
      fontSize: px(uiType.labelLg.fontSize),
      fontWeight: 600,
      whiteSpace: 'nowrap',
    }}
  >
    {label}
  </div>
);

export const OutlinedButton: React.FC<{label: string; color?: string}> = ({label, color = colors.onSurface}) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      height: px(40),
      padding: `0 ${px(18)}px`,
      borderRadius: 9999,
      border: `${px(1.5)}px solid ${colors.outline}`,
      color,
      fontFamily: 'Pretendard',
      fontSize: px(uiType.labelLg.fontSize),
      fontWeight: 600,
      whiteSpace: 'nowrap',
    }}
  >
    {label}
  </div>
);

export const DoneChip: React.FC<{label: string}> = ({label}) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      height: px(28),
      padding: `0 ${px(14)}px`,
      borderRadius: 9999,
      background: colors.successContainer,
      color: colors.onSurface,
      fontFamily: 'Pretendard',
      fontSize: px(uiType.labelMd.fontSize),
      fontWeight: 600,
      boxShadow: embossChipShadow,
      whiteSpace: 'nowrap',
    }}
  >
    {label}
  </div>
);
