// Copy of src/v3/ui/messages/MessageRenderer.tsx (v3 untouched, design-v4 §9).
// Round 3 (design-v4 r2 §4, secondary text >= 18px): the only behavioral
// difference is the type scale — uiTypeV4 (bodySm / labelMd / labelSm at 13
// logical, line heights unchanged) and EmbossChip labels at the same 13 — so
// timestamps, attachments, inline lines and chips read >= 18px on screen.
// Round C: every avatar is membersV4.MemberAvatar (one look per member).
// Layout, geometry and the hero/Riser branch are v3's verbatim.
import React from 'react';
import type {TimelineMessage} from '../../../v3/ui/content';
import {people, agents} from '../../../v3/ui/content';
import {TIMELINE_CONTENT_X0, TIMELINE_CONTENT_W} from '../../../v3/ui/content';
import {px, colors, uiTextStyle} from '../../../v3/tokens/video';
import {uiTypeV4 as uiType, SECONDARY_FONT} from '../typeV4';
import {MemberAvatar} from '../membersV4';
import {Riser} from '../../../v3/ui/primitives/Riser';
import {EmbossChip as EmbossChipV3} from '../../../v3/ui/primitives/EmbossChip';
import {PrimaryButton, TextButton, DoneChip, OutlinedButton} from '../../../v3/ui/primitives/Button';
import {GlowField} from '../../../v3/fx/GlowField';
import {AttachIcon, DocCheckIcon} from '../../../ui/icons';

const EmbossChip: React.FC<React.ComponentProps<typeof EmbossChipV3>> = (p) => <EmbossChipV3 {...p} fontSize={p.fontSize ?? SECONDARY_FONT} />;

const CARD_X = TIMELINE_CONTENT_X0;
const CARD_W = TIMELINE_CONTENT_W;

export interface MessageRenderV4Props {
  msg: TimelineMessage;
  boardY: number; // top position for this message's box, already scroll-resolved
  frame: number;
  hero?: boolean;
  heroZ?: number;
  glow?: boolean;
}

const bubbleShadow = '0 1px 2px rgba(23,59,48,.08), 0 1px 3px 1px rgba(23,59,48,.05)';

const Wrap: React.FC<{x: number; y: number; w: number; h: number; hero?: boolean; z?: number; radius?: number; background?: string; children: React.ReactNode; extraBoxShadow?: string}> = ({
  x,
  y,
  w,
  h,
  hero,
  z = 0,
  radius = 20,
  background = colors.surface,
  extraBoxShadow,
  children,
}) => {
  if (hero && z > 0) {
    return (
      <Riser x={x} y={y} w={w} h={h} z={z} radius={radius} background={background} extraBoxShadow={extraBoxShadow}>
        {children}
      </Riser>
    );
  }
  return (
    <div
      style={{
        position: 'absolute',
        left: px(x),
        top: px(y),
        width: px(w),
        height: px(h),
        borderRadius: px(radius),
        background,
        boxShadow: extraBoxShadow ?? bubbleShadow,
      }}
    >
      {children}
    </div>
  );
};

export const MessageRendererV4: React.FC<MessageRenderV4Props> = ({msg, boardY, frame, hero, heroZ = 90, glow}) => {
  const c = msg.content;
  const [y0, y1] = msg.contentY;
  const h = y1 - y0;

  if (c.kind === 'dateDivider') {
    return (
      <div style={{position: 'absolute', left: px(CARD_X), top: px(boardY), width: px(CARD_W), textAlign: 'center'}}>
        <span style={uiTextStyle(uiType.labelSm, colors.onSurfaceVariant)}>{c.label}</span>
      </div>
    );
  }

  if (c.kind === 'human') {
    const p = people[c.speaker];
    return (
      <div style={{position: 'absolute', left: px(CARD_X), top: px(boardY), width: px(CARD_W), display: 'flex', gap: px(12)}}>
        <MemberAvatar who={c.speaker} size={px(36)} />
        <div>
          <div style={{display: 'flex', alignItems: 'baseline', gap: px(8)}}>
            <span style={uiTextStyle(uiType.titleMd, colors.onSurface)}>{p.name}</span>
            <span style={uiTextStyle(uiType.labelSm, colors.onSurfaceVariant)}>{c.time}</span>
          </div>
          <div style={{...uiTextStyle(uiType.messageBody, colors.onSurface), marginTop: px(2)}}>{c.text}</div>
          {c.attachment && (
            <div
              style={{
                marginTop: px(8),
                display: 'inline-flex',
                alignItems: 'center',
                gap: px(6),
                padding: `${px(6)}px ${px(12)}px`,
                borderRadius: px(12),
                background: colors.surfaceContainerLow,
              }}
            >
              <AttachIcon size={px(14)} color={colors.onSurfaceVariant} />
              <span style={uiTextStyle(uiType.bodySm, colors.onSurfaceVariant)}>{c.attachment}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (c.kind === 'pmBubble') {
    return (
      <div style={{position: 'absolute', left: px(CARD_X), top: px(boardY), width: px(CARD_W), display: 'flex', gap: px(12)}}>
        <MemberAvatar who="pm" size={px(40)} frame={frame} />
        <div>
          <span style={uiTextStyle(uiType.titleMd, colors.onSurface)}>{agents.pm.name}</span>
          <div
            style={{
              marginTop: px(4),
              maxWidth: px(CARD_W - 60),
              padding: `${px(10)}px ${px(16)}px`,
              borderRadius: px(18),
              background: colors.primaryContainer,
              ...uiTextStyle(uiType.messageBody, colors.onPrimaryContainer),
            }}
          >
            {c.text}
          </div>
          {c.inlineLine && (
            <div style={{marginTop: px(6), display: 'flex', alignItems: 'center', gap: px(6)}}>
              <DocCheckIcon size={px(16)} color={colors.onSurfaceVariant} />
              <span style={uiTextStyle(uiType.bodySm, colors.onSurfaceVariant)}>{c.inlineLine}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (c.kind === 'agentBubble') {
    const a = agents[c.agent];
    return (
      <div style={{position: 'absolute', left: px(CARD_X), top: px(boardY), width: px(CARD_W), display: 'flex', gap: px(12)}}>
        <MemberAvatar who={c.agent} size={px(36)} />
        <div>
          <span style={uiTextStyle(uiType.titleMd, colors.onSurface)}>{a.name}</span>
          <div style={{...uiTextStyle(uiType.messageBody, colors.onSurface), marginTop: px(2)}}>{c.text}</div>
          {c.attachment && (
            <div
              style={{
                marginTop: px(8),
                display: 'inline-flex',
                alignItems: 'center',
                gap: px(6),
                padding: `${px(6)}px ${px(12)}px`,
                borderRadius: px(12),
                background: colors.surfaceContainerLow,
              }}
            >
              <AttachIcon size={px(14)} color={colors.onSurfaceVariant} />
              <span style={uiTextStyle(uiType.bodySm, colors.onSurfaceVariant)}>{c.attachment}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (c.kind === 'decisionCard') {
    return (
      <Wrap x={CARD_X} y={boardY} w={CARD_W} h={h} hero={hero} z={hero ? heroZ : 0} background={colors.surface}>
        <div style={{padding: px(20)}}>
          <div style={uiTextStyle(uiType.messageBody, colors.onSurface)}>{c.text}</div>
          <div style={{marginTop: px(10), display: 'flex', gap: px(10)}}>
            {c.options.map((o) => (
              <div key={o} style={{padding: `${px(8)}px ${px(14)}px`, borderRadius: px(12), background: colors.surfaceContainerLow, ...uiTextStyle(uiType.bodyMd, colors.onSurface)}}>
                {o}
              </div>
            ))}
          </div>
        </div>
      </Wrap>
    );
  }

  if (c.kind === 'planCard') {
    // Round-7 fix: rows are fixed-width (avatar + 220 + chip), so a full-timeline-
    // width card left its right third and bottom band empty. Size the card to its
    // content; the timeline slot (contentY) is unchanged.
    const planW = Math.min(CARD_W, 440);
    const planH = Math.min(h, 360);
    return (
      <>
        {glow && <GlowField x={px(CARD_X)} y={px(boardY)} w={px(planW)} h={px(planH)} frame={frame} pad={px(48)} />}
        <Wrap x={CARD_X} y={boardY} w={planW} h={planH} hero={hero} z={hero ? heroZ : 0} background={colors.surface} extraBoxShadow="inset 0 1px 0 rgba(255,255,255,.9), 0 2px 4px rgba(23,59,48,.06)">
          <div style={{position: 'relative', padding: px(20), height: '100%', boxSizing: 'border-box'}}>
            <div style={{position: 'absolute', left: 0, top: px(8), bottom: px(8), width: px(3), background: colors.primary, borderRadius: px(2)}} />
            <div style={uiTextStyle(uiType.titleMd, colors.onSurface)}>{c.title}</div>
            <div style={{marginTop: px(6), ...uiTextStyle(uiType.bodyMd, colors.onSurfaceVariant)}}>{c.conclusion}</div>
            <div style={{marginTop: px(16), display: 'flex', flexDirection: 'column', gap: px(8)}}>
              {c.rows.map((r, i) => (
                <div key={i} style={{display: 'flex', alignItems: 'center', gap: px(10), height: px(44)}}>
                  <MemberAvatar who={r.who} size={px(32)} />
                  {/* fixed width (not flex:1) so the chip sits right after the
                      text instead of being pushed to the card's far edge —
                      round-3 fix for the "big empty middle" layout complaint */}
                  <div style={{width: px(220), flexShrink: 0}}>
                    <div style={uiTextStyle(uiType.bodyMd, colors.onSurface)}>{r.who}</div>
                    <div style={uiTextStyle(uiType.bodySm, colors.onSurfaceVariant)}>{r.what}</div>
                  </div>
                  <EmbossChip
                    label={r.chip.label}
                    container={r.chip.state === 'ready' ? colors.successContainer : colors.surfaceContainerHigh}
                    onContainer={colors.onSurface}
                  />
                </div>
              ))}
            </div>
            <div style={{marginTop: px(16), display: 'flex', alignItems: 'center', gap: px(12)}}>
              {c.approved ? (
                <DoneChip label={c.approvedMeta ?? '승인됨 · 김도윤 · 10:02 · 되돌리기'} />
              ) : (
                <>
                  <EmbossChip label="승인 필요" container={colors.warningContainer} onContainer={colors.onSurface} />
                  <PrimaryButton label="계획 승인" />
                  <TextButton label="수정 요청" />
                </>
              )}
            </div>
          </div>
        </Wrap>
      </>
    );
  }

  if (c.kind === 'handoffCard') {
    return (
      <Wrap x={CARD_X} y={boardY} w={CARD_W} h={h} hero={hero} z={hero ? heroZ : 0} background={colors.secondaryContainer}>
        <div style={{padding: px(20)}}>
          <div style={{display: 'flex', alignItems: 'center', gap: px(8)}}>
            {c.fromChain.map((f) => (
              <MemberAvatar key={f} who={f} size={px(28)} />
            ))}
            <div style={{width: px(24), height: px(2), background: colors.primary}} />
            <MemberAvatar who={c.to} size={px(28)} />
            <span style={{marginLeft: px(8), ...uiTextStyle(uiType.titleSm, colors.onSecondaryContainer)}}>{c.headline}</span>
          </div>
          <div style={{marginTop: px(14), display: 'flex', flexDirection: 'column', gap: px(8)}}>
            {c.fields.map((f) => (
              <div key={f.label} style={{display: 'flex', gap: px(10)}}>
                <div style={{width: px(88), flexShrink: 0, ...uiTextStyle(uiType.labelMd, colors.onSurfaceVariant)}}>{f.label}</div>
                <div style={uiTextStyle(uiType.bodyMd, colors.onSecondaryContainer)}>{f.value}</div>
              </div>
            ))}
          </div>
          <div style={{marginTop: px(14), display: 'flex', alignItems: 'center', gap: px(10)}}>
            <span style={uiTextStyle(uiType.bodySm, colors.onSurfaceVariant)}>받은 사람: {c.receivedBy}</span>
            <TextButton label="맥락 보완" />
          </div>
        </div>
      </Wrap>
    );
  }

  if (c.kind === 'typingBubble') {
    const a = agents[c.agent];
    return (
      <div style={{position: 'absolute', left: px(CARD_X), top: px(boardY), width: px(CARD_W), display: 'flex', gap: px(12)}}>
        <MemberAvatar who={c.agent} size={px(36)} />
        <div>
          <span style={uiTextStyle(uiType.titleMd, colors.onSurface)}>{a.name}</span>
          <div style={{...uiTextStyle(uiType.messageBody, colors.onSurface), marginTop: px(2)}}>{c.text}</div>
          <div style={{marginTop: px(8), display: 'flex', alignItems: 'center', gap: px(8)}}>
            <EmbossChip label={c.chipTo} container={colors.infoContainer} onContainer={colors.onSurface} />
            <span style={uiTextStyle(uiType.bodySm, colors.onSurfaceVariant)}>{c.typingLine}</span>
          </div>
        </div>
      </div>
    );
  }

  if (c.kind === 'approvalCard') {
    return (
      <>
        <Wrap
          x={CARD_X}
          y={boardY}
          w={CARD_W}
          h={h}
          hero={hero}
          z={hero ? heroZ : 0}
          background={colors.surface}
          extraBoxShadow="inset 0 1px 0 rgba(255,255,255,.9)"
        >
          <div style={{position: 'relative', padding: px(20), height: '100%', boxSizing: 'border-box'}}>
            <div style={{position: 'absolute', left: 0, top: px(8), bottom: px(8), width: px(4), background: colors.warning, borderRadius: px(2)}} />
            <div style={uiTextStyle(uiType.titleMd, colors.onSurface)}>{c.title}</div>
            <div style={{marginTop: px(12), display: 'flex', flexDirection: 'column', gap: px(6)}}>
              {c.fields.map((f) => (
                <div key={f.label} style={{display: 'flex', gap: px(10)}}>
                  <div style={{width: px(80), flexShrink: 0, ...uiTextStyle(uiType.labelMd, colors.onSurfaceVariant)}}>{f.label}</div>
                  <div style={uiTextStyle(uiType.bodyMd, colors.onSurface)}>{f.value}</div>
                </div>
              ))}
            </div>
            <div style={{marginTop: px(16), display: 'flex', gap: px(12)}}>
              {c.approved ? <DoneChip label={c.approvedMeta ?? '승인됨 · 김도윤 · 오후 3:40'} /> : (
                <>
                  <PrimaryButton label="초안 승인" />
                  <OutlinedButton label="보완 요청" />
                </>
              )}
            </div>
          </div>
        </Wrap>
      </>
    );
  }

  // goalCheckCard
  return (
    <Wrap x={CARD_X} y={boardY} w={CARD_W} h={h} hero={hero} z={hero ? heroZ : 0} radius={20} background={colors.brandInk}>
      <div style={{padding: px(20)}}>
        <div style={uiTextStyle(uiType.titleMd, '#E3EDE7')}>{c.title}</div>
        <div style={{marginTop: px(8), ...uiTextStyle(uiType.bodyMd, '#E3EDE7'), fontVariantNumeric: 'tabular-nums'}}>{c.progressLabel}</div>
        <div style={{marginTop: px(10), display: 'flex', alignItems: 'center', gap: px(8)}}>
          <EmbossChip label={c.remainingLabel} container={colors.warningContainer} onContainer={colors.onSurface} />
        </div>
        <div style={{marginTop: px(14), ...uiTextStyle(uiType.bodyMd, '#E3EDE7')}}>{c.pmLine}</div>
        <div style={{marginTop: px(10), display: 'flex', gap: px(10)}}>
          <PrimaryButton label="계획에 추가" bg="#8FD5B3" fg="#00382A" />
          <TextButton label="나중에" color="#E3EDE7" />
        </div>
      </div>
    </Wrap>
  );
};
