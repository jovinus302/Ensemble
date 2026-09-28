import React from 'react';
import {colors, radius, spacing, type, textStyle, elevation, VoiceKey, voices} from '../tokens';
import {Avatar} from '../primitives/Avatar';
import {StatusChip, StatusChipState} from '../primitives/StatusChip';
import {ClockIcon, TagIcon} from '../icons';

export interface AssignmentProposalCardProps {
  id?: string;
  fromAvatar: 'pm';
  toAgent: {name: string; role: string; voiceKey: VoiceKey};
  title: string;
  criteria: string[];
  dueLabel: string;
  budgetLabel: string;
  status: StatusChipState;
}

// Card-assignment: white surface card, radius xl, padding 16, elevation level1.
export const AssignmentProposalCard: React.FC<AssignmentProposalCardProps> = ({
  id,
  toAgent,
  title,
  criteria,
  dueLabel,
  budgetLabel,
  status,
}) => (
  <div
    id={id}
    style={{
      background: colors.surface,
      borderRadius: radius.xl,
      boxShadow: elevation.level1,
      padding: spacing[3],
      maxWidth: spacing.messageMax,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}
  >
    <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
      <Avatar kind="pm" size={28} />
      <span style={{color: colors.outline, fontSize: 14}}>→</span>
      <Avatar kind="agent" initials={toAgent.name[0]} voiceKey={toAgent.voiceKey} size={28} />
      <span style={textStyle(type.titleMd, colors.onSurface)}>{toAgent.name}</span>
      <span style={textStyle(type.labelSm, colors.onSurfaceVariant)}>{toAgent.role}</span>
    </div>
    <span style={textStyle(type.titleLg, colors.onSurface)}>{title}</span>
    <div style={{display: 'flex', flexDirection: 'column', gap: 3}}>
      {criteria.map((c, i) => (
        <div key={i} style={{display: 'flex', alignItems: 'flex-start', gap: 6}}>
          <span style={{color: voices[toAgent.voiceKey].main, fontSize: 14, lineHeight: '21px'}}>·</span>
          <span style={textStyle(type.bodyMd, colors.onSurfaceVariant)}>{c}</span>
        </div>
      ))}
    </div>
    <div style={{display: 'flex', alignItems: 'center', gap: 16}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 4}}>
        <ClockIcon size={16} color={colors.onSurfaceVariant} />
        <span style={textStyle(type.labelMd, colors.onSurfaceVariant)}>{dueLabel}</span>
      </div>
      <div style={{display: 'flex', alignItems: 'center', gap: 4}}>
        <TagIcon size={16} color={colors.onSurfaceVariant} />
        <span style={textStyle(type.labelMd, colors.onSurfaceVariant)}>{budgetLabel}</span>
      </div>
      <StatusChip state={status} />
      <div style={{display: 'flex', gap: 16, marginLeft: 'auto'}}>
        <span style={textStyle(type.labelLg, colors.primary)}>담당 변경</span>
        <span style={textStyle(type.labelLg, colors.primary)}>세부</span>
      </div>
    </div>
  </div>
);
