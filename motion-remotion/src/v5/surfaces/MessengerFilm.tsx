// film (PitchV5) only: animated 메신저. One unified row list
// [도윤1, 지은, PM reply, 서연, 도윤2, decision card, PM memo, 민호, PM answer];
// each row sits in a collapsible slot (grid-row fraction) so the column re-centers
// smoothly while rows come and go: B1 layout (4 messages), B3 (reply open, 도윤1
// gone), B4 (card), B5 (memo), B6/B7 (민호 + answer). Final B1 / B3 / B7 states
// equal the style frames.
import React from 'react';
import {AddIcon, CheckCircleIcon, SendIcon} from '../../ui/icons';
import {MESSENGER, B3COPY, B7COPY} from '../content';
import {useFs} from './SurfaceFrame';
import {HARMONY_RING, useTheme} from './theme';
import {morphInStyle, morphOutStyle, useFilm} from './film';

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

/** collapsible slot: 1fr = natural height, 0fr = gone; the gap below only exists while a later row is open */
const Slot: React.FC<{open: number; next: number; children: React.ReactNode}> = ({open, next, children}) => (
  <div style={{display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: `${Math.max(0, open)}fr`, marginBottom: GAP * open * Math.min(1, next)}}>
    <div style={{minHeight: 0, overflow: open < 0.999 ? 'hidden' : 'visible', opacity: Math.min(1, open * 3)}}>{children}</div>
  </div>
);

const PmAvatar: React.FC<{sz: number; pop?: number}> = ({sz, pop = 1}) => {
  const fs = useFs();
  const {pal: c} = useTheme();
  return (
    <div style={{borderRadius: 14, padding: 2.5, background: HARMONY_RING, flexShrink: 0, transform: `scale(${0.4 + 0.6 * pop})`, opacity: Math.min(1, pop * 2.5)}}>
      <div style={{width: sz, height: sz, borderRadius: 12, background: c.primary, color: c.onPrimary, fontSize: fs(20), fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{B3COPY.pmInitial}</div>
    </div>
  );
};

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
  const av = Math.round(base * 1.7);
  const sz = Math.round(base * 1.95) - 5;
  const msg = (m: (typeof MESSENGER.messages)[number], p: number, asked?: boolean, typing = 0) => (
    <div style={{position: 'relative'}}>
    <div style={{...pop(p), position: 'relative', display: 'flex', gap: 12, flexDirection: m.mine ? 'row-reverse' : 'row', alignItems: 'flex-end'}}>
      <Avatar name={m.who} size={av} fs={fs(22)} />
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
      {typing > 0.01 && (
        <div style={{position: 'absolute', left: av + 12, bottom: 0, display: 'flex', gap: 7, alignItems: 'center', padding: '14px 18px', borderRadius: 18, borderTopLeftRadius: 6, background: c.surfaceContainerLow, boxShadow: bubbleBorder, opacity: typing}}>
          {[0, 1, 2].map((j) => (
            <span key={j} style={{width: 9, height: 9, borderRadius: 9, background: c.outline, opacity: 0.4 + 0.6 * (Math.floor(S.dots / 4) % 3 === j ? 1 : 0), transform: `translateY(${Math.floor(S.dots / 4) % 3 === j ? -4 : 0}px)`}} />
          ))}
        </div>
      )}
    </div>
  );

  // ---- the decision card (B4): outline-lit while proposed, solid once a human clicks
  const k = S.card;
  const cardScale = (0.94 + 0.06 * k.pop) * (1 + 0.05 * k.bounce);
  const cursorOff = (() => {
    const n = k.press > 0 ? 1 : S.cursor.near;
    const driftX = Math.sin(S.cursor.frame / 11) * 6 * (1 - n);
    const driftY = Math.cos(S.cursor.frame / 9) * 5 * (1 - n);
    return {x: 230 * (1 - n) + 34 + driftX, y: 150 * (1 - n) + 28 + driftY};
  })();
  const card = (
    <div
      data-anchor="s-card"
      style={{
        position: 'relative',
        borderRadius: 20,
        padding: '14px 18px 16px',
        background: c.surface,
        boxShadow: `inset 0 0 0 2.5px rgba(61,190,139,${0.9 * k.lit}), 0 0 ${26 * k.lit}px rgba(61,190,139,${0.28 * k.lit}), 0 ${10 + 14 * k.pop}px ${20 + 14 * k.pop}px -10px rgba(0,0,0,.32)`,
        transform: `translateY(${(1 - k.pop) * 38}px) scale(${cardScale})`,
        transformOrigin: '50% 100%',
        opacity: Math.min(1, k.pop * 3),
      }}
    >
      {k.solid > 0.001 && <div style={{position: 'absolute', inset: 0, borderRadius: 20, background: c.primaryContainer, opacity: 0.85, clipPath: `circle(${k.solid * 900}px at 96px calc(100% - 42px))`}} />}
      <div style={{position: 'relative', display: 'flex', alignItems: 'center', gap: 12}}>
        <PmAvatar sz={sz} />
        <div style={{display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0}}>
          <span style={{fontSize: small, fontWeight: 700, color: c.primary, lineHeight: 1.1}}>{B3COPY.pmName}</span>
          <span style={{fontSize: small, fontWeight: 600, color: c.onSurfaceVariant, lineHeight: 1.1}}>@지은</span>
        </div>
        <div style={{marginLeft: 'auto', position: 'relative', height: 36, minWidth: 128}}>
          <div style={{...morphOutStyle(k.chip), position: 'absolute', right: 0, top: 0, padding: '3px 14px', borderRadius: 999, boxShadow: `inset 0 0 0 1.5px ${c.outline}`, color: c.onSurfaceVariant, fontSize: small, fontWeight: 700, whiteSpace: 'nowrap', visibility: k.chip.out >= 1 ? 'hidden' : 'visible'}}>제안</div>
          {k.chip.in > 0 && (
            <div style={{...morphInStyle(k.chip), position: 'absolute', right: 0, top: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '3px 14px', borderRadius: 999, background: c.primary, color: c.onPrimary, fontSize: small, fontWeight: 700, whiteSpace: 'nowrap'}}>
              <CheckCircleIcon size={small} /> {B7COPY.decisionChip}
            </div>
          )}
        </div>
      </div>
      <div style={{position: 'relative', marginTop: 12, fontSize: base, fontWeight: 700, lineHeight: 1.25, whiteSpace: 'nowrap'}}>{B7COPY.decisionCard}</div>
      <div style={{position: 'relative', marginTop: 14, display: 'flex', gap: 12}}>
        <div style={{position: 'relative', padding: '9px 26px', borderRadius: 999, background: c.primary, color: c.onPrimary, fontSize: base, fontWeight: 700, transform: `scale(${1 - 0.14 * k.press})`, filter: `brightness(${1 - 0.28 * k.press})`}}>
          옮기기
          {k.flash > 0 && k.flash < 1 && (
            <div style={{position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, pointerEvents: 'none'}}>
              <div style={{position: 'absolute', left: -(40 + 300 * k.flash), top: -(40 + 300 * k.flash), width: 80 + 600 * k.flash, height: 80 + 600 * k.flash, borderRadius: '50%', border: '4px solid #3DBE8B', opacity: 0.7 * (1 - k.flash), boxSizing: 'border-box'}} />
            </div>
          )}
          {S.cursor.a > 0.01 && (
            <div style={{position: 'absolute', left: cursorOff.x, top: cursorOff.y, opacity: S.cursor.a, pointerEvents: 'none', zIndex: 3}}>
              <svg width="64" height="64" viewBox="0 0 24 24" style={{display: 'block', transform: `translate(-10px, -8px) scale(${1 - 0.12 * k.press})`}}>
                <path d="M5 3l13 7-6 1.8L9.6 18z" fill="#18201C" stroke="#FFFFFF" strokeWidth="1.6" strokeLinejoin="round" />
              </svg>
              <div style={{position: 'absolute', left: 40, top: 48, padding: '3px 16px', borderRadius: 12, background: '#18201C', color: '#FFFFFF', fontSize: Math.max(small, 28), fontWeight: 800, whiteSpace: 'nowrap', boxShadow: '0 0 0 2px #FFFFFF'}}>지은</div>
            </div>
          )}
        </div>
        <div style={{padding: '9px 26px', borderRadius: 999, boxShadow: `inset 0 0 0 2px ${c.outlineVariant}`, color: c.onSurface, fontSize: base, fontWeight: 600, opacity: 1 - 0.4 * k.solid}}>그대로</div>
      </div>
    </div>
  );

  const memo = (
    <div data-anchor="s-memo" style={{display: 'flex', gap: 12, alignItems: 'flex-end'}}>
      <PmAvatar sz={sz} pop={S.memo} />
      <div style={{display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0}}>
        <span style={{fontSize: small, fontWeight: 700, color: c.primary, lineHeight: 1.1, opacity: Math.min(1, S.memo * 2.5)}}>{B3COPY.pmName}</span>
        <div style={{...pop(S.memo), background: c.primaryContainer, color: c.onPrimaryContainer, borderRadius: 18, borderTopLeftRadius: 6, padding: '9px 16px', fontSize: base, fontWeight: 600, lineHeight: 1.25, whiteSpace: 'nowrap'}}>내일 10시에 다시 확인할게요</div>
      </div>
    </div>
  );

  const minho = (
    <div style={{...pop(S.minho), display: 'flex', gap: 12, alignItems: 'flex-end'}}>
      <Avatar name="민호" size={av} fs={fs(22)} />
      <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
        <span style={{fontSize: small, fontWeight: 600, color: c.onSurfaceVariant, lineHeight: 1.1}}>민호</span>
        <div style={{background: c.surfaceContainerLow, borderRadius: 18, borderTopLeftRadius: 6, padding: '9px 16px', fontSize: base, fontWeight: 500, lineHeight: 1.25, whiteSpace: 'nowrap', boxShadow: bubbleBorder}}>{B7COPY.minhoQ}</div>
      </div>
    </div>
  );

  const answer = (
    <div data-anchor="pm-answer" style={{display: 'flex', gap: 12, alignItems: 'flex-end'}}>
      <PmAvatar sz={sz} pop={S.answer} />
      <div style={{display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0}}>
        <span style={{fontSize: small, fontWeight: 700, color: c.primary, lineHeight: 1.1, opacity: Math.min(1, S.answer * 2.5)}}>{B3COPY.pmName}</span>
        <div style={{...pop(S.answer), background: c.primaryContainer, color: c.onPrimaryContainer, borderRadius: 18, borderTopLeftRadius: 6, padding: '9px 16px', fontSize: base, fontWeight: 600, lineHeight: 1.25}}>{B7COPY.pmAnswer}</div>
        <div data-anchor="s-source" style={{alignSelf: 'flex-start', padding: '3px 12px', borderRadius: 999, boxShadow: `inset 0 0 0 1.5px ${c.outlineVariant}`, color: c.onSurfaceVariant, fontSize: small, fontWeight: 700, whiteSpace: 'nowrap', opacity: Math.min(1, S.source * 2), transform: `scale(${0.9 + 0.1 * Math.min(1, S.source)})`, transformOrigin: '0 50%'}}>{B7COPY.source}</div>
      </div>
    </div>
  );

  const O = S.open;
  const slots: {key: string; open: number; node: React.ReactNode}[] = [
    {key: 'do1', open: O.do1, node: msg(m0, S.bubble[0])},
    {key: 'ji', open: O.ji, node: msg(m1, S.bubble[1], true, S.typing[0])},
    {
      key: 'reply',
      open: O.reply,
      node: (
        <div data-anchor="pm-reply" style={{display: 'flex', gap: 12, alignItems: 'flex-end'}}>
          <PmAvatar sz={sz} pop={S.reply} />
          <div style={{display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0}}>
            <span style={{fontSize: small, fontWeight: 700, color: c.primary, lineHeight: 1.1, opacity: Math.min(1, S.reply * 2.5)}}>{B3COPY.pmName}</span>
            <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
              <div style={{...pop(S.reply), background: c.primaryContainer, color: c.onPrimaryContainer, borderRadius: 18, borderTopLeftRadius: 6, padding: '9px 16px', fontSize: base, fontWeight: 600, lineHeight: 1.25, whiteSpace: 'nowrap'}}>{B3COPY.reply}</div>
              <div style={{padding: '3px 12px', borderRadius: 999, background: c.surfaceContainerHigh, color: c.primary, fontSize: small, fontWeight: 700, whiteSpace: 'nowrap', opacity: Math.min(1, S.badge * 2), transform: `scale(${0.8 + 0.2 * S.badge})`}}>{B3COPY.delivered}</div>
            </div>
          </div>
        </div>
      ),
    },
    {key: 'seo', open: O.seo, node: msg(m2, S.bubble[2], false, S.typing[1])},
    {key: 'do2', open: O.do2, node: msg(m3, S.bubble[3], false, S.typing[2])},
    {key: 'card', open: O.card, node: card},
    {key: 'memo', open: O.memo, node: memo},
    {key: 'minho', open: O.minho, node: minho},
    {key: 'answer', open: O.answer, node: answer},
  ];
  return (
    <div style={{position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: c.surface}}>
      <div style={{height: 78, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 26px', borderBottom: `1px solid ${c.outlineVariant}`, background: c.surfaceContainerLow}}>
        <span style={{fontSize: fs(30), fontWeight: 700, color: c.outline}}>#</span>
        <span style={{fontSize: fs(28), fontWeight: 700}}>{MESSENGER.channel}</span>
        <span style={{marginLeft: 'auto', fontSize: small, fontWeight: 500, color: c.onSurfaceVariant}}>{MESSENGER.members}</span>
      </div>
      <div style={{flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '10px 26px'}}>
        {slots.map((s, i) => (
          <Slot key={s.key} open={s.open} next={Math.max(0, ...slots.slice(i + 1).map((x) => x.open))}>
            {s.node}
          </Slot>
        ))}
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
              const on = Math.floor(S.dots / 5) % 4 === j + 1 ? 1 : 0;
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
