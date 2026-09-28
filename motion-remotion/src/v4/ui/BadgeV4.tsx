// Copy of src/v3/ui/primitives/Badge.tsx (v3 untouched). Only difference:
// label text uses the v4 secondary size (typeV4.SECONDARY_FONT = 13 logical)
// instead of labelMd 12 / labelSm 11, so badges read >= 18px on screen.
// Pill heights, paddings and icons are v3's.
import React from 'react';
import {colors, embossChipShadow, px} from '../../v3/tokens/video';
import {ScheduleIcon, CheckCircleIcon} from '../../v3/ui/icons';
import {SECONDARY_FONT} from './typeV4';

export const UnverifiedBadge: React.FC = () => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: px(4),
      height: px(24),
      padding: `0 ${px(10)}px`,
      borderRadius: 9999,
      background: colors.surfaceContainer,
      boxShadow: embossChipShadow,
      whiteSpace: 'nowrap',
    }}
  >
    <ScheduleIcon size={px(14)} color={colors.onSurfaceVariant} />
    <span style={{fontFamily: 'Pretendard', fontSize: px(SECONDARY_FONT), fontWeight: 600, color: colors.onSurface}}>미검증</span>
  </div>
);

export const VerifiedBadge: React.FC<{hero?: boolean}> = ({hero}) => {
  const scale = hero ? 1.6 : 1;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: px(4) * scale,
        height: px(24) * scale,
        padding: `0 ${px(10) * scale}px`,
        borderRadius: 9999,
        background: colors.successContainer,
        boxShadow: hero ? `${embossChipShadow}, 0 0 0 ${px(6)}px rgba(30,127,79,.14)` : embossChipShadow,
        whiteSpace: 'nowrap',
      }}
    >
      <CheckCircleIcon size={px(14) * scale} color={colors.success} />
      <span style={{fontFamily: 'Pretendard', fontSize: px(SECONDARY_FONT) * scale, fontWeight: 700, color: colors.onSurface}}>검증됨</span>
    </div>
  );
};

export const ReportedTag: React.FC = () => (
  <span
    style={{
      display: 'inline-block',
      height: px(18),
      lineHeight: `${px(18)}px`,
      padding: `0 ${px(8)}px`,
      borderRadius: 9999,
      border: `1px solid ${colors.outlineVariant}`,
      fontFamily: 'Pretendard',
      fontSize: px(SECONDARY_FONT),
      fontWeight: 500,
      color: colors.onSurfaceVariant,
      marginLeft: px(6),
      whiteSpace: 'nowrap',
    }}
  >
    보고됨
  </span>
);
