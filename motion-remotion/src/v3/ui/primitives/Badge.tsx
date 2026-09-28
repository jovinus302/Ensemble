// v3 §2 "배지 세트" — 미검증 (schedule icon) / 보고됨 (small outline tag) /
// 검증됨 (success container, check_circle).
// Round-3 fix: same K-doubling bug as EmbossChip — sizes were raw logical
// numbers instead of px()-doubled, so badges rendered at half the intended
// screen size. `hero` on VerifiedBadge is the round-3 "make C3.1 the
// unmistakable hero" treatment: bigger pill + a soft success-glow ring
// (filter-free, box-shadow only) instead of just embossChipShadow.
import React from 'react';
import {colors, embossChipShadow, uiType, px} from '../../tokens/video';
import {ScheduleIcon, CheckCircleIcon} from '../icons';

export const UnverifiedBadge: React.FC<{popScale?: number}> = ({popScale = 1}) => (
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
      transform: `scale(${popScale})`,
      whiteSpace: 'nowrap',
    }}
  >
    <ScheduleIcon size={px(14)} color={colors.onSurfaceVariant} />
    <span style={{fontFamily: 'Pretendard', fontSize: px(uiType.labelMd.fontSize), fontWeight: 600, color: colors.onSurface}}>미검증</span>
  </div>
);

export const VerifiedBadge: React.FC<{popScale?: number; hero?: boolean}> = ({popScale = 1, hero}) => {
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
        transform: `scale(${popScale})`,
        whiteSpace: 'nowrap',
      }}
    >
      <CheckCircleIcon size={px(14) * scale} color={colors.success} />
      <span style={{fontFamily: 'Pretendard', fontSize: px(uiType.labelMd.fontSize) * scale, fontWeight: 700, color: colors.onSurface}}>검증됨</span>
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
      fontSize: px(uiType.labelSm.fontSize),
      fontWeight: 500,
      color: colors.onSurfaceVariant,
      marginLeft: px(6),
      whiteSpace: 'nowrap',
    }}
  >
    보고됨
  </span>
);
