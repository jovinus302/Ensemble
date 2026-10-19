// Surface rendering context shared by the v5 surface bodies: palette (light /
// dark UI), frame state (B1 before / B3 after the PM Agent's thread), terminal
// body, mono flag, cursor color. A1-A3 never provide it, so they keep the
// defaults (light palette, no state) and render exactly as before.
import React, {createContext, useContext} from 'react';
import {colors} from '../../v3/tokens/video';

export interface Pal {
  dark: boolean;
  surface: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  warning: string;
  warningContainer: string;
  onInk: string; // text on an ink-filled chip
}

export const LIGHT: Pal = {
  dark: false,
  surface: colors.surface,
  surfaceContainerLow: colors.surfaceContainerLow,
  surfaceContainer: colors.surfaceContainer,
  surfaceContainerHigh: colors.surfaceContainerHigh,
  secondaryContainer: colors.secondaryContainer,
  onSecondaryContainer: colors.onSecondaryContainer,
  onSurface: colors.onSurface,
  onSurfaceVariant: colors.onSurfaceVariant,
  outline: colors.outline,
  outlineVariant: colors.outlineVariant,
  primary: colors.primary,
  onPrimary: '#FFFFFF',
  primaryContainer: colors.primaryContainer,
  onPrimaryContainer: colors.onPrimaryContainer,
  warning: colors.warning,
  warningContainer: colors.warningContainer,
  onInk: '#FFFFFF',
};

// v6 TA: clean white surfaces. Same roles as LIGHT but the grey Material containers are
// near-white tints and dividers are hairlines, so a surface reads white (not grey-white).
export const CLEAN: Pal = {
  ...LIGHT,
  surfaceContainerLow: '#FBFCFA',
  surfaceContainer: '#F7F9F6',
  surfaceContainerHigh: '#EFF3EF',
  secondaryContainer: '#E8EFEA',
  outlineVariant: '#DEE4DF',
};

// DESIGN.md dark-* tokens; amber keeps its role (dark-voice-4 amber on a tinted container)
export const DARK: Pal = {
  dark: true,
  surface: '#151B18',
  surfaceContainerLow: '#19201D',
  surfaceContainer: '#1E2622',
  surfaceContainerHigh: '#27302C',
  secondaryContainer: '#27302C',
  onSecondaryContainer: '#E3E9E5',
  onSurface: '#E3E9E5',
  onSurfaceVariant: '#A8B4AD',
  outline: '#87938C',
  outlineVariant: '#3B4640',
  primary: '#8FD5B3',
  onPrimary: '#00382A',
  primaryContainer: '#1F513F',
  onPrimaryContainer: '#C0EBD5',
  warning: '#F2C35C',
  warningContainer: '#4A3710',
  onInk: '#151B18',
};

export interface SurfaceTheme {
  pal: Pal;
  state?: 'B1' | 'B3' | 'B7';
  agentBody?: string;
  mono?: boolean;
  cursor?: string;
  messengerCursor?: 'first' | 'reply';
}

const Ctx = createContext<SurfaceTheme>({pal: LIGHT});
export const ThemeProvider = Ctx.Provider;
export const useTheme = () => useContext(Ctx);
export const usePal = () => useContext(Ctx).pal;

export const Cursor: React.FC<{color: string}> = ({color}) => (
  <span style={{display: 'inline-block', width: 6, height: '1em', background: color, marginLeft: 6, verticalAlign: '-0.14em', borderRadius: 1}} />
);

export const HARMONY_RING = 'linear-gradient(120deg, #3DBE8B 0%, #4C8DF6 35%, #9B7BF7 65%, #F08BB4 100%)';
