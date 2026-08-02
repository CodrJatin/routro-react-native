import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

interface RoutroMarkProps {
  /** Rendered edge length. The viewBox is square and scales from a 100pt grid. */
  size?: number;
  /** The diamond. Defaults to the theme's primary ink so it flips with light/dark. */
  color?: string;
  /** The bar. Defaults to the theme's one saturated colour. Pass `color`'s value
   * here to get the flat single-colour mark used on the launcher's monochrome
   * icon, where the tint would collapse the two paints anyway. */
  accent?: string;
}

/**
 * A diamond with a bar threaded through its waist, the bar running behind the
 * diamond at both side points so it reads as passing through rather than
 * sitting on top.
 *
 * Nothing is cut to achieve that. The diamond is one closed path and the bar is
 * one unbroken band; the depth is purely paint order -- bar first, diamond over
 * it. So the bar shows through the hollow middle, is interrupted by each side
 * point, and emerges at both ends.
 *
 * The proportions are load-bearing, not taste: a mitred corner on a 90-degree
 * vertex sticks out by (stroke / 2) * sqrt(2), which makes the diamond's side
 * points RING * sqrt(2) = 11.3 tall. BAR has to clear that, or a point breaks
 * out through the bar's edges instead of being contained by it and the
 * threading reads as a plain crossing.
 *
 * Geometry is shared verbatim with assets/logo/mark.svg. Both come from
 * scripts/generate-logo.py, which also renders the icon PNGs -- change the
 * numbers there, not here.
 */
export function RoutroMark({ size = 40, color, accent }: RoutroMarkProps) {
  const { colors } = useTheme();
  const ink = color ?? colors.textPrimary;
  const thread = accent ?? colors.success;

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <Path d="M2 50H98" stroke={thread} strokeWidth={BAR} />
      <Path
        d="M50 20L80 50L50 80L20 50Z"
        stroke={ink}
        strokeWidth={RING}
        strokeLinejoin="miter"
      />
    </Svg>
  );
}

const RING = 8;
const BAR = 15;
