import React from 'react';
import {colors, radius, spacing, type, textStyle} from '../tokens';
import {HomeIcon, ActivityIcon} from '../icons';

export const AppRail: React.FC = () => (
  <div
    style={{
      width: spacing.railWidth,
      height: '100%',
      background: colors.background,
      borderRight: `1px solid ${colors.outlineVariant}`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: spacing[5],
      paddingTop: spacing[4],
      boxSizing: 'border-box',
    }}
  >
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: radius.md,
        background: colors.primary,
        color: colors.onPrimary,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...textStyle(type.titleMd, colors.onPrimary, {fontWeight: 700}),
      }}
    >
      E
    </div>
    <div style={{width: 24, height: 1, background: colors.outlineVariant}} />
    <div style={{color: colors.onSurface}}>
      <HomeIcon size={24} />
    </div>
    <div style={{color: colors.onSurfaceVariant}}>
      <ActivityIcon size={24} />
    </div>
  </div>
);
