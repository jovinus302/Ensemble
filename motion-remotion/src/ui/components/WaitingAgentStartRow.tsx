import React from 'react';
import {colors, spacing, type, textStyle, VoiceKey} from '../tokens';
import {Avatar} from '../primitives/Avatar';

export interface WaitingAgentStartRowProps {
  id?: string;
  agent: {name: string; voiceKey: VoiceKey};
  status: 'waiting' | 'working';
  caption?: string;
}

export const WaitingAgentStartRow: React.FC<WaitingAgentStartRowProps> = ({agent, status, caption, id}) => (
  <div id={id} style={{display: 'flex', alignItems: 'center', gap: spacing[3]}}>
    <Avatar kind="agent" initials={agent.name[0]} voiceKey={agent.voiceKey} size={28} presence={status} />
    <span style={textStyle(type.titleMd, colors.onSurface)}>{agent.name}</span>
    <span style={textStyle(type.labelMd, colors.onSurfaceVariant)}>
      {status === 'working' ? '작업 중' : '대기 중'}
    </span>
    {caption && <span style={textStyle(type.bodySm, colors.onSurfaceVariant)}>· {caption}</span>}
  </div>
);
