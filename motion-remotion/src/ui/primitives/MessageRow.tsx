import React from 'react';
import {colors, radius, spacing, type, textStyle, voices, VoiceKey, elevation} from '../tokens';
import {Avatar} from './Avatar';

export interface HumanMessageRowProps {
  name: string;
  initials: string;
  timestamp: string;
  text: string;
  children?: React.ReactNode;
}

export const HumanMessageRow: React.FC<HumanMessageRowProps> = ({name, initials, timestamp, text, children}) => (
  <div style={{display: 'flex', gap: spacing[3], alignItems: 'flex-start'}}>
    <Avatar kind="human" initials={initials} />
    <div style={{display: 'flex', flexDirection: 'column', gap: 4, maxWidth: spacing.messageMax}}>
      <div style={{display: 'flex', alignItems: 'baseline', gap: 8}}>
        <span style={textStyle(type.titleMd, colors.onSurface)}>{name}</span>
        <span style={textStyle(type.labelSm, colors.onSurfaceVariant)}>{timestamp}</span>
      </div>
      <span style={textStyle(type.messageBody, colors.onSurface)}>{text}</span>
      {children}
    </div>
  </div>
);

export interface AgentMessageRowProps {
  name: string;
  role: string;
  voiceKey: VoiceKey;
  text: string;
  children?: React.ReactNode;
}

export const AgentMessageRow: React.FC<AgentMessageRowProps> = ({name, role, voiceKey, text, children}) => {
  const v = voices[voiceKey];
  return (
    <div style={{display: 'flex', gap: spacing[3], alignItems: 'flex-start'}}>
      <Avatar kind="agent" initials={name[0]} voiceKey={voiceKey} />
      <div style={{display: 'flex', flexDirection: 'column', gap: 4, maxWidth: spacing.messageMax}}>
        <div style={{display: 'flex', alignItems: 'baseline', gap: 8}}>
          <span style={textStyle(type.titleMd, colors.onSurface)}>{name}</span>
          <span style={textStyle(type.labelSm, colors.onSurfaceVariant)}>{role}</span>
        </div>
        <div
          style={{
            background: v.container,
            color: v.on,
            borderRadius: '4px 20px 20px 20px',
            padding: `${spacing[3]}px ${spacing[4]}px`,
            display: 'inline-block',
          }}
        >
          <span style={textStyle(type.messageBody, v.on)}>{text}</span>
        </div>
        {children}
      </div>
    </div>
  );
};

export interface AttachmentCardProps {
  filename: string;
  actionLabel?: string;
}

export const AttachmentCard: React.FC<AttachmentCardProps> = ({filename, actionLabel = '열기'}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: spacing[2],
      background: colors.surface,
      borderRadius: radius.lg,
      boxShadow: elevation.level1,
      padding: `${spacing[2]}px ${spacing[3]}px`,
      width: 'fit-content',
    }}
  >
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: radius.xs,
        background: colors.surfaceContainer,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: colors.onSurfaceVariant,
        fontSize: 10,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M14 3.5V8h4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </div>
    <span style={textStyle(type.bodyMd, colors.onSurface)}>{filename}</span>
    <span style={textStyle(type.labelLg, colors.primary, {marginLeft: 4})}>{actionLabel}</span>
  </div>
);
