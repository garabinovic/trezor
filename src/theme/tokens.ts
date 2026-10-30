import { Platform, TextStyle } from 'react-native';

export type ColorScheme = 'light' | 'dark';

export interface Colors {
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
  danger: string;
  dangerSoft: string;
  scrim: string;
}

const light: Colors = {
  background: '#F7F6F3',
  surface: '#FFFFFF',
  surfaceMuted: '#EFEDE8',
  border: '#E4E1DA',
  borderStrong: '#CFCBC2',
  text: '#1C1B19',
  textSecondary: '#5F5C55',
  textTertiary: '#8E8A81',
  accent: '#2E6A5C',
  accentSoft: '#E2EDE9',
  onAccent: '#FFFFFF',
  danger: '#B3412F',
  dangerSoft: '#F6E4E0',
  scrim: 'rgba(28, 27, 25, 0.4)',
};

const dark: Colors = {
  background: '#121211',
  surface: '#1B1B19',
  surfaceMuted: '#252522',
  border: '#2F2E2B',
  borderStrong: '#45433F',
  text: '#ECEAE5',
  textSecondary: '#A8A49B',
  textTertiary: '#75716A',
  accent: '#7DBBA9',
  accentSoft: '#1E332E',
  onAccent: '#0E1C18',
  danger: '#E58A79',
  dangerSoft: '#3A221D',
  scrim: 'rgba(0, 0, 0, 0.6)',
};

export const palettes: Record<ColorScheme, Colors> = { light, dark };

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

/** Horizontal padding of every screen. */
export const gutter = spacing.xl;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 999,
} as const;

export const iconSize = {
  sm: 16,
  md: 20,
  lg: 22,
} as const;

export const iconStroke = 1.75;

export const minTouchTarget = 44;

const monoFamily = Platform.select({ android: 'monospace', ios: 'Menlo' });

export const typography = {
  display: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: '500' },
  callout: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
    letterSpacing: 0.1,
  },
  mono: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '500',
    letterSpacing: 1.5,
    fontFamily: monoFamily,
  },
} satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;

export interface Theme {
  scheme: ColorScheme;
  colors: Colors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
}

export function createTheme(scheme: ColorScheme): Theme {
  return { scheme, colors: palettes[scheme], spacing, radius, typography };
}
