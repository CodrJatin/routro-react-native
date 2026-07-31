/**
 * Design tokens synthesized from DESIGN.md (dark) and DESIGN-light.md (light).
 * Color keys follow the Material 3-style naming used by those files so
 * screens rebuilt from Stitch mockups can be copied over 1:1. A handful of
 * flat aliases (background, surface, textPrimary, ...) are kept for the
 * screens that haven't been visually rebuilt yet.
 */

export type ThemeMode = 'light' | 'dark';

export interface ColorTokens {
  surface: string;
  surfaceDim: string;
  surfaceBright: string;
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  onSurface: string;
  onSurfaceVariant: string;
  inverseSurface: string;
  inverseOnSurface: string;
  outline: string;
  outlineVariant: string;
  surfaceTint: string;
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  inversePrimary: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;
  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;
  background: string;
  onBackground: string;
  surfaceVariant: string;

  /** Semantic extension -- not part of the DESIGN.md token set. */
  success: string;
  onSuccess: string;

  /** Back-compat aliases consumed by screens not yet rebuilt from a mockup. */
  surfaceElevated: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  danger: string;

  /** True page canvas a screen's cards/inputs sit on top of. Distinct from
   * `background`/`surface` in light mode (both #fdf8f8) so elevated content
   * has a visible tonal step instead of blending into the page. */
  canvas: string;
}

const darkBase = {
  surface: '#141313',
  surfaceDim: '#141313',
  surfaceBright: '#3a3939',
  surfaceContainerLowest: '#0e0e0e',
  surfaceContainerLow: '#1c1b1b',
  surfaceContainer: '#201f1f',
  surfaceContainerHigh: '#2b2a2a',
  surfaceContainerHighest: '#353434',
  onSurface: '#e5e2e1',
  onSurfaceVariant: '#c4c7c7',
  inverseSurface: '#e5e2e1',
  inverseOnSurface: '#313030',
  outline: '#8e9192',
  outlineVariant: '#444748',
  surfaceTint: '#c8c6c5',
  primary: '#c8c6c5',
  onPrimary: '#313030',
  primaryContainer: '#1a1a1a',
  onPrimaryContainer: '#848282',
  inversePrimary: '#5f5e5e',
  secondary: '#c6c6c7',
  onSecondary: '#2f3131',
  secondaryContainer: '#454747',
  onSecondaryContainer: '#b4b5b5',
  tertiary: '#c6c6c7',
  onTertiary: '#2f3131',
  tertiaryContainer: '#181a1a',
  onTertiaryContainer: '#818383',
  error: '#ffb4ab',
  onError: '#690005',
  errorContainer: '#93000a',
  onErrorContainer: '#ffdad6',
  background: '#141313',
  onBackground: '#e5e2e1',
  surfaceVariant: '#353434',
  success: '#3dd68c',
  onSuccess: '#ffffff',
} satisfies Omit<ColorTokens, keyof LegacyAliasKeys>;

const lightBase = {
  // Off-white rather than the near-#fff this used to be. `surface` is the fill
  // of every card, sheet and settings row in the app, so it is most of what a
  // light screen actually is -- at #fdf8f8 that was a page-sized white, and no
  // canvas dim enough to sit under it comfortably was also light.
  surface: '#f8f4f3',
  surfaceDim: '#ddd9d8',
  surfaceBright: '#f8f4f3',
  surfaceContainerLowest: '#ffffff',
  surfaceContainerLow: '#f7f3f2',
  surfaceContainer: '#f1edec',
  surfaceContainerHigh: '#ebe7e6',
  surfaceContainerHighest: '#e5e2e1',
  onSurface: '#1c1b1b',
  onSurfaceVariant: '#444748',
  inverseSurface: '#313030',
  inverseOnSurface: '#f4f0ef',
  outline: '#747878',
  outlineVariant: '#c4c7c7',
  surfaceTint: '#5f5e5e',
  primary: '#000000',
  onPrimary: '#ffffff',
  primaryContainer: '#1c1b1b',
  onPrimaryContainer: '#858383',
  inversePrimary: '#c8c6c5',
  secondary: '#5d5f5f',
  onSecondary: '#ffffff',
  secondaryContainer: '#dcdddd',
  onSecondaryContainer: '#5f6161',
  tertiary: '#000000',
  onTertiary: '#ffffff',
  tertiaryContainer: '#1a1c1c',
  onTertiaryContainer: '#838484',
  error: '#ba1a1a',
  onError: '#ffffff',
  errorContainer: '#ffdad6',
  onErrorContainer: '#93000a',
  background: '#fdf8f8',
  onBackground: '#1c1b1b',
  surfaceVariant: '#e5e2e1',
  success: '#1b8e5c',
  onSuccess: '#ffffff',
} satisfies Omit<ColorTokens, keyof LegacyAliasKeys>;

interface LegacyAliasKeys {
  surfaceElevated: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  danger: string;
  canvas: string;
}

function withLegacyAliases(base: typeof darkBase, mode: ThemeMode): ColorTokens {
  return {
    ...base,
    surfaceElevated: base.surfaceContainerHigh,
    border: base.outlineVariant,
    textPrimary: base.onBackground,
    textSecondary: base.onSurfaceVariant,
    accent: base.primary,
    danger: base.error,
    // Dark mode's background is already the deepest tone (containers step up
    // from it), so it doubles as the canvas.
    //
    // Light mode's own surfaces are all near-white, and a page painted in any
    // of them glares. This warm grey is pitched to sit *between* the two
    // things it has to separate: a step below every card fill, and a step
    // above the live journey slab, so cards read as raised and the slab as
    // sunk without either gap being a slap. Deliberately its own value rather
    // than a surface token -- nothing but the page should be this tone.
    canvas: mode === 'dark' ? base.background : '#e7e3e2',
  };
}

export const darkColors: ColorTokens = withLegacyAliases(darkBase, 'dark');
export const lightColors: ColorTokens = withLegacyAliases(lightBase, 'light');

export interface TypeStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: '400' | '500' | '600' | '700';
  lineHeight: number;
  letterSpacing?: number;
}

/** Same across both themes -- DESIGN.md and DESIGN-light.md define identical scales. */
export const typography = {
  displayLg: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 40,
    fontWeight: '700',
    lineHeight: 48,
    letterSpacing: -0.8,
  },
  headlineLg: {
    fontFamily: 'Outfit_600SemiBold',
    fontSize: 32,
    fontWeight: '600',
    lineHeight: 40,
  },
  headlineMd: {
    fontFamily: 'Outfit_600SemiBold',
    fontSize: 24,
    fontWeight: '600',
    lineHeight: 32,
  },
  bodyLg: {
    fontFamily: 'Outfit_400Regular',
    fontSize: 18,
    fontWeight: '400',
    lineHeight: 28,
  },
  bodyMd: {
    fontFamily: 'Outfit_400Regular',
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
  },
  dataLg: {
    fontFamily: 'SpaceMono_700Bold',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 20,
  },
  dataSm: {
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 16,
  },
  labelCaps: {
    fontFamily: 'SpaceMono_700Bold',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
} satisfies Record<string, TypeStyle>;

export const spacing = {
  base: 4,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  gutter: 12,
  marginMobile: 16,
  marginDesktop: 40,
} as const;

/** Sharp, industrial shape language: 0px corners everywhere, 2px only for
 * the small-badge exception DESIGN.md calls out. */
export const radius = {
  none: 0,
  badge: 2,
} as const;

export function colorsFor(mode: ThemeMode): ColorTokens {
  return mode === 'dark' ? darkColors : lightColors;
}
