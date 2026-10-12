// 메신저: channel header, a short thread, composer. Neutral grays only; people
// are told apart by name text, not by color.
import React from 'react';
import {colors} from '../../v3/tokens/video';
import {AddIcon, SendIcon} from '../../ui/icons';
import {MESSENGER} from '../content';
import {useFs} from './SurfaceFrame';

const Avatar: React.FC<{name: string; size: number; fs: number}> = ({name, size, fs}) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size,
      flexShrink: 0,
      background: colors.secondaryContainer,
      color: colors.onSecondaryContainer,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: fs,
      fontWeight: 700,
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,.8), 0 1px 2px rgba(23,59,48,.16)',
    }}
  >
    {name[0]}
  </div>
);

export const Messenger: React.FC = () => {
  const fs = useFs();
  const base = fs(24);
  const small = fs(20);
  return (
    <div style={{position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: colors.surface}}>
      <div
        style={{
          height: 78,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 26px',
          borderBottom: `1px solid ${colors.outlineVariant}`,
          background: colors.surfaceContainerLow,
        }}
      >
        <span style={{fontSize: fs(30), fontWeight: 700, color: colors.outline}}>#</span>
        <span style={{fontSize: fs(28), fontWeight: 700}}>{MESSENGER.channel}</span>
        <span style={{marginLeft: 'auto', fontSize: small, fontWeight: 500, color: colors.onSurfaceVariant}}>{MESSENGER.members}</span>
      </div>
      <div style={{flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14, padding: '10px 26px'}}>
        {MESSENGER.messages.map((m, i) => (
          <div key={i} style={{display: 'flex', gap: 12, flexDirection: m.mine ? 'row-reverse' : 'row', alignItems: 'flex-end'}}>
            <Avatar name={m.who} size={Math.round(base * 1.7)} fs={fs(22)} />
            <div style={{display: 'flex', flexDirection: 'column', alignItems: m.mine ? 'flex-end' : 'flex-start', gap: 4, minWidth: 0}}>
              <span style={{fontSize: small, fontWeight: 600, color: colors.onSurfaceVariant, lineHeight: 1.1}}>{m.who}</span>
              <div
                style={{
                  background: m.mine ? colors.surfaceContainerHigh : colors.surfaceContainerLow,
                  borderRadius: 18,
                  borderTopLeftRadius: m.mine ? 18 : 6,
                  borderTopRightRadius: m.mine ? 6 : 18,
                  padding: '9px 16px',
                  fontSize: base,
                  fontWeight: 500,
                  lineHeight: 1.25,
                  whiteSpace: 'nowrap',
                  boxShadow: 'inset 0 0 0 1px rgba(201,209,203,.6)',
                }}
              >
                {m.text}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{height: 76, flexShrink: 0, padding: '0 22px 16px', display: 'flex', alignItems: 'center'}}>
        <div
          style={{
            flex: 1,
            height: 56,
            borderRadius: 28,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 20px',
            background: colors.surface,
            boxShadow: `inset 0 0 0 1.5px ${colors.outlineVariant}`,
            color: colors.outline,
            fontSize: small,
          }}
        >
          <AddIcon size={26} />
          <span style={{flex: 1}}>{MESSENGER.composer}</span>
          <SendIcon size={26} />
        </div>
      </div>
    </div>
  );
};
