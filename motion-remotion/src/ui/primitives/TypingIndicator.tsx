import React from 'react';
import {colors, spacing, type, textStyle, VoiceKey, voices} from '../tokens';

export interface TypingIndicatorProps {
  voiceKey: VoiceKey;
  text: string;
}

export const TypingIndicator: React.FC<TypingIndicatorProps> = ({voiceKey, text}) => {
  const v = voices[voiceKey];
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: spacing[2]}}>
      <div style={{display: 'flex', gap: 3}}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              background: v.main,
              opacity: i === 1 ? 1 : 0.5,
              transform: i === 1 ? 'translateY(-2px)' : 'none',
            }}
          />
        ))}
      </div>
      <span style={textStyle(type.bodySm, colors.onSurfaceVariant)}>{text}</span>
    </div>
  );
};
