import React from 'react';
import {colors, radius, spacing, type, textStyle, elevation, voices} from '../tokens';
import {AddIcon, SendIcon} from '../icons';

export interface ComposerProps {
  mentionLabel: string;
  restText?: string;
}

export const Composer: React.FC<ComposerProps> = ({mentionLabel, restText}) => (
  <div
    style={{
      background: colors.surface,
      borderRadius: radius.xl,
      boxShadow: elevation.level1,
      minHeight: 56,
      boxSizing: 'border-box',
      padding: `${spacing[2]}px ${spacing[3]}px`,
      display: 'flex',
      alignItems: 'center',
      gap: spacing[3],
    }}
  >
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: radius.full,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: colors.onSurfaceVariant,
        flexShrink: 0,
      }}
    >
      <AddIcon size={20} />
    </div>
    <div style={{flex: 1, display: 'flex', alignItems: 'center', gap: 6}}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          background: voices.voice2.container,
          color: voices.voice2.on,
          borderRadius: radius.sm,
          padding: '3px 8px',
          ...textStyle(type.labelLg, voices.voice2.on),
        }}
      >
        {mentionLabel}
      </span>
      {restText && <span style={textStyle(type.bodyLg, colors.onSurfaceVariant)}>{restText}</span>}
    </div>
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: radius.full,
        background: colors.primary,
        color: colors.onPrimary,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <SendIcon size={18} color={colors.onPrimary} />
    </div>
  </div>
);
