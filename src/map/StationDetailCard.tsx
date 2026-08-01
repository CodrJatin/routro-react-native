import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  withTiming,
  type EntryAnimationsValues,
  type ExitAnimationsValues,
} from 'react-native-reanimated';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { getCompiledGraph } from '../engine/graph';
import type { CompiledStation, RouteResult } from '../engine/types';
import { formatStationArrival, type RouteClock } from '../route/routeClock';
import { buildStationMarks, type RouteProgress } from '../route/routeProgress';
import { findStationOnRoute } from '../route/stationOnRoute';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens } from '../theme/tokens';

interface Props {
  station: CompiledStation | null;
  /** The journey currently drawn on the map, if any. */
  route: RouteResult | null;
  /** What the journey's offsets are pinned to on the wall clock. Ignored when
   * `route` is null. Shared with the itinerary screen, which must not be able
   * to quote a different arrival time for the same station. */
  clock: RouteClock;
  /** Where the user is along that journey, when that's known. */
  progress: RouteProgress | null;
  onClose: () => void;
}

function formatMinutes(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min`;
}

/** Clears the card's resting inset plus a margin, so it starts and ends fully
 * hidden behind the tab bar rather than peeking above it. */
const OFFSCREEN_MARGIN = 48;

/** One resize curve for the card and everything inside it, so the box and its
 * contents settle together when the selected station changes. */
const RESIZE = LinearTransition.duration(220).easing(Easing.out(Easing.cubic));

/**
 * Rises out from under the tab bar. The preset SlideInDown starts a full window
 * height away, which over a short duration reads as a whoosh; travelling just
 * the card's own height instead makes it look like it was parked below the bar
 * the whole time.
 */
function slideUpFromNav(values: EntryAnimationsValues) {
  'worklet';
  return {
    initialValues: {
      originY: values.targetOriginY + values.targetHeight + OFFSCREEN_MARGIN,
      opacity: 0,
    },
    animations: {
      originY: withTiming(values.targetOriginY, {
        duration: 280,
        easing: Easing.out(Easing.cubic),
      }),
      opacity: withTiming(1, { duration: 160 }),
    },
  };
}

/** Retreats the way it came. Slightly quicker than the entrance, and the fade
 * finishes first so it doesn't visibly cross the tab bar on the way down. */
function slideDownToNav(values: ExitAnimationsValues) {
  'worklet';
  return {
    initialValues: { originY: values.currentOriginY, opacity: 1 },
    animations: {
      originY: withTiming(values.currentOriginY + values.currentHeight + OFFSCREEN_MARGIN, {
        duration: 220,
        easing: Easing.in(Easing.cubic),
      }),
      opacity: withTiming(0, { duration: 180 }),
    },
  };
}

/**
 * Tapping a station on the map opens this. Deliberately a fixed card rather
 * than a draggable sheet: there's one screenful of content and nothing to
 * expand to, so a drag handle would promise detail that doesn't exist.
 *
 * Switching stations while it's open keeps the same card mounted, so the
 * entrance doesn't replay -- the box just resizes under `layout` as the
 * content changes height.
 */
export function StationDetailCard({ station, route, clock, progress, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const lines = getCompiledGraph().lines;

  const stationLines = useMemo(
    () => station?.lines.map((lineId) => lines[lineId]).filter(Boolean) ?? [],
    [station, lines],
  );

  const onRoute = useMemo(
    () => (station && route ? findStationOnRoute(route, station.id) : null),
    [station, route],
  );

  // By station id rather than by sequence index: this card knows which station
  // was tapped, not where it falls in the flattened journey.
  const marks = useMemo(() => buildStationMarks(progress), [progress]);
  const mark = station ? marks.get(station.id) : undefined;

  if (!station) return null;

  const remainingSeconds = onRoute ? route!.totalTimeSeconds - onRoute.offsetSeconds : 0;

  return (
    <Animated.View
      style={styles.card}
      entering={slideUpFromNav}
      exiting={slideDownToNav}
      layout={RESIZE}
    >
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={2}>
          {station.name}
        </Text>
        <AnimatedPressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close station details"
        >
          <Ionicons name="close" size={20} color={colors.textSecondary} />
        </AnimatedPressable>
      </View>

      {/* One caption line carries both the lines and the fact that this is an
          interchange -- two named lines say that on their own, so the separate
          INTERCHANGE badge that used to sit above the chips is gone. */}
      <Animated.View style={styles.lineRow} layout={RESIZE}>
        {stationLines.map((line) => (
          <Animated.View
            key={line.id}
            style={styles.lineItem}
            entering={FadeIn.duration(160)}
            exiting={FadeOut.duration(120)}
            layout={RESIZE}
          >
            <View style={[styles.lineSwatch, { backgroundColor: line.color }]} />
            <Text style={styles.lineName}>{line.name}</Text>
          </Animated.View>
        ))}
      </Animated.View>

      {onRoute && (
        <Animated.View
          style={styles.routeBlock}
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(120)}
          layout={RESIZE}
        >
          <Text style={styles.routeLabel}>
            {onRoute.isOrigin
              ? 'START OF YOUR ROUTE'
              : onRoute.isDestination
                ? 'END OF YOUR ROUTE'
                : 'ON YOUR ROUTE'}
          </Text>
          <View style={styles.statRow}>
            <Stat
              styles={styles}
              label={mark === 'passed' ? 'Status' : 'Arrive'}
              value={formatStationArrival(clock, onRoute.offsetSeconds, mark)}
            />
            <Stat
              styles={styles}
              label={onRoute.isOrigin ? 'Stop' : 'Stops in'}
              value={onRoute.isOrigin ? 'Origin' : String(onRoute.stopsFromOrigin)}
            />
            {!onRoute.isDestination && (
              <Stat styles={styles} label="Left" value={formatMinutes(remainingSeconds)} />
            )}
          </View>
        </Animated.View>
      )}
    </Animated.View>
  );
}

function Stat({
  styles,
  label,
  value,
}: {
  styles: ReturnType<typeof createStyles>;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function createStyles(colors: ColorTokens) {
  return StyleSheet.create({
    card: {
      position: 'absolute',
      left: 16,
      // Stops clear of the locate/broadcast column (48pt wide, inset 16pt from
      // the edge), leaving the same 16pt gap against the buttons that they
      // keep from the screen edge.
      right: 16 + 48 + 16,
      bottom: 24,
      zIndex: 3,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      gap: 10,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
    },
    name: {
      flex: 1,
      fontFamily: 'Outfit_600SemiBold',
      fontSize: 18,
      lineHeight: 24,
      color: colors.textPrimary,
    },
    lineRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 14,
    },
    lineItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    lineSwatch: {
      width: 8,
      height: 8,
    },
    lineName: {
      fontFamily: 'Outfit_400Regular',
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    routeBlock: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 10,
      gap: 8,
    },
    routeLabel: {
      fontFamily: 'SpaceMono_700Bold',
      fontSize: 11,
      lineHeight: 14,
      letterSpacing: 1,
      color: colors.accent,
    },
    statRow: {
      flexDirection: 'row',
      gap: 24,
    },
    stat: {
      gap: 2,
    },
    statLabel: {
      fontFamily: 'Outfit_400Regular',
      fontSize: 12,
      color: colors.textSecondary,
    },
    statValue: {
      fontFamily: 'SpaceMono_700Bold',
      fontSize: 16,
      lineHeight: 20,
      color: colors.textPrimary,
    },
  });
}
