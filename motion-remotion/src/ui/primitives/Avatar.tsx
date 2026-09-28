import React from 'react';
import {colors, radius, harmonyGradient, voices, VoiceKey, type, textStyle} from '../tokens';

export interface AvatarProps {
  kind: 'human' | 'agent' | 'pm';
  initials?: string;
  voiceKey?: VoiceKey;
  size?: number;
  presence?: 'working' | 'waiting' | 'done';
}

const presenceColor: Record<NonNullable<AvatarProps['presence']>, string> = {
  working: colors.info,
  waiting: colors.outline,
  done: colors.success,
};

export const Avatar: React.FC<AvatarProps> = ({kind, initials, voiceKey, size, presence}) => {
  const isPm = kind === 'pm';
  const s = size ?? (isPm ? 40 : kind === 'agent' ? 36 : 36);
  const bg = isPm ? colors.primary : kind === 'agent' && voiceKey ? voices[voiceKey].main : colors.secondaryContainer;
  const fg = isPm ? colors.onPrimary : kind === 'agent' && voiceKey ? voices[voiceKey].container : colors.onSecondaryContainer;
  const borderRadius = kind === 'human' ? radius.full : radius.md;

  const core = (
    <div
      style={{
        width: s,
        height: s,
        borderRadius,
        background: bg,
        color: fg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...textStyle(type.labelLg, fg, {fontWeight: 600}),
      }}
    >
      {initials}
    </div>
  );

  return (
    <div style={{position: 'relative', width: isPm ? s + 4 : s, height: isPm ? s + 4 : s}}>
      {isPm ? (
        <div
          style={{
            width: s + 4,
            height: s + 4,
            borderRadius: radius.md,
            padding: 2,
            background: harmonyGradient,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {core}
        </div>
      ) : (
        core
      )}
      {presence && (
        <div
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: 12,
            height: 12,
            borderRadius: radius.full,
            background: presenceColor[presence],
            border: `2px solid ${colors.surface}`,
          }}
        />
      )}
    </div>
  );
};
