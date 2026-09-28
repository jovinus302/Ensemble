import React from 'react';
import {colors, radius, spacing, type, textStyle, voices, VoiceKey} from '../tokens';
import {Avatar} from '../primitives/Avatar';

export interface ChannelItem {
  id: string;
  name: string;
  active?: boolean;
  unread?: number;
}

export interface DmItem {
  id: string;
  name: string;
  unread?: number;
}

export interface AgentItem {
  name: string;
  voiceKey: VoiceKey;
  statusLabel: string;
}

export interface ChannelMemberListProps {
  projectName: string;
  channels: ChannelItem[];
  dms: DmItem[];
  agents: AgentItem[];
}

const SectionLabel: React.FC<{children: React.ReactNode}> = ({children}) => (
  <span style={textStyle(type.labelMd, colors.onSurfaceVariant, {textTransform: 'uppercase', letterSpacing: 0.4})}>
    {children}
  </span>
);

export const ChannelMemberList: React.FC<ChannelMemberListProps> = ({projectName, channels, dms, agents}) => (
  <div
    style={{
      width: spacing.sidebarWidth,
      height: '100%',
      background: colors.surfaceContainerLow,
      borderRight: `1px solid ${colors.outlineVariant}`,
      display: 'flex',
      flexDirection: 'column',
      gap: spacing[6],
      padding: `${spacing[5]}px ${spacing[4]}px`,
      boxSizing: 'border-box',
    }}
  >
    <div style={{display: 'flex', flexDirection: 'column', gap: 2}}>
      <span style={textStyle(type.labelMd, colors.onSurfaceVariant)}>프로젝트</span>
      <span style={textStyle(type.titleMd, colors.onSurface)}>{projectName}</span>
    </div>

    <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
      <SectionLabel>채널</SectionLabel>
      {channels.map((c) => (
        <div
          key={c.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 10px',
            borderRadius: radius.sm,
            background: c.active ? colors.secondaryContainer : 'transparent',
          }}
        >
          <span
            style={textStyle(c.active ? type.titleSm : type.labelLg, c.active ? colors.onSecondaryContainer : colors.onSurfaceVariant)}
          >
            # {c.name}
          </span>
          {c.unread ? (
            <span
              style={{
                ...textStyle(type.labelSm, colors.onPrimary),
                background: colors.primary,
                borderRadius: radius.full,
                minWidth: 16,
                height: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 4px',
              }}
            >
              {c.unread}
            </span>
          ) : null}
        </div>
      ))}
    </div>

    <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
      <SectionLabel>다이렉트</SectionLabel>
      {dms.map((d) => (
        <div key={d.id} style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
            <Avatar kind="human" initials={d.name[0]} size={24} />
            <span style={textStyle(type.labelLg, colors.onSurfaceVariant)}>{d.name}</span>
          </div>
          {d.unread ? (
            <span
              style={{
                ...textStyle(type.labelSm, colors.onPrimary),
                background: colors.primary,
                borderRadius: radius.full,
                minWidth: 16,
                height: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 4px',
              }}
            >
              {d.unread}
            </span>
          ) : null}
        </div>
      ))}
    </div>

    <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
      <SectionLabel>Agents</SectionLabel>
      {agents.map((a) => (
        <div key={a.name} style={{display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px'}}>
          <Avatar kind="agent" initials={a.name[0]} voiceKey={a.voiceKey} size={24} />
          <div style={{display: 'flex', flexDirection: 'column'}}>
            <span style={textStyle(type.labelLg, colors.onSurface)}>{a.name}</span>
            <span style={textStyle(type.labelSm, colors.onSurfaceVariant)}>{a.statusLabel}</span>
          </div>
        </div>
      ))}
    </div>
  </div>
);
