import React from 'react';
import {colors, radius, spacing, type, textStyle, elevation} from '../tokens';
import {GoalConfirmCard, GoalConfirmCardProps} from './GoalConfirmCard';

export interface StepperStep {
  label: string;
  done: boolean;
}

export interface ThreadPanelProps {
  goal: GoalConfirmCardProps;
  steps: StepperStep[];
}

const tabs = ['스레드', '작업', '맥락', '과정'];

export const ThreadPanel: React.FC<ThreadPanelProps> = ({goal, steps}) => (
  <div
    style={{
      width: spacing.threadWidth,
      background: colors.surface,
      borderRadius: radius.xl,
      boxShadow: elevation.level2,
      boxSizing: 'border-box',
      padding: spacing[4],
      display: 'flex',
      flexDirection: 'column',
      gap: spacing[4],
    }}
  >
    <div style={{display: 'flex', gap: spacing[4], borderBottom: `1px solid ${colors.outlineVariant}`, paddingBottom: 10}}>
      {tabs.map((t, i) => (
        <span
          key={t}
          style={textStyle(i === 1 ? type.titleSm : type.labelLg, i === 1 ? colors.primary : colors.onSurfaceVariant)}
        >
          {t}
        </span>
      ))}
    </div>

    <GoalConfirmCard {...goal} />

    <div style={{display: 'flex', flexDirection: 'column', gap: 2}}>
      <span style={textStyle(type.labelMd, colors.onSurfaceVariant, {marginBottom: 6})}>리서치 Agent 작업 흐름</span>
      {steps.map((s, i) => (
        <div key={s.label} style={{display: 'flex', gap: 10, alignItems: 'flex-start'}}>
          <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', width: 12}}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: radius.full,
                background: s.done ? colors.primary : colors.surface,
                border: `2px solid ${s.done ? colors.primary : colors.outlineVariant}`,
              }}
            />
            {i < steps.length - 1 && (
              <div style={{width: 2, flex: 1, minHeight: 22, background: s.done ? colors.primary : colors.outlineVariant}} />
            )}
          </div>
          <span style={{...textStyle(type.bodyMd, colors.onSurface), paddingBottom: 14}}>{s.label}</span>
        </div>
      ))}
    </div>
  </div>
);
