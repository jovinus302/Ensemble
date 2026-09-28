import type React from 'react';
// v3 §0/§3 tokens: video-only exception palette, materials, shadows, lighting,
// type scale (T1-T4), Z-depth table, and the K=2 DOM-scale constant.
// Per spec §0: DESIGN.md bans on strong shadow/glow/weight>700 do NOT apply here.
// Product UI *tokens* (color/radius/spacing) still come from DESIGN.md values
// (re-declared here so v3 doesn't reach into src/ui/tokens.ts's flat-mockup layout
// assumptions) — only lighting/material/typography are video-specific.

export const K = 2; // DOM scale factor: logical board is 1440x900, DOM is 2880x1800
export const px = (n: number) => n * K;

// ---- §0 palette (product UI tokens, from DESIGN.md, unchanged) ----
export const colors = {
  brandInk: '#173B30',
  primary: '#2B6A52',
  onPrimary: '#FFFFFF',
  primaryContainer: '#D3EBDD',
  onPrimaryContainer: '#0D3325',
  secondary: '#52635A',
  secondaryContainer: '#E3EDE7',
  onSecondaryContainer: '#101F18',
  tertiary: '#6D4FD8',
  tertiaryContainer: '#E9E1FF',
  onTertiaryContainer: '#25105E',

  background: '#F6F6F3',
  surface: '#FFFFFF',
  surfaceContainerLow: '#F1F2EE',
  surfaceContainer: '#ECEEE9',
  surfaceContainerHigh: '#E5E8E3',
  onSurface: '#18201C',
  onSurfaceVariant: '#4A5650',
  outline: '#7A867F',
  outlineVariant: '#C9D1CB',

  success: '#1E7F4F',
  successContainer: '#D2EFDD',
  warning: '#9A5B00',
  warningContainer: '#FFE7C2',
  error: '#BA1A1A',
  errorContainer: '#FFDAD6',
  info: '#2A64D6',
  infoContainer: '#DCE6FF',

  harmony1: '#3DBE8B',
  harmony2: '#4C8DF6',
  harmony3: '#9B7BF7',
  harmony4: '#F08BB4',

  // agent colors, orchestrator-confirmed palette (§0)
  agentResearch: '#5B84EC',
  agentPrototype: '#E5764F',
  pm: '#2B6A52',

  // voice container/on borrowed from DESIGN voice-2 / voice-3
  voice2Container: '#DCE6FF',
  voice2On: '#0B2A66',
  voice3Container: '#FFE0D6',
  voice3On: '#4A1406',

  // people
  humanDecisionMaker: '#CDBBA5', // 김도윤
  humanDesigner: '#B9C7BE', // 이서연

  // board surfaces
  boardSlab: '#E6E1D6',
} as const;

export const harmonyGradient = `linear-gradient(120deg, ${colors.harmony1} 0%, ${colors.harmony2} 35%, ${colors.harmony3} 65%, ${colors.harmony4} 100%)`;
export const harmonyGradientStops = [
  {offset: '0%', color: colors.harmony1},
  {offset: '35%', color: colors.harmony2},
  {offset: '65%', color: colors.harmony3},
  {offset: '100%', color: colors.harmony4},
] as const;

export const radius = {sm: 8, md: 12, lg: 16, lgPlus: 20, xl: 28, full: 9999} as const;

export const spacing = {1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24} as const;

// ---- §3 typography (video exception: weight up to 800, Pretendard) ----
export const FONT_FAMILY = 'Pretendard';

export interface TypeStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight: number;
  letterSpacing?: string;
}

export const type: Record<'T1' | 'T2' | 'T3' | 'T4', TypeStyle> = {
  T1: {fontSize: 112, lineHeight: 1.05, fontWeight: 800, letterSpacing: '-0.03em'},
  T2: {fontSize: 72, lineHeight: 1.1, fontWeight: 800},
  T3: {fontSize: 36, lineHeight: 1.2, fontWeight: 700},
  T4: {fontSize: 24, lineHeight: 1.3, fontWeight: 600},
};

export const inkColor = colors.brandInk;
export const accentColor = colors.primary;

// Board DOM is built at K=2 actual CSS pixels (not a CSS `scale()` of a
// logical-size subtree) so text rasterizes at high-res *before* the Rig's
// scale3d(S=s/2, S<=1.05) scales it back down toward 1x on screen — downscale
// is what keeps text crisp per §6 "텍스트 선명도". This helper doubles a
// logical length OR a {fontSize,lineHeight,fontWeight} type token for CSS use.
export function uiTextStyle(t: {fontSize: number; lineHeight: number; fontWeight: number}, color: string): React.CSSProperties {
  return {
    fontFamily: FONT_FAMILY,
    fontSize: px(t.fontSize),
    lineHeight: `${px(t.lineHeight)}px`,
    fontWeight: t.fontWeight,
    color,
    margin: 0,
  };
}

// product-UI (in-board) type scale, from DESIGN.md M3 scale, reused verbatim
export const uiType = {
  titleLg: {fontSize: 22, lineHeight: 28, fontWeight: 500},
  titleMd: {fontSize: 16, lineHeight: 24, fontWeight: 600},
  titleSm: {fontSize: 14, lineHeight: 20, fontWeight: 600},
  messageBody: {fontSize: 15, lineHeight: 23, fontWeight: 400},
  bodyLg: {fontSize: 16, lineHeight: 24, fontWeight: 400},
  bodyMd: {fontSize: 14, lineHeight: 21, fontWeight: 400},
  bodySm: {fontSize: 12, lineHeight: 18, fontWeight: 400},
  labelLg: {fontSize: 14, lineHeight: 20, fontWeight: 500},
  labelMd: {fontSize: 12, lineHeight: 16, fontWeight: 500},
  labelSm: {fontSize: 11, lineHeight: 16, fontWeight: 500},
} as const;

// ---- Stage / rig (§3) ----
export const STAGE_W = 1920;
export const STAGE_H = 1080;
export const PERSPECTIVE = 2200; // bump to 2600 if near-edge magnification is excessive

export interface CameraPose {
  tx: number;
  ty: number;
  s: number;
  rx: number;
  ry: number;
  rz: number;
  ax: number;
  ay: number;
  dz: number;
}

export const P0: CameraPose = {tx: 720, ty: 450, s: 0.62, rx: 24, ry: -30, rz: 4, ax: 980, ay: 700, dz: -600};
export const P0_5: CameraPose = {tx: 720, ty: 450, s: 0.75, rx: 18, ry: -10, rz: 1, ax: 930, ay: 630, dz: -400};
export const P1: CameraPose = {tx: 720, ty: 450, s: 0.86, rx: 9, ry: 18, rz: -1.5, ax: 880, ay: 560, dz: 0};

// ---- §3 materials / shadows / lighting (numeric) ----
export const boardShadow =
  '0 2px 4px rgba(23,59,48,.06), 0 24px 48px -12px rgba(23,59,48,.18), 0 80px 120px -40px rgba(23,59,48,.22)';

export const rimHighlight = 'inset 0 1px 0 rgba(255,255,255,.9)';

// cast shadow for a floating element at rest-to-risen z (light from az 135deg)
export const castShadowFor = (z: number) => ({
  dx: 0.25 * z,
  dy: 0.45 * z,
  blur: 0.6 * z,
  opacity: Math.max(0, 0.28 - 0.0008 * z),
});

export const embossChipShadow =
  'inset 0 1px 0 rgba(255,255,255,.8), inset 0 -1px 0 rgba(0,0,0,.06), 0 2px 4px rgba(23,59,48,.12), 0 8px 16px -6px rgba(23,59,48,.18)';

export const clayInsetShadow =
  'inset -3px -4px 8px rgba(0,0,0,.18), inset 3px 3px 6px rgba(255,255,255,.45), 0 6px 12px -4px rgba(23,59,48,.30)';

// ---- Z-depth table (logical Z, §2) ----
export const Z = {
  boardSlab: -14,
  boardBody: 0,
  channelHeaderBand: 4,
  composer: 12,
  rightPanelRest: 18,
  rightPanelRisen: 40, // beat ⑤+
  sidebarTeamRest: 0,
  sidebarTeamRisen: 60,
  sidebarRowStep: 20,
  heroCardRest: 0,
  heroCardRisen: 90,
  heroCardRisenLarge: 140, // M14/M15
  cardChipStep: 24,
  cardAvatarStep: 32,
  panelC31Risen: 70,
  panelRisenForBadge: 30,
  tokenPlane: 160,
  castShadowStep: 1,
} as const;

// ---- Agent voice glyph colors ----
export const agentGlyph = {
  research: {base: colors.agentResearch, glyph: '#FFFFFF'},
  prototype: {base: colors.agentPrototype, glyph: '#FFFFFF'},
  pm: {base: colors.pm, glyph: '#FFFFFF'},
} as const;
