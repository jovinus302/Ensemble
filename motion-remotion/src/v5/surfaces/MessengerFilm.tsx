// film (PitchV5) only: animated 메신저. One unified row list
// [도윤1, 지은, PM reply, 서연, 도윤2]; the B1 layout is (reply collapsed), the B3
// layout is (도윤1 collapsed, reply open): rows are collapsed with a grid-row
// fraction so the column re-centers smoothly. Final states equal the B1 / B3 stills.
import React from 'react';
import {AddIcon, SendIcon} from '../../ui/icons';
import {MESSENGER, B3COPY} from '../content';
import {useFs} from './SurfaceFrame';
import {HARMONY_RING, useTheme} from './theme';
import {useFilm} from './film';

const GAP = 14;

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

/** collapsible slot: 1fr = natural height, 0fr = gone (rows below slide up) */
const Slot: React.FC<{open: number; last?: boolean; children: React.ReactNode}> = ({open, last, children}) => (
  <div style={{display: 'grid', gridTemplateRows: `${Math.max(0, open)}fr`, marginBottom: last ? 0 : GAP * open}}>
    <div style={{minHeight: 0, overflow: open < 0.999 ? 'hidden' : 'visible', opacity: Math.min(1, open * 3)}}>{children}</div>
  </div>
);

export const MessengerFilm: React.FC = () => {
  const fs = useFs();
  const {pal: c} = useTheme();
  const S = useFilm()!.S;
  const base = fs(24);
  const small = fs(20);
  const bubbleBorder = c.dark ? `inset 0 0 0 1px ${c.outlineVariant}` : 'inset 0 0 0 1px rgba(201,209,203,.6)';
  const pop = (p: number): React.CSSProperties => ({
    transform: `translateY(${(1 - Math.min(1, p)) * 26}px) scale(${0.9 + 0.1 * p})`,
    opacity: Math.min(1, p * 3),
    transformOrigin: '0 100%',
  });
  const [m0, m1, m2, m3] = MESSENGER.messages;
  const msg = (m: (typeof MESSENGER.messages)[number], p: number, asked?: boolean) => (
    <div style={{...pop(p), display: 'flex', gap: 12, flexDirection: m.mine ? 'row-reverse' : 'row', alignItems: 'flex-end'}}>
      <Avatar name={m.who} size={Math.round(base * 1.7)} fs={fs(22)} />
      <div style={{display: 'flex', flexDirection: 'column', alignItems: m.mine ? 'flex-end' : 'flex-start', gap: 4, minWidth: 0}}>
        <span style={{fontSize: small, fontWeight: 600, color: c.onSurfaceVariant, lineHeight: 1.1}}>{m.who}</span>
        <div
          data-anchor={asked ? 's-ask' : undefined}
          style={{
            position: 'relative',
            background: m.mine ? c.surfaceContainerHigh : c.surfaceContainerLow,
            borderRadius: 18,
            borderTopLeftRadius: m.mine ? 18 : 6,
            borderTopRightRadius: m.mine ? 6 : 18,
            padding: '9px 16px',
            fontSize: base,
            fontWeight: 500,
            lineHeight: 1.25,
            whiteSpace: 'nowrap',
            boxShadow: bubbleBorder,
          }}
        >
          {asked && S.amber > 0 && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 'inherit',
                background: c.warningContainer,
                boxShadow: `inset 0 0 0 3px ${c.warning}, 0 0 ${12 * S.amberBreath}px rgba(154,91,0,${0.45 * S.amberBreath})`,
                opacity: Math.min(1, S.amber * 1.6),
                transform: `scale(${0.9 + 0.1 * S.amber + 0.03 * S.amberBreath})`,
              }}
            />
          )}
          <span style={{position: 'relative'}}>{m.text}</span>
        </div>
      </div>
    </div>
  );
  const sz = Math.round(base * 1.95) - 5;
  return (
    <div style={{position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: c.surface}}>
      <div style={{height: 78, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 26px', borderBottom: `1px solid ${c.outlineVariant}`, background: c.surfaceContainerLow}}>
        <span style={{fontSize: fs(30), fontWeight: 700, color: c.outline}}>#</span>
        <span style={{fontSize: fs(28), fontWeight: 700}}>{MESSENGER.channel}</span>
        <span style={{marginLeft: 'auto', fontSize: small, fontWeight: 500, color: c.onSurfaceVariant}}>{MESSENGER.members}</span>
      </div>
      <div style={{flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '10px 26px'}}>
        <Slot open={S.row1}>{msg(m0, S.bubble[0])}</Slot>
        <Slot open={1}>{msg(m1, S.bubble[1], true)}</Slot>
        <Slot open={S.replyRow}>
          <div data-anchor="pm-reply" style={{display: 'flex', gap: 12, alignItems: 'flex-end'}}>
            <div style={{borderRadius: 14, padding: 2.5, background: HARMONY_RING, flexShrink: 0, transform: `scale(${0.4 + 0.6 * S.reply})`, opacity: Math.min(1, S.reply * 2.5)}}>
              <div style={{width: sz, height: sz, borderRadius: 12, background: c.primary, color: c.onPrimary, fontSize: fs(20), fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{B3COPY.pmInitial}</div>
            </div>
            <div style={{display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0}}>
              <span style={{fontSize: small, fontWeight: 700, color: c.primary, lineHeight: 1.1, opacity: Math.min(1, S.reply * 2.5)}}>{B3COPY.pmName}</span>
              <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                <div style={{...pop(S.reply), background: c.primaryContainer, color: c.onPrimaryContainer, borderRadius: 18, borderTopLeftRadius: 6, padding: '9px 16px', fontSize: base, fontWeight: 600, lineHeight: 1.25, whiteSpace: 'nowrap'}}>{B3COPY.reply}</div>
                <div style={{padding: '3px 12px', borderRadius: 999, background: c.surfaceContainerHigh, color: c.primary, fontSize: small, fontWeight: 700, whiteSpace: 'nowrap', opacity: Math.min(1, S.badge * 2), transform: `scale(${0.8 + 0.2 * S.badge})`}}>{B3COPY.delivered}</div>
              </div>
            </div>
          </div>
        </Slot>
        <Slot open={1}>{msg(m2, S.bubble[2])}</Slot>
        <Slot open={1} last>
          {msg(m3, S.bubble[3])}
        </Slot>
      </div>
      <div style={{height: 76, flexShrink: 0, padding: '0 22px 16px', display: 'flex', alignItems: 'center'}}>
        <div style={{flex: 1, height: 56, borderRadius: 28, display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px', background: c.surface, boxShadow: `inset 0 0 0 1.5px ${c.outlineVariant}`, color: c.outline, fontSize: small}}>
          <AddIcon size={26} />
          <span style={{flex: 1}}>
            {MESSENGER.composer}
            <span style={{display: 'inline-block', width: 2, height: '1.05em', background: c.outline, marginLeft: 4, verticalAlign: '-0.15em', opacity: S.caret}} />
          </span>
          <span style={{display: 'inline-flex', gap: 7, alignItems: 'center', opacity: 0.75}}>
            {[0, 1, 2].map((j) => {
              const on = Math.floor(S.dots / 5) % 4 === j + 1 ? 1 : 0; // one dot lights per 5f, a 15f cycle plus a rest step: beat-synced typing indicator
              return <span key={j} style={{width: 9, height: 9, borderRadius: 9, background: c.outline, opacity: 0.35 + 0.65 * on, transform: `translateY(${-4 * on}px)`}} />;
            })}
          </span>
          <span style={{display: 'inline-flex', transform: `scale(${1 + 0.14 * S.send})`, color: c.outline}}>
            <SendIcon size={26} />
          </span>
        </div>
      </div>
    </div>
  );
};
