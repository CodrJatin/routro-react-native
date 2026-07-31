import { useMemo } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';

/**
 * A switch with square corners.
 *
 * The platform `Switch` is a stadium pill on both iOS and Android with no way
 * to square it off, and 0px corners are the one thing every card, marker and
 * control in this app agrees on. Rebuilding it is a handful of views, and it
 * also takes its colours from the theme in both modes instead of the
 * `trackColor`/`thumbColor`/`ios_backgroundColor` triple each call site was
 * repeating by hand.
 *
 * The props are deliberately the subset of RN's `Switch` the app actually
 * used, so swapping it in is a one-line change per row.
 */

const TRACK_WIDTH = 44;
const BORDER = 1;

/**
 * The thumb is taller than the track it runs along, rather than tucked inside
 * it -- a block sliding over a rail, like the position marker sitting on the
 * itinerary's line. The two heights are simply each other's: the track is as
 * tall as a conventional thumb, the thumb as tall as a conventional track.
 */
const TRACK_HEIGHT = 18;
const THUMB_HEIGHT = 22;
/** Square, like everything else here. */
const THUMB_WIDTH = THUMB_HEIGHT;

/** Flush to the track's ends -- overhanging it vertically already, an inset
 * would leave the thumb floating in the middle of nothing at either extreme. */
const TRAVEL = TRACK_WIDTH - THUMB_WIDTH;

const TIMING = { duration: 180, easing: Easing.out(Easing.ease) } as const;

interface Props {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  /** Announced by screen readers when the surrounding row's label isn't
   * already doing that job. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function SquareSwitch({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
  style,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(), []);

  // One driver for both halves of the animation, so the thumb and the track
  // colour can never disagree about which state they are in.
  const progress = useDerivedValue(() => withTiming(value ? 1 : 0, TIMING), [value]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [colors.surfaceContainerHigh, colors.accent],
    ),
    borderColor: interpolateColor(progress.value, [0, 1], [colors.border, colors.accent]),
  }));

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * TRAVEL }],
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      // Off, the thumb sits on a near-surface track and needs the text colour
      // to be visible at all; on, it sits on the accent and can afford the
      // light on-accent colour.
      [colors.textSecondary, colors.onPrimary],
    ),
    // The same outline the track wears. Standing proud of the track, the thumb
    // ends up against the row behind it -- and on, `onPrimary` is white on a
    // white card, which without this edge simply disappears.
    borderColor: interpolateColor(progress.value, [0, 1], [colors.border, colors.accent]),
  }));

  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      // The control is small; the target around it is not.
      hitSlop={8}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed, style]}
    >
      {/* Siblings rather than parent and child: the thumb stands proud of the
          track at top and bottom, so it can't be laid out inside it. */}
      <Animated.View style={[styles.track, trackStyle]} />
      <Animated.View style={[styles.thumb, thumbStyle]} />
    </Pressable>
  );
}

function createStyles() {
  return StyleSheet.create({
    pressable: {
      // Fixed, and sized by the thumb -- it is the taller of the two now, so
      // it is what decides how much room the row has to give this control.
      width: TRACK_WIDTH,
      height: THUMB_HEIGHT,
      justifyContent: 'center',
    },
    pressed: {
      opacity: 0.7,
    },
    track: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: TRACK_HEIGHT,
      // Centred in the taller box the thumb defines.
      top: (THUMB_HEIGHT - TRACK_HEIGHT) / 2,
      borderWidth: BORDER,
      // Square, which is the entire reason this component exists.
      borderRadius: 0,
    },
    thumb: {
      position: 'absolute',
      left: 0,
      top: 0,
      width: THUMB_WIDTH,
      height: THUMB_HEIGHT,
      borderWidth: BORDER,
      borderRadius: 0,
    },
  });
}
