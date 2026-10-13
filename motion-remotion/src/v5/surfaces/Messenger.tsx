// 메신저: channel header, a short thread, composer. Neutral grays only; people
// are told apart by name text, not by color. B3 (v6 frames): the 지은 question
// gets an amber ring and the PM Agent reply (harmony-ringed rounded-square
// avatar, "전달됨") sits under it; the first message is scrolled out to make room.
import React from 'react';
import {AddIcon, SendIcon} from '../../ui/icons';
import {MESSENGER, B3COPY, B7COPY} from '../content';
import {useFs} from './SurfaceFrame';
import {Cursor, HARMONY_RING, useTheme} from './theme';

const Avatar: React.FC<{name: string; size: number; fs: number}> = ({name, size, fs}) => {
  const {pal: c} = useTheme();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size,
        flexShrink: 0,
        background: c.secondaryContainer,
        color: c.onSecondaryContainer,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: fs,
        fontWeight: 700,
        boxShadow: c.dark ? 'inset 0 1px 0 rgba(255,255,255,.08), 0 1px 2px rgba(0,0,0,.4)' : 'inset 0 1px 0 rgba(255,255,255,.8), 0 1px 2px rgba(23,59,48,.16)',
      }}
    >
      {name[0]}
    </div>
  );
};

export const Messenger: React.FC = () => {
  const fs = useFs();
  const {pal: c, state, cursor, messengerCursor} = useTheme();
  const b7 = state === 'B7';
  const b3 = state === 'B3';
  const base = fs(24);
  const small = fs(20);
  const msgs = b3 ? MESSENGER.messages.slice(1) : MESSENGER.messages;
  const bubbleBorder = c.dark ? `inset 0 0 0 1px ${c.outlineVariant}` : 'inset 0 0 0 1px rgba(201,209,203,.6)';
  const row = (m: (typeof MESSENGER.messages)[number], i: number) => {
    const asked = b3 && m.who === '지은';
    const showCursor = cursor && messengerCursor === 'first' && !b3 && i === 0;
    return (
      <React.Fragment key={m.who + m.text}>
        <div style={{display: 'flex', gap: 12, flexDirection: m.mine ? 'row-reverse' : 'row', alignItems: 'flex-end'}}>
          <Avatar name={m.who} size={Math.round(base * 1.7)} fs={fs(22)} />
          <div style={{display: 'flex', flexDirection: 'column', alignItems: m.mine ? 'flex-end' : 'flex-start', gap: 4, minWidth: 0}}>
            <span style={{fontSize: small, fontWeight: 600, color: c.onSurfaceVariant, lineHeight: 1.1}}>{m.who}</span>
            <div
              style={{
                background: asked ? c.warningContainer : m.mine ? c.surfaceContainerHigh : c.surfaceContainerLow,
                borderRadius: 18,
                borderTopLeftRadius: m.mine ? 18 : 6,
                borderTopRightRadius: m.mine ? 6 : 18,
                padding: '9px 16px',
                fontSize: base,
                fontWeight: 500,
                lineHeight: 1.25,
                whiteSpace: 'nowrap',
                boxShadow: asked ? `inset 0 0 0 3px ${c.warning}` : bubbleBorder,
              }}
            >
              {m.text}
              {showCursor && <Cursor color={cursor!} />}
            </div>
          </div>
        </div>
        {asked && (
          <div data-anchor="pm-reply" style={{display: 'flex', gap: 12, alignItems: 'flex-end'}}>
            <div style={{borderRadius: 14, padding: 2.5, background: HARMONY_RING, flexShrink: 0}}>
              <div
                style={{
                  width: Math.round(base * 1.95) - 5,
                  height: Math.round(base * 1.95) - 5,
                  borderRadius: 12,
                  background: c.primary,
                  color: c.onPrimary,
                  fontSize: fs(20),
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {B3COPY.pmInitial}
              </div>
            </div>
            <div style={{display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0}}>
              <span style={{fontSize: small, fontWeight: 700, color: c.primary, lineHeight: 1.1}}>{B3COPY.pmName}</span>
              <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                <div style={{background: c.primaryContainer, color: c.onPrimaryContainer, borderRadius: 18, borderTopLeftRadius: 6, padding: '9px 16px', fontSize: base, fontWeight: 600, lineHeight: 1.25, whiteSpace: 'nowrap'}}>
                  {B3COPY.reply}
                  {cursor && messengerCursor === 'reply' && <Cursor color={cursor} />}
                </div>
                <div style={{padding: '3px 12px', borderRadius: 999, background: c.surfaceContainerHigh, color: c.primary, fontSize: small, fontWeight: 700, whiteSpace: 'nowrap'}}>{B3COPY.delivered}</div>
              </div>
            </div>
          </div>
        )}
      </React.Fragment>
    );
  };
  return (
    <div style={{position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: c.surface}}>
      <div
        style={{
          height: 78,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 26px',
          borderBottom: `1px solid ${c.outlineVariant}`,
          background: c.surfaceContainerLow,
        }}
      >
        <span style={{fontSize: fs(30), fontWeight: 700, color: c.outline}}>#</span>
        <span style={{fontSize: fs(28), fontWeight: 700}}>{MESSENGER.channel}</span>
        <span style={{marginLeft: 'auto', fontSize: small, fontWeight: 500, color: c.onSurfaceVariant}}>{MESSENGER.members}</span>
      </div>
      <div style={{flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14, padding: '10px 26px'}}>
        {b7 ? (
          <>
            <div style={{display: 'flex', gap: 12, alignItems: 'flex-end'}}>
              <Avatar name="민호" size={Math.round(base * 1.7)} fs={fs(22)} />
              <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
                <span style={{fontSize: small, fontWeight: 600, color: c.onSurfaceVariant, lineHeight: 1.1}}>민호</span>
                <div style={{background: c.surfaceContainerLow, borderRadius: 18, borderTopLeftRadius: 6, padding: '9px 16px', fontSize: base, fontWeight: 500, lineHeight: 1.25, whiteSpace: 'nowrap', boxShadow: bubbleBorder}}>{B7COPY.minhoQ}</div>
              </div>
            </div>
            <div data-anchor="pm-reply" style={{display: 'flex', gap: 12, alignItems: 'flex-end'}}>
              <div style={{borderRadius: 14, padding: 2.5, background: HARMONY_RING, flexShrink: 0}}>
                <div style={{width: Math.round(base * 1.95) - 5, height: Math.round(base * 1.95) - 5, borderRadius: 12, background: c.primary, color: c.onPrimary, fontSize: fs(20), fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                  {B3COPY.pmInitial}
                </div>
              </div>
              <div style={{display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0}}>
                <span style={{fontSize: small, fontWeight: 700, color: c.primary, lineHeight: 1.1}}>{B3COPY.pmName}</span>
                <div style={{background: c.primaryContainer, color: c.onPrimaryContainer, borderRadius: 18, borderTopLeftRadius: 6, padding: '9px 16px', fontSize: base, fontWeight: 600, lineHeight: 1.25}}>{B7COPY.pmAnswer}</div>
                <div style={{alignSelf: 'flex-start', padding: '3px 12px', borderRadius: 999, boxShadow: `inset 0 0 0 1.5px ${c.outlineVariant}`, color: c.onSurfaceVariant, fontSize: small, fontWeight: 700, whiteSpace: 'nowrap'}}>{B7COPY.source}</div>
              </div>
            </div>
          </>
        ) : (
          msgs.map(row)
        )}
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
            background: c.surface,
            boxShadow: `inset 0 0 0 1.5px ${c.outlineVariant}`,
            color: c.outline,
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
