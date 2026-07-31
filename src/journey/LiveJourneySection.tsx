import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { findRoute, getStation } from '../engine/graph';
import type { CompiledStation, RawLines } from '../engine/types';
import { useSelfPositionStore } from '../location/selfPosition';
import { buildRouteStationSequence, getRouteProgress } from '../route/routeProgress';
import { useTheme } from '../theme/ThemeProvider';
import { colorsFor, type ColorTokens, type TypeStyle } from '../theme/tokens';
import { useJourneyStore, type JourneySession } from './journeyStore';

/** Height of the tick a station gets in the meter, and the taller one the
 * station you're at gets. The difference is what makes "you are here" findable
 * at a glance on a rail of forty identical marks. */
const TICK_HEIGHT = 14;
const CURRENT_TICK_HEIGHT = 26;

/**
 * The journey being tracked right now, offered back to the planner.
 *
 * The route screen only holds a journey for as long as its two inputs do, so
 * clearing them used to strand a running journey: the tracking carried on, but
 * the screen that could stop it or show its itinerary was unreachable without
 * retyping both stations from memory. This sits above the saved journeys --
 * where the screen already shows what you might want to open next -- and puts
 * the live one back into the fields with one tap.
 *
 * Deliberately shares nothing with `SavedJourneyCard`. A saved journey is a
 * quiet outlined row in a list of equals; this is one solid slab -- the
 * blackest block on a dark screen, the palest on a light one -- because it is a
 * thing that is *happening* rather than a thing you might do later. Its two
 * live parts, the beating dot and the station meter, are the point of it.
 */
export function LiveJourneySection({
  lines,
  onOpen,
}: {
  lines: RawLines;
  /** Given the resolved stations, so the caller can drop them straight into
   * the planner's inputs without re-resolving the ids. */
  onOpen: (origin: CompiledStation, destination: CompiledStation, session: JourneySession) => void;
}) {
  const { colors, mode, radius, typography } = useTheme();
  // The slab is painted from the *opposite* theme's palette: a near-black
  // block sunk into the dark canvas, a pale one raised off the light. Every
  // colour that sits on it therefore comes from `slab`, not from `colors`.
  const slab = useMemo(() => colorsFor(mode === 'dark' ? 'light' : 'dark'), [mode]);
  const styles = useMemo(
    () => createStyles(colors, slab, radius, typography),
    [colors, slab, radius, typography],
  );

  const session = useJourneyStore((state) => state.session);
  const position = useSelfPositionStore((state) => state.position);

  const stations = useMemo(() => {
    if (!session) return null;
    // Resolved against the live graph for the same reason SavedJourneyCard
    // does it: a recompile can rename or drop a station under a stored id.
    const origin = getStation(session.originId);
    const destination = getStation(session.destinationId);
    if (!origin || !destination) return null;
    return { origin, destination };
  }, [session]);

  const route = useMemo(() => {
    if (!session) return null;
    return findRoute(session.originId, session.destinationId, session.mode);
  }, [session]);

  const progress = useMemo(() => getRouteProgress(route, position), [route, position]);

  // Built from the route rather than from progress, so the meter still draws
  // the whole journey when there is no fix to place the user on it.
  const sequence = useMemo(() => (route ? buildRouteStationSequence(route) : []), [route]);

  // One clock drives both the dot and the current tick, so they breathe
  // together instead of drifting into an arrhythmia. Slow on purpose: this is
  // a heartbeat, not a blinking alarm.
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

  const currentTickStyle = useAnimatedStyle(() => ({
    opacity: 0.65 + 0.35 * pulse.value,
    transform: [{ scaleY: 0.88 + 0.12 * pulse.value }],
  }));

  if (!session || !stations) return null;

  const remaining = progress ? sequence.length - 1 - progress.nearestIndex : null;
  const nearestIndex = progress?.nearestIndex ?? null;

  // Widths proportional to time, so the strip along the top is a picture of
  // how the journey is actually divided between its lines -- a two-minute
  // hop on the Grey Line shouldn't claim half the bar.
  const legWeights = route
    ? route.legs.map((leg) => Math.max(1, leg.legTimeSeconds + leg.transferSecondsBefore))
    : [];

  return (
    <Animated.View
      style={styles.section}
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      layout={LinearTransition.duration(220)}
    >
      <Pressable
        style={({ pressed }) => [styles.slab, pressed && styles.slabPressed]}
        onPress={() => onOpen(stations.origin, stations.destination, session)}
        accessibilityRole="button"
        accessibilityLabel={`Open the journey you are following, ${stations.origin.name} to ${stations.destination.name}`}
      >
        {/* Full-bleed across the top edge: the journey's lines, in order and
            to scale, before a single word is read. */}
        <View style={styles.legBar}>
          {route?.legs.map((leg, index) => (
            <View
              key={index}
              style={{
                flex: legWeights[index],
                backgroundColor: lines[leg.line]?.color ?? slab.onPrimary,
              }}
            />
          ))}
        </View>

        <View style={styles.body}>
          <View style={styles.topRow}>
            <View style={styles.livePill}>
              <Animated.View style={[styles.liveDot, dotStyle]} />
              <Text style={styles.liveLabel}>LIVE</Text>
            </View>
            <View style={styles.openHint}>
              <Text style={styles.openHintText}>OPEN</Text>
              <Ionicons name="arrow-forward" size={12} color={slab.onPrimary} />
            </View>
          </View>

          {/* The destination gets the headline. Mid-journey, where you get off
              is the only question the card is being asked. */}
          <View style={styles.headlineRow}>
            <View style={styles.headline}>
              <Text style={styles.kicker}>HEADING TO</Text>
              <Text style={styles.destination} numberOfLines={2} ellipsizeMode="tail">
                {stations.destination.name}
              </Text>
              <Text style={styles.origin} numberOfLines={1} ellipsizeMode="tail">
                from {stations.origin.name}
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
                  <Ionicons name="flag" size={30} color={slab.onPrimary} />
                  <Text style={styles.counterLabel}>ARRIVED</Text>
                </>
              ) : (
                <>
                  <Text style={styles.counterNumber}>{remaining}</Text>
                  <Text style={styles.counterLabel}>{remaining === 1 ? 'STOP' : 'STOPS'}</Text>
                </>
              )}
            </View>
          </View>

          {/* Every station on the journey as one tick. Behind you they're
              solid, ahead they're ghosts, and the one you're standing at is
              tall and breathing -- so the card shows how far along you are
              without a percentage or a progress bar's rounded lie. */}
          <View style={styles.meter}>
            {sequence.map((station) => {
              const isCurrent = nearestIndex !== null && station.index === nearestIndex;
              const isPassed = nearestIndex !== null && station.index < nearestIndex;
              if (isCurrent) {
                return (
                  <Animated.View
                    key={station.index}
                    style={[styles.tick, styles.tickCurrent, currentTickStyle]}
                  />
                );
              }
              return (
                <View
                  key={station.index}
                  style={[styles.tick, isPassed ? styles.tickPassed : styles.tickAhead]}
                />
              );
            })}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function createStyles(
  colors: ColorTokens,
  slab: ColorTokens,
  radius: { none: number; badge: number },
  typography: Record<string, TypeStyle>,
) {
  return StyleSheet.create({
    section: {
      // No section header of its own. A label reading "Live Journey" above a
      // slab that already says LIVE in it would be the same word twice, and
      // the caps header is the visual language of the *lists* below.
      gap: 0,
    },
    // Pushed away from the canvas rather than lifted off it: in dark mode this
    // is the blackest thing on screen, in light mode the palest. The hairline
    // is what keeps its edges findable at either extreme.
    slab: {
      backgroundColor: slab.accent,
      borderRadius: radius.none,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      // Clips the leg bar to the slab's corners.
      overflow: 'hidden',
    },
    slabPressed: {
      opacity: 0.88,
    },
    legBar: {
      flexDirection: 'row',
      height: 5,
    },
    body: {
      paddingTop: 12,
      paddingBottom: 14,
      paddingHorizontal: 14,
      gap: 14,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    livePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    liveDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.success,
    },
    liveLabel: {
      ...typography.labelCaps,
      fontSize: 11,
      color: slab.onPrimary,
    },
    openHint: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      opacity: 0.7,
    },
    openHintText: {
      ...typography.labelCaps,
      fontSize: 10,
      color: slab.onPrimary,
    },
    headlineRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 12,
    },
    headline: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    kicker: {
      ...typography.labelCaps,
      fontSize: 10,
      color: slab.onPrimary,
      opacity: 0.6,
    },
    destination: {
      ...typography.headlineLg,
      fontSize: 24,
      lineHeight: 27,
      color: slab.onPrimary,
    },
    origin: {
      ...typography.bodyMd,
      fontSize: 12,
      color: slab.onPrimary,
      opacity: 0.7,
    },
    // The number is the one thing readable from arm's length on a moving
    // train, so it is sized like a departure board rather than like body text.
    counter: {
      alignItems: 'center',
      justifyContent: 'flex-end',
      minWidth: 54,
    },
    counterNumber: {
      ...typography.headlineLg,
      fontSize: 40,
      lineHeight: 42,
      color: slab.onPrimary,
    },
    counterDash: {
      ...typography.headlineLg,
      fontSize: 34,
      lineHeight: 42,
      color: slab.onPrimary,
      opacity: 0.5,
    },
    counterLabel: {
      ...typography.labelCaps,
      fontSize: 9,
      color: slab.onPrimary,
      opacity: 0.7,
      marginTop: 2,
    },
    // flex:1 ticks rather than fixed widths: a four-stop hop and a
    // thirty-stop haul both fill the slab edge to edge.
    meter: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      height: CURRENT_TICK_HEIGHT,
      gap: 2,
    },
    tick: {
      flex: 1,
      borderRadius: radius.none,
      backgroundColor: slab.onPrimary,
    },
    tickPassed: {
      height: TICK_HEIGHT,
      opacity: 0.95,
    },
    tickAhead: {
      height: TICK_HEIGHT,
      opacity: 0.28,
    },
    tickCurrent: {
      height: CURRENT_TICK_HEIGHT,
    },
  });
}
