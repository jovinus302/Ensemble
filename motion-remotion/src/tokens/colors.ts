// DESIGN.md token values (light theme + dark theme + harmony + voices)
export const colors = {
  brandInk: '#173B30',
  primary: '#2B6A52',
  onPrimary: '#FFFFFF',
  primaryContainer: '#D3EBDD',
  onPrimaryContainer: '#0D3325',
  secondary: '#52635A',
  tertiaryContainer: '#E9E1FF',
  onTertiaryContainer: '#25105E',

  // light neutrals
  background: '#F6F6F3',
  surface: '#FFFFFF',
  onSurface: '#18201C',
  onSurfaceVariant: '#4A5650',
  outline: '#7A867F',
  outlineVariant: '#C9D1CB',

  // dark neutrals
  darkBackground: '#0E1311',
  darkSurface: '#151B18',
  darkOnSurface: '#E3E9E5',
  darkOnSurfaceVariant: '#A8B4AD',
  darkOutline: '#87938C',
  darkOutlineVariant: '#3B4640',

  success: '#1E7F4F',
  successContainer: '#D2EFDD',
  info: '#2A64D6',
  infoContainer: '#DCE6FF',

  harmony1: '#3DBE8B',
  harmony2: '#4C8DF6',
  harmony3: '#9B7BF7',
  harmony4: '#F08BB4',

  voice2: '#2A64D6',
  voice2Container: '#DCE6FF',
  voice2On: '#0B2A66',
  voice3: '#B34626',
  voice3Container: '#FFE0D6',
  voice3On: '#4A1406',
} as const;

export const harmonyGradientStops = [
  {offset: '0%', color: colors.harmony1},
  {offset: '35%', color: colors.harmony2},
  {offset: '65%', color: colors.harmony3},
  {offset: '100%', color: colors.harmony4},
] as const;
