import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  withTiming,
  type EntryAnimationsValues,
  type ExitAnimationsValues,
} from 'react-native-reanimated';
import { getCompiledGraph } from '../engine/graph';
import type { CompiledStation, LineId, RouteResult, StationId } from '../engine/types';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens } from '../theme/tokens';

interface Props {
  station: CompiledStation | null;
  /** The journey currently drawn on the map, if any. */
  route: RouteResult | null;
  /** When the journey is treated as starting, for turning offsets into clock
   * times. Ignored when `route` is null. */
  startMs: number;
  onClose: () => void;
}

export interface StationRoutePosition {
  /** Seconds from the start of the journey to arriving here. */
  offsetSeconds: number;
  /** How many stops in from the origin, origin itself being 0. */
  stopsFromOrigin: number;
  line: LineId;
  isOrigin: boolean;
  isDestination: boolean;
}

/**
 * Where a station falls on a journey, or null if the journey doesn't call
 * there. Times accumulate the same way the itinerary does -- transfer time
 * first, then the ride -- so the two screens can't disagree about when you
 * arrive somewhere.
 *
 * Legs only carry a total ride time, not per-hop times, so a station in the
 * middle of a leg is placed by even division across that leg's hops. Boarding
 * and alighting stations are exact.
 */
export function findStationOnRoute(
  route: RouteResult,
  stationId: StationId,
): StationRoutePosition | null {
  let offset = 0;
  let stops = 0;

  for (const leg of route.legs) {
    offset += leg.transferSecondsBefore;

    if (leg.boardingStation.stationId === stationId) {
      return position(offset, stops, leg.line, route, stationId);
    }

    const hops = leg.intermediateStations.length + 1;
    for (let i = 0; i < leg.intermediateStations.length; i++) {
      if (leg.intermediateStations[i].stationId === stationId) {
        return position(
          offset + (leg.legTimeSeconds * (i + 1)) / hops,
          stops + i + 1,
          leg.line,
          route,
          stationId,
        );
      }
    }

    offset += leg.legTimeSeconds;
    stops += hops;

    if (leg.alightingStation.stationId === stationId) {
      return position(offset, stops, leg.line, route, stationId);
    }
  }

  return null;
}

function position(
  offsetSeconds: number,
  stopsFromOrigin: number,
  line: LineId,
  route: RouteResult,
  stationId: StationId,
): StationRoutePosition {
  return {
    offsetSeconds,
    stopsFromOrigin,
    line,
    isOrigin: stationId === route.originStationId,
    isDestination: stationId === route.destinationStationId,
  };
}

function formatClock(startMs: number, offsetSeconds: number): string {
  const d = new Date(startMs + offsetSeconds * 1000);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
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
export function StationDetailCard({ station, route, startMs, onClose }: Props) {
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
        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close station details"
        >
          <Ionicons name="close" size={20} color={colors.textSecondary} />
        </Pressable>
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
              label="Arrive"
              value={formatClock(startMs, onRoute.offsetSeconds)}
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
