import type {CSSProperties} from 'react';

// Local extension of DESIGN.md tokens for the UiMockupFlat mockup.
// Re-derives the full light-theme palette + type scale + radius + spacing +
// elevation from DESIGN.md exactly (no invented values). Existing
// src/tokens/colors.ts is left untouched (it only has a subset used by
// PitchVideo) — this file is the complete set needed for the UI mockup.

export const FONT_FAMILY = 'Pretendard';

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
} as const;

export const harmonyGradient =
  'linear-gradient(120deg, #3DBE8B 0%, #4C8DF6 35%, #9B7BF7 65%, #F08BB4 100%)';

export type VoiceKey = 'pm' | 'voice1' | 'voice2' | 'voice3';

export const voices: Record<VoiceKey, {main: string; container: string; on: string; label: string}> = {
  pm: {main: '#2B6A52', container: '#D3EBDD', on: '#0D3325', label: 'PM'},
  voice1: {main: '#6D4FD8', container: '#E9E1FF', on: '#25105E', label: '리서치'},
  voice2: {main: '#2A64D6', container: '#DCE6FF', on: '#0B2A66', label: '개발'},
  voice3: {main: '#B34626', container: '#FFE0D6', on: '#4A1406', label: '디자인'},
};

export interface TypeStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight: number;
}

export const type: Record<string, TypeStyle> = {
  displayMd: {fontSize: 45, lineHeight: 52, fontWeight: 500},
  headlineSm: {fontSize: 24, lineHeight: 32, fontWeight: 500},
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
};

export const textStyle = (t: TypeStyle, color: string, extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: `${FONT_FAMILY}, system-ui, sans-serif`,
  fontSize: t.fontSize,
  lineHeight: `${t.lineHeight}px`,
  fontWeight: t.fontWeight,
  color,
  margin: 0,
  ...extra,
});

export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  lgPlus: 20,
  xl: 28,
  xlPlus: 32,
  xxl: 48,
  full: 9999,
} as const;

export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  railWidth: 72,
  sidebarWidth: 280,
  threadWidth: 400,
  messageMax: 760,
  messageGap: 4,
  groupGap: 16,
} as const;

export const elevation = {
  level1: '0 1px 2px rgba(23,59,48,.08), 0 1px 3px 1px rgba(23,59,48,.05)',
  level2: '0 1px 2px rgba(23,59,48,.10), 0 2px 6px 2px rgba(23,59,48,.06)',
} as const;

export type StatusChipState = 'working' | 'needs-you' | 'done' | 'failed';

export const statusChipColors: Record<StatusChipState, {bg: string; fg: string; iconColor: string}> = {
  working: {bg: colors.infoContainer, fg: colors.onSurface, iconColor: colors.info},
  'needs-you': {bg: colors.warningContainer, fg: colors.onSurface, iconColor: colors.warning},
  done: {bg: colors.successContainer, fg: colors.onSurface, iconColor: colors.success},
  failed: {bg: colors.errorContainer, fg: colors.onSurface, iconColor: colors.error},
};
