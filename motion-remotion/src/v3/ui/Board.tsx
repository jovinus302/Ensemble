// v3 §2/§7 step 5 — the board shell: thickness slab (Z-14), rail, sidebar,
// channel header (opaque Z+4 band), timeline, composer, right panel
// (Product State). All children live inside the caller's Rig (preserve-3d).
import React from 'react';
import {BOARD_W, BOARD_H, AREAS, TEAM_ROWS, SIDEBAR_TEAM_Y0, SIDEBAR_TEAM_ROW_H, CHANNEL_TITLE, WORKSPACE_TITLE, PROJECT_TITLE} from './content';
import {px, colors, uiType, uiTextStyle, Z} from '../tokens/video';
import {Timeline} from './Timeline';
import {RightPanel} from './RightPanel';
import {ClayAvatar} from './primitives/ClayAvatar';
import {EmbossChip} from './primitives/EmbossChip';
import {AddIcon, ForumIcon, InfoIcon, AutoAwesomeIcon} from './icons';

export interface BoardProps {
  frame: number;
  scrollY: number;
  heroId?: string;
  heroZ?: number;
  glowId?: string;
  teamRisen?: boolean;
  panelRisen?: boolean;
  panelProgress?: number; // 0-5
  c31Verified?: boolean;
  c31Risen?: boolean;
  evidenceHighlightLast?: boolean;
  ry?: number; // camera ry, for the sheen band drift
}

const rowColor = (kind: TeamRowKind): string => (kind === 'pm' ? colors.pm : kind === 'agent' ? colors.agentResearch : colors.humanDecisionMaker);
type TeamRowKind = 'pm' | 'human' | 'agent';

// §3 "보드 그림자 — 바닥 접지 그림자": Z-60 plane, ellipse sized 90%x18% of the
// board, centered under the board (+40 below).
const GroundContactShadow: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      left: px(BOARD_W * 0.05),
      top: px(BOARD_H + 40),
      width: px(BOARD_W * 0.9),
      height: px(BOARD_H * 0.18),
      transform: `translateZ(${px(-60)}px)`,
      background: 'radial-gradient(closest-side, rgba(23,59,48,.22), transparent)',
    }}
  />
);

// §3 "쉰 밴드": diagonal white sheen, position drifts with ry so it reads as a
// reflection that flows as the camera orbits. pos% = 50 + (ry-18)*4.
const SheenBand: React.FC<{ry: number}> = ({ry}) => {
  const posPct = 50 + (ry - 18) * 4;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: px(20),
        background: `linear-gradient(115deg, transparent calc(${posPct}% - 18%), rgba(255,255,255,.16) ${posPct}%, transparent calc(${posPct}% + 18%))`,
        pointerEvents: 'none',
      }}
    />
  );
};

export const Board: React.FC<BoardProps> = ({
  frame,
  scrollY,
  heroId,
  heroZ,
  glowId,
  teamRisen,
  panelRisen,
  panelProgress = 0,
  c31Verified,
  c31Risen,
  evidenceHighlightLast,
  ry = 18,
}) => {
  return (
    <>
      <GroundContactShadow />
      {/* thickness slab, Z-14, same footprint as the board */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: px(BOARD_W),
          height: px(BOARD_H),
          borderRadius: px(20),
          background: colors.boardSlab,
          transform: `translateZ(${px(-14)}px)`,
        }}
      />

      {/* board body */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: px(BOARD_W),
          height: px(BOARD_H),
          borderRadius: px(20),
          background: colors.background,
          overflow: 'visible',
          transformStyle: 'preserve-3d',
          boxShadow: '0 2px 4px rgba(23,59,48,.06), 0 24px 48px -12px rgba(23,59,48,.18), 0 80px 120px -40px rgba(23,59,48,.22)',
        }}
      >
        {/* top-face highlight overlay (fixed corner) + drifting sheen band */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: px(20),
            background: 'linear-gradient(115deg, rgba(255,255,255,.5) 0%, rgba(255,255,255,0) 28%)',
          }}
        />
        <SheenBand ry={ry} />

        {/* rail */}
        <div style={{position: 'absolute', left: 0, top: 0, width: px(AREAS.rail.x1), height: px(BOARD_H), background: colors.surfaceContainerLow}} />

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
            transformStyle: 'preserve-3d',
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

          {/* 팀원 5 */}
          <div
            style={{
              position: 'absolute',
              left: px(12),
              top: px(SIDEBAR_TEAM_Y0),
              width: px(AREAS.sidebar.x1 - AREAS.sidebar.x0 - 24),
              transform: teamRisen ? `translateZ(${px(Z.sidebarTeamRisen)}px)` : undefined,
              transformStyle: 'preserve-3d',
            }}
          >
            <div style={uiTextStyle(uiType.titleSm, colors.onSurface)}>팀원 5</div>
            {TEAM_ROWS.map((row, i) => (
              <div
                key={row.id}
                style={{
                  marginTop: px(10),
                  height: px(SIDEBAR_TEAM_ROW_H),
                  display: 'flex',
                  alignItems: 'center',
                  gap: px(8),
                  transform: teamRisen ? `translateZ(${px(i * 20)}px)` : undefined,
                }}
              >
                <ClayAvatar kind={row.kind} base={rowColor(row.kind)} label={row.name[0]} size={px(28)} frame={frame} />
                <div style={{flex: 1, minWidth: 0}}>
                  <div style={{...uiTextStyle(uiType.labelLg, colors.onSurface), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{row.name}</div>
                  <div style={{...uiTextStyle(uiType.bodySm, colors.onSurfaceVariant), whiteSpace: 'nowrap'}}>{row.subtitle}</div>
                </div>
                {row.chip && (
                  <EmbossChip
                    label={row.chip.label}
                    container={row.chip.state === 'working' ? colors.infoContainer : colors.surfaceContainerHigh}
                    onContainer={colors.onSurface}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* main column */}
        {/* channel header — opaque band, Z+4, covers anything scrolled above y=64 */}
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
            transform: `translateZ(${px(Z.channelHeaderBand)}px)`,
          }}
        >
          <span style={uiTextStyle(uiType.titleLg, colors.onSurface)}># {CHANNEL_TITLE}</span>
          <div style={{display: 'flex', alignItems: 'center', gap: px(12)}}>
            <span style={uiTextStyle(uiType.labelMd, colors.onSurfaceVariant)}>팀원 5</span>
            <ForumIcon size={px(20)} color={colors.onSurfaceVariant} />
            <InfoIcon size={px(20)} color={colors.onSurfaceVariant} />
          </div>
        </div>

        {/* timeline viewport (no overflow:hidden — culled by Timeline itself) */}
        <Timeline frame={frame} scrollY={scrollY} heroId={heroId} heroZ={heroZ} glowId={glowId} />

        {/* composer */}
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
            transform: `translateZ(${px(Z.composer)}px)`,
          }}
        >
          <AddIcon size={px(18)} color={colors.onSurfaceVariant} />
          <span style={uiTextStyle(uiType.bodyMd, colors.onSurfaceVariant)}>메시지 보내기 · @로 팀원 호출</span>
          <div style={{marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: px(6)}}>
            <AutoAwesomeIcon size={px(14)} color={colors.tertiary} />
            <span style={uiTextStyle(uiType.labelSm, colors.tertiary)}>PM이 담당자를 추천해요</span>
          </div>
        </div>

        {/* right panel */}
        <RightPanel
          frame={frame}
          risen={panelRisen}
          progress={panelProgress}
          c31Verified={c31Verified}
          c31Risen={c31Risen}
          evidenceHighlightLast={evidenceHighlightLast}
        />
      </div>
    </>
  );
};
