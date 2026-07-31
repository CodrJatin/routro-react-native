import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { findRoute, getCompiledGraph, getStation } from '../engine/graph';
import { useSelfPositionStore } from '../location/selfPosition';
import { getRouteProgress } from '../route/routeProgress';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens, TypeStyle } from '../theme/tokens';
import { stopJourney } from './journeyController';
import { useJourneyStore } from './journeyStore';

/** Gap between the top of the safe area and the first overlay on the map. */
export const MAP_OVERLAY_TOP_GAP = 10;

/**
 * Roughly how tall the bar is, for overlays that have to stack under it.
 *
 * Approximate on purpose: the alternative is measuring on layout and pushing
 * the number through state, which would reflow every overlay on the map one
 * frame after the bar appears. The banner below it only needs to clear it.
 */
export const JOURNEY_BAR_HEIGHT = 60;

/** How far the line colours are knocked back on the stretch still ahead. Low
 * enough to read as "not yet", high enough that the lines are still nameable. */
const GHOST_OPACITY = 0.3;

/**
 * Shown on the map whenever a journey is being followed.
 *
 * The ongoing notification is the primary surface for a tracked journey -- it
 * is what the user sees with the phone in their hand. This exists so that
 * opening the app doesn't hide the fact that tracking is on, and so stopping
 * it never requires going and finding the route that started it.
 *
 * A compact echo of the live journey card on the route screen -- same square
 * card, same pulsing dot, same departure-board counter -- so the two read as
 * one thing seen twice rather than two features. What it adds is the rail
 * along its bottom edge: on a map, with no itinerary in sight, that hairline
 * is the only picture of how much journey is left.
 */
export function JourneyBar() {
  const { colors, radius, typography } = useTheme();
  // The map runs full-bleed under the status bar, so this is the one overlay
  // that has to place itself -- at a flat `top: 12` it sat inside the notch.
  const insets = useSafeAreaInsets();
  const styles = useMemo(
    () => createStyles(colors, radius, typography),
    [colors, radius, typography],
  );

  const session = useJourneyStore((state) => state.session);
  const position = useSelfPositionStore((state) => state.position);

  const route = useMemo(() => {
    if (!session) return null;
    return findRoute(session.originId, session.destinationId, session.mode);
  }, [session]);

  const progress = useMemo(() => getRouteProgress(route, position), [route, position]);

  // The travelled overlay is clipped to a pixel width, which needs the rail's
  // measured width -- a percentage would be resolved against the clip itself.
  const [railWidth, setRailWidth] = useState(0);

  // The same slow heartbeat the route screen's card beats to.
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse]);

  const dotStyle = useAnimatedStyle(() => ({
    opacity: 0.4 + 0.6 * pulse.value,
    transform: [{ scale: 1 + 0.5 * pulse.value }],
  }));

  if (!session) return null;

  const remaining = progress ? progress.sequence.length - 1 - progress.nearestIndex : null;
  // Named from the session when there's no fix to build a sequence from: where
  // you are going is known the moment the journey starts, and "Following your
  // journey" was the bar refusing to say the one thing it always knows.
  const destinationName =
    progress?.sequence[progress.sequence.length - 1].stationName ??
    getStation(session.destinationId)?.name ??
    'your destination';

  // Measured in time rather than in stations, so it lines up with a rail whose
  // legs are themselves width-weighted by time.
  const totalSeconds = progress?.sequence[progress.sequence.length - 1].offsetSeconds ?? 0;
  const travelled =
    progress && totalSeconds > 0
      ? Math.min(1, progress.sequence[progress.nearestIndex].offsetSeconds / totalSeconds)
      : 0;

  const lines = getCompiledGraph().lines;
  // Same weighting as the route card's leg bar: a two-minute hop shouldn't
  // claim half the rail.
  const legWeights =
    route?.legs.map((leg) => Math.max(1, leg.legTimeSeconds + leg.transferSecondsBefore)) ?? [];

  const legSegments = (opacity: number) =>
    route?.legs.map((leg, index) => (
      <View
        key={index}
        style={{
          flex: legWeights[index],
          backgroundColor: lines[leg.line]?.color ?? colors.textPrimary,
          opacity,
        }}
      />
    ));

  function handleRailLayout(event: LayoutChangeEvent) {
    setRailWidth(event.nativeEvent.layout.width);
  }

  return (
    <Animated.View
      style={[styles.bar, { top: insets.top + MAP_OVERLAY_TOP_GAP }]}
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
    >
      <View style={styles.row}>
        <View style={styles.headline}>
          <View style={styles.livePill}>
            <Animated.View style={[styles.liveDot, dotStyle]} />
            <Text style={styles.liveLabel}>FOLLOWING</Text>
          </View>
          <Text style={styles.destination} numberOfLines={1} ellipsizeMode="tail">
            {destinationName}
          </Text>
        </View>

        <View style={styles.counter}>
          {remaining === null ? (
            <>
              <Text style={styles.counterDash}>—</Text>
              <Text style={styles.counterLabel}>NO FIX</Text>
            </>
          ) : remaining === 0 ? (
            <>
              <Ionicons name="flag" size={19} color={colors.textPrimary} />
              <Text style={styles.counterLabel}>ARRIVED</Text>
            </>
          ) : (
            <>
              <Text style={styles.counterNumber}>{remaining}</Text>
              <Text style={styles.counterLabel}>{remaining === 1 ? 'STOP' : 'STOPS'}</Text>
            </>
          )}
        </View>

        <Pressable
          onPress={() => void stopJourney()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Stop following this journey"
          style={({ pressed }) => [styles.stopButton, pressed && styles.stopButtonPressed]}
        >
          <Ionicons name="close" size={17} color={colors.danger} />
        </Pressable>
      </View>

      {/* Full-bleed along the bottom edge: the journey's own lines, in order
          and time-weighted, ghosted ahead of you and solid behind. The route
          screen's leg bar and station meter folded into one 3px line -- so the
          rail says which lines, in what proportion, and how far in. */}
      {route && (
        <View style={styles.rail} onLayout={handleRailLayout}>
          <View style={styles.railRow}>{legSegments(GHOST_OPACITY)}</View>
          {progress && railWidth > 0 && (
            <View style={[styles.railClip, { width: railWidth * travelled }]}>
              <View style={[styles.railRowInner, { width: railWidth }]}>{legSegments(1)}</View>
            </View>
          )}
        </View>
      )}
    </Animated.View>
  );
}

function createStyles(
  colors: ColorTokens,
  radius: { none: number; badge: number },
  typography: Record<string, TypeStyle>,
) {
  return StyleSheet.create({
    // Same fill and hairline as every card in the app, squared off like all of
    // them -- it just happens to be floating over a map.
    bar: {
      position: 'absolute',
      left: 12,
      right: 12,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.none,
      // Clips the progress rail to the card's corners.
      overflow: 'hidden',
      zIndex: 4,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    headline: {
      flex: 1,
      minWidth: 0,
      gap: 1,
    },
    livePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    liveDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.success,
    },
    liveLabel: {
      ...typography.labelCaps,
      fontSize: 9,
      color: colors.textSecondary,
    },
    destination: {
      ...typography.headlineMd,
      fontSize: 17,
      lineHeight: 21,
      color: colors.textPrimary,
    },
    // Sized and set like the counter on the route screen's card, scaled to a
    // bar: still the one thing readable at a glance on a moving train.
    counter: {
      alignItems: 'center',
      minWidth: 38,
    },
    counterNumber: {
      ...typography.headlineLg,
      fontSize: 22,
      lineHeight: 24,
      color: colors.textPrimary,
    },
    counterDash: {
      ...typography.headlineLg,
      fontSize: 20,
      lineHeight: 24,
      color: colors.textPrimary,
      opacity: 0.5,
    },
    counterLabel: {
      ...typography.labelCaps,
      fontSize: 8,
      color: colors.textSecondary,
      marginTop: 1,
    },
    // Outlined rather than filled: stopping is deliberate, but it isn't the
    // thing the bar is for, and a block of red over the map would say it was.
    // Square, and as tall as it is wide -- the one button on a card of text.
    stopButton: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.danger,
      borderRadius: radius.none,
    },
    stopButtonPressed: {
      opacity: 0.6,
    },
    rail: {
      height: 3,
    },
    railRow: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      flexDirection: 'row',
    },
    /** Inside the clip, where the width is set explicitly instead. */
    railRowInner: {
      flexDirection: 'row',
      height: '100%',
    },
    /** Clips the solid copy of the rail to how far along the journey is. The
     * row inside it keeps the *full* width, so each leg stays where it is and
     * the boundary sweeps across them rather than squashing them. */
    railClip: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      overflow: 'hidden',
    },
  });
}
