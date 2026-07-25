import Svg, { G, Path } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

interface MetroSyncMarkProps {
  /** Rendered edge length. The mark is square and scales from a 64pt grid. */
  size?: number;
  /** Defaults to the theme's primary ink so the mark flips with light/dark. */
  color?: string;
}

/**
 * An M drawn in the sign-in backdrop's vocabulary -- two trunks, two exactly
 * 45-degree connectors, one stroke weight, zero radii -- with a hollow diamond
 * interchange where the lines meet. The connectors stop square against the
 * diamond's upper faces instead of running through it, the way a transit map
 * breaks a line at a station.
 *
 * The odd-looking coordinates are exact, not eyeballed: 8.76 is where a
 * 45-degree connector's outer edge crosses the trunk's outer edge, so the
 * trunks close flat instead of growing a nub, and 12.88/10.88 puts the
 * connector's butt cap exactly on that corner. 26,24 is the midpoint of the
 * diamond's upper-left face, so the two strokes meet flush.
 *
 * Geometry lives on a 64-unit grid and is shared verbatim with
 * assets/logo/mark.svg, which is the source the app icons are rendered from.
 */
export function MetroSyncMark({ size = 40, color }: MetroSyncMarkProps) {
  const { colors } = useTheme();
  const ink = color ?? colors.textPrimary;

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <G stroke={ink} strokeWidth={STROKE} strokeLinejoin="miter" fill="none">
        <Path d="M12 8.76V55.24" />
        <Path d="M52 8.76V55.24" />
        <Path d="M12.88 10.88L26 24" />
        <Path d="M51.12 10.88L38 24" />
        <Path d="M32 18L44 30L32 42L20 30Z" />
      </G>
    </Svg>
  );
}

const STROKE = 6;
