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
import {BOARD_W, BOARD_H, AREAS, TEAM_ROWS, SIDEBAR_TEAM_Y0, SIDEBAR_TEAM_ROW_H, CHANNEL_TITLE, WORKSPACE_TITLE, PROJECT_TITLE} from '../../v3/ui/content';
import {px, colors, uiTextStyle} from '../../v3/tokens/video';
import {uiTypeV4 as uiType, SECONDARY_FONT, SIDEBAR_AVATAR} from './typeV4';
import {ClayAvatar} from '../../v3/ui/primitives/ClayAvatar';
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
  progress?: number;
  verifiedIds?: string[];
  evidenceHighlightLast?: boolean;
  overlay?: React.ReactNode;
}

type TeamRowKind = 'pm' | 'human' | 'agent';
const rowColor = (kind: TeamRowKind): string => (kind === 'pm' ? colors.pm : kind === 'agent' ? colors.agentResearch : colors.humanDecisionMaker);

export const BoardV4: React.FC<BoardV4Props> = ({frame, scrollY, heroMessageId, heroRowId, progress = 0, verifiedIds, evidenceHighlightLast, overlay}) => (
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
              <ClayAvatar kind={row.kind} base={rowColor(row.kind)} label={row.name[0]} size={px(SIDEBAR_AVATAR)} frame={frame} />
              <div style={{flex: 1, minWidth: 0}}>
                <div style={{...uiTextStyle(uiType.labelLg, colors.onSurface), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{row.name}</div>
                <div style={{...uiTextStyle(uiType.bodySm, colors.onSurfaceVariant), whiteSpace: 'nowrap'}}>{row.subtitle}</div>
              </div>
              {row.chip && (
                <EmbossChip label={row.chip.label} container={row.chip.state === 'working' ? colors.infoContainer : colors.surfaceContainerHigh} onContainer={colors.onSurface} fontSize={SECONDARY_FONT} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* timeline (drawn before the header band so the band covers scrolled rows) */}
      <TimelineV4 frame={frame} scrollY={scrollY} excludeIds={heroMessageId ? [heroMessageId] : []} />

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

      <RightPanelV4 progress={progress} verifiedIds={verifiedIds} evidenceHighlightLast={evidenceHighlightLast} heroRowId={heroRowId} />

      {overlay}
    </div>
  </>
);
