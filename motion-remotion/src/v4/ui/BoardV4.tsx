// Adapted copy of src/v3/ui/Board.tsx (v3 file untouched, design-v4 §9).
// Differences for the v4 look:
//  - no v3 Z-14 slab plane: thickness is BoardThickness, rendered by the
//    stage in its own rig behind this one (StageV4 `slab`); no ground-contact
//    ellipse and no drop shadow on the board plane — the board's shadow is
//    the detached WallShadow in the background layer (one consistent shadow);
//  - no ry-driven sheen band (feature beats are frontal and never orbit);
//  - timeline and right panel are the v4 copies (hero drawn once, in the
//    hero layer); `overlay` renders last inside the board body (veils, hero).
// Rail / sidebar / channel header / composer markup is v3's, verbatim.
import React from 'react';
import {Easing} from 'remotion';
import {BOARD_W, BOARD_H, AREAS, TEAM_ROWS, SIDEBAR_TEAM_Y0, SIDEBAR_TEAM_ROW_H, CHANNEL_TITLE, WORKSPACE_TITLE, PROJECT_TITLE} from '../../v3/ui/content';
import {px, colors, uiTextStyle} from '../../v3/tokens/video';
import {uiTypeV4 as uiType, SECONDARY_FONT, SIDEBAR_AVATAR} from './typeV4';
import {MemberAvatar} from './membersV4';
import type {MemberId} from './membersV4';
import type {ProductState, TeamStatus} from '../stateV4';
import {EmbossChip} from '../../v3/ui/primitives/EmbossChip';
import {AddIcon, ForumIcon, InfoIcon, AutoAwesomeIcon} from '../../v3/ui/icons';
import {TimelineV4} from './TimelineV4';
import {RightPanelV4} from './RightPanelV4';
import {BOARD_RADIUS} from '../config';

export interface BoardV4Props {
  frame: number;
  scrollY: number;
  heroMessageId?: string;
  heroRowId?: string;
  // round D: team chips and right panel come from one product state (stateV4)
  state: ProductState;
  overlay?: React.ReactNode;
  // design-v4 r3 B: the AI PM's landing reply (M1b) and its "지휘 중" switch.
  pmReply?: number; // M1b reveal 0..1 (default 1: already in the thread)
  pmActivation?: number; // AI PM row: 0 = "대기", (0,1) = POP in progress, 1 / undefined = "지휘 중"
  appearAt?: Record<string, number>; // PitchV4 message clock (see TimelineV4)
  reveal?: Record<string, number>;
}


// AI PM row status: "대기" until the PM acts, then "지휘 중" with one POP
// (chip overshoot + a single harmony ring expanding off the avatar).
const POP = Easing.bezier(0.34, 1.56, 0.64, 1);
const PmAvatarRing: React.FC<{p: number}> = ({p}) => {
  if (p <= 0 || p >= 1) return null;
  const size = px(SIDEBAR_AVATAR);
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: '50%',
        width: size,
        height: size,
        marginTop: -size / 2,
        borderRadius: '50%',
        background: harmonyConic,
        WebkitMaskImage: `radial-gradient(farthest-side, transparent calc(100% - ${px(3)}px), #000 calc(100% - ${px(3)}px))`,
        maskImage: `radial-gradient(farthest-side, transparent calc(100% - ${px(3)}px), #000 calc(100% - ${px(3)}px))`,
        transform: `scale(${1 + 0.8 * p})`,
        opacity: 0.9 * (1 - p),
        pointerEvents: 'none',
      }}
    />
  );
};
const harmonyConic = `conic-gradient(${colors.harmony1}, ${colors.harmony2}, ${colors.harmony3}, ${colors.harmony4}, ${colors.harmony1})`;

const PmChip: React.FC<{p: number}> = ({p}) =>
  p <= 0 ? (
    <EmbossChip label="대기" container={colors.surfaceContainerHigh} onContainer={colors.onSurface} fontSize={SECONDARY_FONT} />
  ) : (
    <span style={{display: 'inline-block', transform: p < 1 ? `scale(${0.7 + 0.3 * POP(p)})` : undefined}}>
      <EmbossChip label="지휘 중" container={colors.infoContainer} onContainer={colors.onSurface} fontSize={SECONDARY_FONT} />
    </span>
  );

const TEAM_CHIP: Record<Exclude<TeamStatus, null>, {label: string; container: string}> = {
  directing: {label: '지휘 중', container: colors.infoContainer},
  working: {label: '작업 중', container: colors.infoContainer},
  waiting: {label: '대기', container: colors.surfaceContainerHigh},
  done: {label: '완료', container: colors.successContainer},
};
const TeamChip: React.FC<{status: TeamStatus}> = ({status}) =>
  status ? <EmbossChip label={TEAM_CHIP[status].label} container={TEAM_CHIP[status].container} onContainer={colors.onSurface} fontSize={SECONDARY_FONT} /> : null;

export const BoardV4: React.FC<BoardV4Props> = ({frame, scrollY, heroMessageId, heroRowId, state, overlay, pmReply = 1, pmActivation, appearAt, reveal}) => (
  <>
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: px(BOARD_W),
        height: px(BOARD_H),
        borderRadius: px(BOARD_RADIUS),
        background: colors.background,
        overflow: 'visible',
        transformStyle: 'preserve-3d',
        // rim + tight ambient edge only — the cast shadow is the WallShadow in the background layer
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.9), 0 0 0 2px rgba(23,59,48,.07), 0 2px 6px rgba(23,59,48,.10)',
      }}
    >
      {/* top-face highlight (fixed, not ry-driven) */}
      <div style={{position: 'absolute', inset: 0, borderRadius: px(BOARD_RADIUS), background: 'linear-gradient(115deg, rgba(255,255,255,.5) 0%, rgba(255,255,255,0) 28%)'}} />

      {/* rail */}
      <div style={{position: 'absolute', left: 0, top: 0, width: px(AREAS.rail.x1), height: px(BOARD_H), background: colors.surfaceContainerLow, borderRadius: `${px(BOARD_RADIUS)}px 0 0 ${px(BOARD_RADIUS)}px`}} />

      {/* sidebar */}
      <div
        style={{
          position: 'absolute',
          left: px(AREAS.sidebar.x0),
          top: 0,
          width: px(AREAS.sidebar.x1 - AREAS.sidebar.x0),
          height: px(BOARD_H),
          background: colors.surfaceContainerLow,
          padding: px(12),
          boxSizing: 'border-box',
        }}
      >
        <div style={uiTextStyle(uiType.titleMd, colors.onSurface)}>{WORKSPACE_TITLE}</div>
        <div style={{marginTop: px(12), ...uiTextStyle(uiType.labelSm, colors.onSurfaceVariant)}}>프로젝트</div>
        <div style={{marginTop: px(2), ...uiTextStyle(uiType.bodyMd, colors.onSurface)}}>{PROJECT_TITLE}</div>
        <div style={{marginTop: px(16), ...uiTextStyle(uiType.labelSm, colors.onSurfaceVariant)}}>채널</div>
        <div
          style={{
            marginTop: px(4),
            padding: `${px(6)}px ${px(10)}px`,
            borderRadius: px(10),
            background: colors.secondaryContainer,
            ...uiTextStyle(uiType.titleSm, colors.onSecondaryContainer),
          }}
        >
          # {CHANNEL_TITLE}
        </div>
        <div style={{marginTop: px(6), ...uiTextStyle(uiType.bodyMd, colors.onSurfaceVariant)}}># 인터뷰-기록</div>
        <div style={{marginTop: px(6), ...uiTextStyle(uiType.bodyMd, colors.onSurfaceVariant)}}># 일반</div>

        <div style={{position: 'absolute', left: px(12), top: px(SIDEBAR_TEAM_Y0), width: px(AREAS.sidebar.x1 - AREAS.sidebar.x0 - 24)}}>
          <div style={uiTextStyle(uiType.titleSm, colors.onSurface)}>팀원 5</div>
          {TEAM_ROWS.map((row) => (
            <div key={row.id} style={{marginTop: px(10), height: px(SIDEBAR_TEAM_ROW_H), display: 'flex', alignItems: 'center', gap: px(8)}}>
              {row.kind === 'pm' && pmActivation !== undefined ? (
                <span style={{position: 'relative', display: 'inline-flex'}}>
                  <MemberAvatar who={row.id} size={px(SIDEBAR_AVATAR)} frame={frame} />
                  <PmAvatarRing p={pmActivation} />
                </span>
              ) : (
                <MemberAvatar who={row.id} size={px(SIDEBAR_AVATAR)} frame={frame} />
              )}
              <div style={{flex: 1, minWidth: 0}}>
                <div style={{...uiTextStyle(uiType.labelLg, colors.onSurface), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{row.name}</div>
                <div style={{...uiTextStyle(uiType.bodySm, colors.onSurfaceVariant), whiteSpace: 'nowrap'}}>{row.subtitle}</div>
              </div>
              {row.kind === 'pm' && pmActivation !== undefined ? (
                <PmChip p={pmActivation} />
              ) : (
                <TeamChip status={state.team[row.id as MemberId]} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* timeline (drawn before the header band so the band covers scrolled rows) */}
      <TimelineV4 frame={frame} scrollY={scrollY} excludeIds={heroMessageId ? [heroMessageId] : []} pmReply={pmReply} approvedIds={state.approvedMessages} appearAt={appearAt} reveal={reveal} />

      {/* channel header — opaque band; covers rows scrolled above y=64 by paint
          order (drawn after the timeline), so it needs no Z of its own (v3 used Z+4) */}
      <div
        style={{
          position: 'absolute',
          left: px(AREAS.main.x0),
          top: 0,
          width: px(AREAS.main.x1 - AREAS.main.x0),
          height: px(AREAS.channelHeader.y1),
          background: colors.background,
          borderBottom: `${px(1)}px solid ${colors.outlineVariant}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `0 ${px(24)}px`,
          boxSizing: 'border-box',
        }}
      >
        <span style={uiTextStyle(uiType.titleLg, colors.onSurface)}># {CHANNEL_TITLE}</span>
        <div style={{display: 'flex', alignItems: 'center', gap: px(12)}}>
          <span style={uiTextStyle(uiType.labelMd, colors.onSurfaceVariant)}>팀원 5</span>
          <ForumIcon size={px(20)} color={colors.onSurfaceVariant} />
          <InfoIcon size={px(20)} color={colors.onSurfaceVariant} />
        </div>
      </div>

      {/* composer (flat: part of the board layer) */}
      <div
        style={{
          position: 'absolute',
          left: px(AREAS.composer.x0),
          top: px(AREAS.composer.y0),
          width: px(AREAS.composer.x1 - AREAS.composer.x0),
          height: px(AREAS.composer.y1 - AREAS.composer.y0),
          background: colors.surface,
          borderRadius: px(28),
          display: 'flex',
          alignItems: 'center',
          padding: `0 ${px(16)}px`,
          gap: px(10),
          boxSizing: 'border-box',
          boxShadow: '0 1px 2px rgba(23,59,48,.08), 0 1px 3px 1px rgba(23,59,48,.05)',
        }}
      >
        <AddIcon size={px(18)} color={colors.onSurfaceVariant} />
        <span style={uiTextStyle(uiType.bodyMd, colors.onSurfaceVariant)}>메시지 보내기 · @로 팀원 호출</span>
        <div style={{marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: px(6)}}>
          <AutoAwesomeIcon size={px(14)} color={colors.tertiary} />
          <span style={uiTextStyle(uiType.labelSm, colors.tertiary)}>PM이 담당자를 추천해요</span>
        </div>
      </div>

      <RightPanelV4
        progress={state.progress}
        verifiedIds={state.verifiedIds}
        reportedIds={state.reportedIds}
        showDecision={state.showDecision}
        evidenceCount={state.evidenceCount}
        heroRowId={heroRowId}
      />

      {overlay}
    </div>
  </>
);
