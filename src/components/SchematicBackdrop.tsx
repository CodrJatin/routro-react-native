import { StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native';
import type { ColorTokens } from '../theme/tokens';

const INTERCHANGE = 10;

/**
 * Two trunk lines, two cross lines and a 45-degree connector, drawn at the
 * threshold of visibility: the geometry of a transit diagram used as page
 * texture rather than as an illustration. Sits outside the safe area so it runs
 * edge to edge.
 *
 * Lifted out of the sign-in screen when onboarding needed the same surface.
 * Sharing it is the point rather than a saving -- the two screens are seen back
 * to back, always in that order, and a second hand-tuned copy would drift into
 * being a visibly different page for no reason anybody chose.
 */
export function SchematicBackdrop({ colors }: { colors: ColorTokens }) {
  const { width, height } = useWindowDimensions();

  const x1 = Math.round(width * 0.24);
  const x2 = Math.round(width * 0.74);
  const y1 = Math.round(height * 0.14);
  const y2 = Math.round(height * 0.62);
  const diagonal = Math.round(Math.hypot(width, height));

  const line: ViewStyle = { position: 'absolute', backgroundColor: colors.outlineVariant };

  return (
    <View style={styles.container} pointerEvents="none">
      <View style={[line, { left: -24, right: -24, top: y1, height: 1 }]} />
      <View style={[line, { left: -24, right: -24, top: y2, height: 1 }]} />
      <View style={[line, { top: -24, bottom: -24, left: x1, width: 1 }]} />
      <View style={[line, { top: -24, bottom: -24, left: x2, width: 1 }]} />
      <View
        style={[
          line,
          {
            width: diagonal,
            height: 1,
            left: Math.round((width - diagonal) / 2),
            top: Math.round(height * 0.4),
            transform: [{ rotate: '-52deg' }],
          },
        ]}
      />

      {/* Interchange boxes sit exactly on the crossings, filled with the canvas
       * colour so the lines appear to pass behind them. */}
      {[
        [x1, y1],
        [x2, y1],
        [x1, y2],
        [x2, y2],
      ].map(([x, y]) => (
        <View
          key={`${x}-${y}`}
          style={[
            styles.interchange,
            {
              left: x - INTERCHANGE / 2,
              top: y - INTERCHANGE / 2,
              borderColor: colors.outline,
              backgroundColor: colors.canvas,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.6,
  },
  interchange: {
    position: 'absolute',
    width: INTERCHANGE,
    height: INTERCHANGE,
    borderWidth: 1,
  },
});
