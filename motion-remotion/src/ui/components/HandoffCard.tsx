import React from 'react';
import {colors, radius, spacing, type, textStyle, elevation, harmonyGradient, VoiceKey} from '../tokens';
import {Avatar} from '../primitives/Avatar';
import {DocCheckIcon} from '../icons';

export interface HandoffFields {
  purpose: string;
  background: string;
  decisionReason: string;
  progress: string;
  result: string;
}

export interface HandoffCardProps {
  id?: string;
  fromAgent: {name: string; voiceKey: VoiceKey};
  toAgent: {name: string; kind: 'human' | 'agent'; voiceKey?: VoiceKey};
  fields: HandoffFields;
  understoodLine: string;
}

const Field: React.FC<{label: string; children: React.ReactNode}> = ({label, children}) => (
  <div style={{display: 'flex', gap: 12}}>
    <span style={{...textStyle(type.labelMd, colors.onSurfaceVariant), width: 76, flexShrink: 0}}>{label}</span>
    <span style={textStyle(type.bodyMd, colors.onSurface)}>{children}</span>
  </div>
);

// Card-handoff: secondary-container background, radius xl, padding 20,
// elevation level1.
export const HandoffCard: React.FC<HandoffCardProps> = ({id, fromAgent, toAgent, fields, understoodLine}) => (
  <div
    id={id}
    style={{
      background: colors.secondaryContainer,
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
      <Avatar kind="agent" initials={fromAgent.name[0]} voiceKey={fromAgent.voiceKey} size={28} />
      <div style={{width: 28, height: 2, background: harmonyGradient, borderRadius: 1}} />
      <Avatar
        kind={toAgent.kind}
        initials={toAgent.name[0]}
        voiceKey={toAgent.voiceKey}
        size={28}
      />
      <span style={textStyle(type.titleMd, colors.onSecondaryContainer, {marginLeft: 4})}>맥락을 넘겼어요</span>
      <span style={textStyle(type.labelSm, colors.onSurfaceVariant)}>
        · {fromAgent.name} → {toAgent.name}
      </span>
    </div>
    <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
      <Field label="목적">{fields.purpose}</Field>
      <Field label="배경">{fields.background}</Field>
      <Field label="결정 이유">
        <span style={{display: 'inline-flex', alignItems: 'center', gap: 4}}>
          <DocCheckIcon size={14} color={colors.primary} />
          <span style={{color: colors.primary, textDecoration: 'underline'}}>{fields.decisionReason}</span>
        </span>
      </Field>
      <Field label="진행 상태">{fields.progress}</Field>
      <Field label="결과·산출물">{fields.result}</Field>
    </div>
    <div style={{display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginTop: 2}}>
      <span style={{...textStyle(type.bodyMd, colors.onSurface), flex: 1}}>{understoodLine}</span>
      <span style={{...textStyle(type.labelLg, colors.primary), flexShrink: 0}}>맥락 보완</span>
    </div>
  </div>
);
