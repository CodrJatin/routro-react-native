import Svg, { G, Path } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

interface RoutroMarkProps {
  /** Rendered edge length. The viewBox is square and scales from a 100pt grid. */
  size?: number;
  /** The diamond, filled and outlined in the same paint. Defaults to the
   * theme's primary ink so it flips with light/dark. */
  color?: string;
  /** The bar. Defaults to the theme's one saturated colour. Pass `color`'s value
   * here to get the flat single-colour mark used on the launcher's monochrome
   * icon, where the tint would collapse the two paints anyway. */
  accent?: string;
}

/**
 * A solid diamond with a bar running behind it, emerging at both sides so it
 * reads as passing through rather than sitting on top.
 *
 * Nothing is cut to achieve that. The diamond is one closed path and the bar is
 * one unbroken band; the depth is purely paint order -- bar first, diamond over
 * it. So the bar is hidden for the diamond's full span and emerges at both ends.
 *
 * The diamond is filled and stroked in the same paint rather than only filled,
 * which keeps the drawn silhouette out at the mitred points and so keeps the
 * proportions below meaning what they say.
 *
 * The whole thing is then turned 45 degrees anticlockwise, so the bar climbs to
 * the right and the diamond stands as a square with the bar leaving through two
 * opposite corners. The path data below is still written unrotated, because a
 * rotation preserves every distance and angle between the two shapes: the
 * numbers keep describing what they describe, and only the group transform is
 * new.
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
      <G rotation={ROTATION} origin="50, 50">
        <Path d="M2 50H98" stroke={thread} strokeWidth={BAR} />
        <Path
          d="M50 27L73 50L50 73L27 50Z"
          fill={ink}
          stroke={ink}
          strokeWidth={RING}
          strokeLinejoin="miter"
        />
      </G>
    </Svg>
  );
}

const RING = 8;
const BAR = 15;
/** Anticlockwise on screen, which in SVG's y-down space is negative. */
const ROTATION = -45;
