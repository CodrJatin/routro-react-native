import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
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
import type { ItineraryLeg, ItineraryStep, RawLines, RouteResult, StationId } from '../engine/types';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens, TypeStyle } from '../theme/tokens';
import { formatStationArrival, type RouteClock } from './routeClock';
import { buildStationMarks, type RouteProgress, type RouteStationMark } from './routeProgress';
import { legStopOffsets } from './stationOnRoute';

const RAIL_WIDTH = 22;
const LINE_THICKNESS = 3;

/** How far the card's contents sit from its border. */
const CARD_PADDING = 22;

/**
 * Gap between the rail column and the text beside it.
 *
 * Tighter than `CARD_PADDING`: the rail and the station name are one thing
 * read together -- the line says where the name sits in the journey -- and
 * spacing them as widely as the card is spaced from its own border made them
 * read as two columns that happen to be adjacent.
 */
const RAIL_GAP = 8;

/**
 * Left inset on the card, chosen so the *centre of the line* lands
 * `CARD_PADDING` from the border rather than the edge of the rail column.
 *
 * The rail is a fixed-width column with the line centred in it, so padding it
 * like ordinary content would inset the column and push the line another half
 * a column further in. Centring on the same measurement the times use on the
 * right is what makes the two sides look equal.
 */
const RAIL_INSET = CARD_PADDING - RAIL_WIDTH / 2;

/**
 * Every row draws its own piece of the rail, and row heights land on
 * fractional pixels (text line-heights, minHeights, borders), so where two
 * rows meet the device rounds each edge independently and leaves a hairline
 * of card colour showing through. Negative vertical margins stretch each
 * rail one pixel past its row at both ends, so consecutive pieces overlap
 * instead of merely touching and there is no seam left to round.
 */
const RAIL_BLEED = { marginTop: -1, marginBottom: -1 } as const;

function formatStops(count: number): string {
  return `${count} ${count === 1 ? 'Stop' : 'Stops'}`;
}

function formatMinutes(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export function ItineraryList({
  route,
  lines,
  clock,
  progress,
}: {
  route: RouteResult;
  lines: RawLines;
  /** What the journey's offsets are pinned to on the wall clock -- the trip
   * origin when planning, the user's own position when travelling. */
  clock: RouteClock;
  /** Where the user is along this journey, when that's known. */
  progress: RouteProgress | null;
}) {
  const { colors, radius, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, radius, typography), [colors, radius, typography]);

  const rows = useMemo(() => buildRows(route.legs, lines), [route.legs, lines]);
  // By station rather than by index: the itinerary renders legs, which repeat
  // a station at every interchange, while progress is measured along the
  // flattened journey.
  const marks = useMemo(() => buildStationMarks(progress), [progress]);

  return (
    <View style={styles.card}>
      {rows.map((row, index) => {
        if (row.kind === 'ride') {
          return (
            <RideRow
              key={`ride-${index}`}
              row={row}
              marks={marks}
              clock={clock}
              styles={styles}
              colors={colors}
            />
          );
        }
        const mark = marks.get(row.step.stationId);
        return (
          <StationRow
            key={`station-${index}`}
            row={row}
            mark={mark}
            time={formatStationArrival(clock, row.timeOffsetSeconds, mark)}
            styles={styles}
            colors={colors}
          />
        );
      })}
    </View>
  );
}

// ---- row model -------------------------------------------------------

type StationRowData =
  | { kind: 'origin'; step: ItineraryStep; lineColorBelow: string; timeOffsetSeconds: number }
  | {
      kind: 'interchange';
      step: ItineraryStep;
      lineColorAbove: string;
      lineColorBelow: string;
      toLineName: string;
      transferSecondsBefore: number;
      isWalk: boolean;
      timeOffsetSeconds: number;
    }
  | { kind: 'destination'; step: ItineraryStep; lineColorAbove: string; timeOffsetSeconds: number };

type RideRowData = {
  kind: 'ride';
  leg: ItineraryLeg;
  color: string;
  lineName: string;
  /** Arrival offsets for `leg.intermediateStations`, by the same index. */
  stopOffsetSeconds: number[];
};

type Row = StationRowData | RideRowData;

function buildRows(legs: ItineraryLeg[], lines: RawLines): Row[] {
  const rows: Row[] = [];
  // The clock at a station row reflects the ride + walk time consumed to
  // *reach* it. Its own outgoing transfer walk hasn't been paid yet -- that
  // only lands in the clock of the row after it, once the following ride is
  // added too. Matches e.g. board 10:45 -> (6 min ride) -> arrive 10:51 ->
  // (3 min walk + 8 min ride, not shown separately) -> arrive 11:02.
  let clockSeconds = 0;

  legs.forEach((leg, index) => {
    const color = lines[leg.line]?.color ?? '#888888';
    const lineName = lines[leg.line]?.name ?? leg.line;

    if (index === 0) {
      rows.push({ kind: 'origin', step: leg.boardingStation, lineColorBelow: color, timeOffsetSeconds: clockSeconds });
    } else {
      const previousLeg = legs[index - 1];
      const previousColor = lines[previousLeg.line]?.color ?? '#888888';
      rows.push({
        kind: 'interchange',
        step: previousLeg.alightingStation,
        lineColorAbove: previousColor,
        lineColorBelow: color,
        toLineName: lineName,
        transferSecondsBefore: leg.transferSecondsBefore,
        isWalk: previousLeg.alightingStation.stationId !== leg.boardingStation.stationId,
        timeOffsetSeconds: clockSeconds,
      });
    }

    const stopOffsetSeconds = legStopOffsets(leg, clockSeconds + leg.transferSecondsBefore);

    clockSeconds += leg.transferSecondsBefore + leg.legTimeSeconds;
    rows.push({ kind: 'ride', leg, color, lineName, stopOffsetSeconds });
  });

  const lastLeg = legs[legs.length - 1];
  rows.push({
    kind: 'destination',
    step: lastLeg.alightingStation,
    lineColorAbove: lines[lastLeg.line]?.color ?? '#888888',
    timeOffsetSeconds: clockSeconds,
  });

  return rows;
}

// ---- rendering ---------------------------------------------------------

function StationRow({
  row,
  mark,
  time,
  styles,
  colors,
}: {
  row: StationRowData;
  mark: RouteStationMark | undefined;
  time: string;
  styles: ReturnType<typeof createStyles>;
  colors: ColorTokens;
}) {
  return (
    <Animated.View style={styles.row} layout={LinearTransition.duration(200)}>
      {/* Two flexed halves fill the row edge to edge -- meeting in the middle
          with nothing between them -- and the marker is laid over the join.
          The line therefore arrives at the station and leaves it, rather than
          stopping short on both sides. They stay two halves rather than one
          because at an interchange the colour changes here. */}
      <View style={styles.rail}>
        <View
          style={[
            styles.railHalf,
            { backgroundColor: row.kind === 'origin' ? 'transparent' : row.lineColorAbove },
          ]}
        />
        <View
          style={[
            styles.railHalf,
            { backgroundColor: row.kind === 'destination' ? 'transparent' : row.lineColorBelow },
          ]}
        />
        <View style={styles.railMarkerOverlay} pointerEvents="none">
          <StationMarker row={row} mark={mark} styles={styles} colors={colors} />
        </View>
      </View>
      <View style={[styles.stationContent, mark === 'passed' && styles.passed]}>
        <View style={styles.stationHeaderRow}>
          <Text style={styles.stationName}>{row.step.stationName}</Text>
          <Text style={[styles.stationTime, mark === 'passed' && styles.stationTimePassed]}>
            {time}
          </Text>
        </View>
        {row.kind === 'interchange' && (
          <View style={styles.changeRow}>
            <Ionicons
              name={row.isWalk ? 'walk' : 'swap-vertical'}
              size={13}
              color={colors.textSecondary}
            />
            <Text style={styles.changeText}>
              Change to {row.toLineName}
              {row.isWalk ? ` · Walk ${formatMinutes(row.transferSecondsBefore)}` : ` · ${formatMinutes(row.transferSecondsBefore)}`}
            </Text>
          </View>
        )}
        {row.kind === 'destination' && <Text style={styles.changeText}>Arrived at destination</Text>}
      </View>
    </Animated.View>
  );
}

function StationMarker({
  row,
  mark,
  styles,
  colors,
}: {
  row: StationRowData;
  mark: RouteStationMark | undefined;
  styles: ReturnType<typeof createStyles>;
  colors: ColorTokens;
}) {
  const marker =
    row.kind === 'destination' ? (
      <View style={styles.destinationMarker} />
    ) : row.kind === 'interchange' ? (
      <View style={styles.interchangeMarker}>
        <Ionicons name={row.isWalk ? 'walk' : 'swap-vertical'} size={11} color={colors.textPrimary} />
      </View>
    ) : (
      <View style={styles.originMarker} />
    );

  if (mark !== 'current') return marker;

  // At an origin/interchange/destination the row's own marker is carrying
  // real information (which way to change, where the trip ends), so "you are
  // here" wraps it rather than replacing it. The ring follows the marker's
  // shape -- round on the origin dot, square on the two boxes.
  return (
    <View style={styles.markerWrap}>
      <CurrentPulse
        color={colors.textPrimary}
        style={
          row.kind === 'origin'
            ? styles.ringOrigin
            : row.kind === 'interchange'
              ? styles.ringInterchange
              : styles.ringDestination
        }
      />
      {marker}
    </View>
  );
}

/** Monochrome "you are here": an outline that expands and fades on a loop.
 * Same pulse language as the broadcast button on the map, so a live,
 * position-derived thing always reads the same way. */
function CurrentPulse({
  color,
  style,
  rotate = '0deg',
}: {
  color: string;
  style: StyleProp<ViewStyle>;
  rotate?: string;
}) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = 0;
    pulse.value = withRepeat(
      withTiming(1, { duration: 1700, easing: Easing.out(Easing.ease) }),
      -1,
      false,
    );
  }, [pulse]);

  // Grows only a little: the rail is 22px wide and the card clips at its
  // border, so a map-sized ping would either be sliced flat on the left or
  // sweep across the station name to its right.
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - pulse.value),
    transform: [{ rotate }, { scale: 1 + pulse.value * 0.3 }],
  }));

  return <Animated.View pointerEvents="none" style={[style, { borderColor: color }, animatedStyle]} />;
}

function RideRow({
  row,
  marks,
  clock,
  styles,
  colors,
}: {
  row: RideRowData;
  marks: Map<StationId, RouteStationMark>;
  clock: RouteClock;
  styles: ReturnType<typeof createStyles>;
  colors: ColorTokens;
}) {
  const [expanded, setExpanded] = useState(false);
  const stopCount = row.leg.intermediateStations.length + 1;

  // Where the user is, when that is one of the stops this leg runs through.
  // Boarding and alighting stations are their own rows already, so only the
  // in-between ones can go missing behind a collapsed list -- which is most of
  // them, and most of a journey.
  const currentIndex = row.leg.intermediateStations.findIndex(
    (station) => marks.get(station.stationId) === 'current',
  );
  const currentStation = currentIndex === -1 ? null : row.leg.intermediateStations[currentIndex];

  return (
    <Animated.View layout={LinearTransition.duration(200)}>
      <View style={styles.row}>
        <View style={styles.rail}>
          <View style={[styles.railFull, { backgroundColor: row.color }]} />
        </View>
        <View style={styles.rideContent}>
          <View style={styles.lineBadge}>
            <Ionicons name="train" size={12} color={colors.textPrimary} />
            <Text style={styles.lineBadgeText}>{row.lineName.toUpperCase()}</Text>
          </View>
          <Text style={styles.rideMeta}>
            {formatStops(stopCount)} · {formatMinutes(row.leg.legTimeSeconds)}
          </Text>

          {row.leg.intermediateStations.length > 0 && (
            <Pressable style={styles.expandRow} onPress={() => setExpanded((e) => !e)}>
              <Ionicons
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={13}
                color={colors.textSecondary}
              />
              <Text style={styles.expandText}>
                {expanded ? 'Hide stops' : `Show ${row.leg.intermediateStations.length} in between`}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Where you are, kept on screen while the leg is collapsed. Without it
          the one station the user most needs -- their own -- is the one thing
          the list hides, since it is an ordinary in-between stop on all but
          the few hops that start or end a leg. Dropped when expanded, where
          the full list carries the same marker in its proper place. */}
      {!expanded && currentStation && (
        <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)}>
          <CurrentStopRow
            station={currentStation}
            color={row.color}
            styles={styles}
            colors={colors}
          />
        </Animated.View>
      )}

      {/* Outside the content column, so each stop gets its own row with the
          rail running through it -- the dots have to sit *on* the line, and
          the position marker has to be able to land on any one of them. */}
      {expanded && (
        <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)}>
          {row.leg.intermediateStations.map((station, i) => {
            const mark = marks.get(station.stationId);
            return (
              <IntermediateRow
                key={station.stationId}
                station={station}
                mark={mark}
                // Nothing for a stop already behind you: the dimmed name and
                // the filled dot say it, and a column of "Passed" down the
                // expanded leg would drown the arrivals still to come.
                time={
                  mark === 'passed'
                    ? null
                    : formatStationArrival(clock, row.stopOffsetSeconds[i], mark)
                }
                color={row.color}
                styles={styles}
                colors={colors}
              />
            );
          })}
        </Animated.View>
      )}
    </Animated.View>
  );
}

/**
 * "You are here", shown on a collapsed leg.
 *
 * Pitched between the two row weights either side of it: the same pulsing
 * diamond and rail as an expanded in-between stop, but a readable name and a
 * primary-coloured "Now" rather than the dimmed single line those get. It
 * deliberately stops short of a full station row -- no line badge, no headline
 * type -- because this is not somewhere the user has to do anything, and
 * dressing it like an interchange would say that it is.
 */
function CurrentStopRow({
  station,
  color,
  styles,
  colors,
}: {
  station: ItineraryStep;
  color: string;
  styles: ReturnType<typeof createStyles>;
  colors: ColorTokens;
}) {
  return (
    <View style={styles.currentStopRow}>
      <View style={styles.intermediateRail}>
        <View style={[styles.railBehind, { backgroundColor: color }]} />
        <View style={styles.markerWrap}>
          <CurrentPulse color={colors.textPrimary} style={styles.ringIntermediate} rotate="45deg" />
          <View
            style={[
              styles.currentDiamond,
              { backgroundColor: colors.textPrimary, borderColor: colors.surfaceContainerLow },
            ]}
          />
        </View>
      </View>
      <Text style={styles.currentStopName} numberOfLines={1}>
        {station.stationName}
      </Text>
      <Text style={styles.currentStopTime}>Now</Text>
    </View>
  );
}

function IntermediateRow({
  station,
  mark,
  time,
  color,
  styles,
  colors,
}: {
  station: ItineraryStep;
  mark: RouteStationMark | undefined;
  /** Null for a stop already behind you, which has no arrival left to quote. */
  time: string | null;
  color: string;
  styles: ReturnType<typeof createStyles>;
  colors: ColorTokens;
}) {
  return (
    <View style={styles.intermediateRow}>
      <View style={styles.intermediateRail}>
        <View style={[styles.railBehind, { backgroundColor: color }]} />
        {mark === 'current' ? (
          <View style={styles.markerWrap}>
            <CurrentPulse color={colors.textPrimary} style={styles.ringIntermediate} rotate="45deg" />
            <View
              style={[
                styles.currentDiamond,
                { backgroundColor: colors.textPrimary, borderColor: colors.surfaceContainerLow },
              ]}
            />
          </View>
        ) : (
          <View
            style={[
              styles.intermediateDot,
              mark === 'passed'
                ? { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary }
                : { backgroundColor: colors.surfaceContainerLow, borderColor: color },
            ]}
          />
        )}
      </View>
      <Text
        style={[styles.intermediateStation, mark === 'passed' && styles.passed]}
        numberOfLines={1}
      >
        {station.stationName}
      </Text>
      {time !== null && <Text style={styles.intermediateTime}>{time}</Text>}
    </View>
  );
}

function createStyles(colors: ColorTokens, radius: { none: number; badge: number }, typography: Record<string, TypeStyle>) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surfaceContainerLow,
      borderRadius: radius.none,
      borderWidth: 1,
      borderColor: colors.outline,
      overflow: 'hidden',
      // Left only. The right-hand inset is the content's own padding, which
      // has to stay on the content -- a row's rail must still reach the card's
      // top and bottom edges, and vertical padding here would break the line.
      paddingLeft: RAIL_INSET,
    },
    row: {
      flexDirection: 'row',
    },
    rail: {
      width: RAIL_WIDTH,
      alignItems: 'center',
      ...RAIL_BLEED,
    },
    railHalf: {
      width: LINE_THICKNESS,
      flex: 1,
    },
    /** Sits over the join between the two halves. Absolute so the line's
     * length is decided by the row, not by how tall the marker happens to
     * be -- a percentage height here resolves to nothing against a
     * cross-stretched parent, which is what left a gap on either side. */
    railMarkerOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    railFull: {
      width: LINE_THICKNESS,
      flex: 1,
    },
    originMarker: {
      width: 16,
      height: 16,
      borderRadius: 8,
      borderWidth: 2,
      borderColor: colors.textPrimary,
      backgroundColor: colors.surfaceContainerLow,
    },
    interchangeMarker: {
      width: 20,
      height: 20,
      borderRadius: radius.none,
      borderWidth: 2,
      borderColor: colors.textPrimary,
      backgroundColor: colors.surfaceContainerLow,
      alignItems: 'center',
      justifyContent: 'center',
    },
    destinationMarker: {
      width: 14,
      height: 14,
      borderRadius: radius.none,
      backgroundColor: colors.textPrimary,
    },
    stationContent: {
      flex: 1,
      paddingVertical: 14,
      paddingLeft: RAIL_GAP,
      paddingRight: CARD_PADDING,
      gap: 4,
    },
    stationHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    stationName: {
      ...typography.headlineMd,
      fontSize: 18,
      lineHeight: 22,
      color: colors.textPrimary,
      flexShrink: 1,
    },
    stationTime: {
      ...typography.dataLg,
      color: colors.textPrimary,
    },
    /** "Passed" is a state, not a time -- given the same weight as the clock
     * it shouts down the arrivals that are still ahead of you. */
    stationTimePassed: {
      ...typography.dataSm,
      color: colors.textSecondary,
    },
    changeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    changeText: {
      ...typography.bodyMd,
      fontSize: 13,
      color: colors.textSecondary,
    },
    rideContent: {
      flex: 1,
      paddingVertical: 10,
      paddingLeft: RAIL_GAP,
      paddingRight: CARD_PADDING,
      gap: 6,
    },
    lineBadge: {
      flexDirection: 'row',
      alignSelf: 'flex-start',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.surfaceContainerHigh,
      borderRadius: radius.badge,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    lineBadgeText: {
      ...typography.labelCaps,
      color: colors.textPrimary,
    },
    rideMeta: {
      ...typography.dataSm,
      color: colors.textSecondary,
    },
    expandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingTop: 2,
    },
    expandText: {
      ...typography.bodyMd,
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    intermediateStation: {
      ...typography.dataSm,
      color: colors.textSecondary,
      flex: 1,
      // Same gap as the station rows above, so the two sets of names share one
      // left edge instead of the in-between stops hanging off a second one.
      paddingLeft: RAIL_GAP,
      paddingRight: 8,
    },
    // Taller than an in-between stop and shorter than a station row, matching
    // where it sits between the two in weight.
    currentStopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 40,
    },
    currentStopName: {
      ...typography.bodyMd,
      fontSize: 15,
      fontWeight: '600',
      color: colors.textPrimary,
      flex: 1,
      paddingLeft: RAIL_GAP,
      paddingRight: 8,
    },
    currentStopTime: {
      ...typography.dataSm,
      color: colors.textPrimary,
      paddingRight: CARD_PADDING,
    },
    /** Quieter than the station rows' clock: these are stops the train runs
     * through, and they shouldn't compete with the boards and changes that
     * the user actually has to act on. */
    intermediateTime: {
      ...typography.dataSm,
      color: colors.textSecondary,
      paddingRight: CARD_PADDING,
    },
    // No padding on the group: any space here is space the rail doesn't run
    // through, which shows up as a break in the line before the next station.
    // The stops get their room from the row height instead.
    intermediateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      // The stops used to be bare lines of text stacked tight against each
      // other; this is what gives each one room to read as its own stop.
      minHeight: 30,
    },
    intermediateRail: {
      width: RAIL_WIDTH,
      alignSelf: 'stretch',
      alignItems: 'center',
      justifyContent: 'center',
      ...RAIL_BLEED,
    },
    /** The line continues behind the dot rather than being interrupted by
     * it -- these rows sit mid-leg, the train doesn't stop being on the line. */
    railBehind: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      width: LINE_THICKNESS,
      // No `left`: centred by the rail's own alignItems, exactly like the
      // flexed halves on the station rows. Positioning this one by hand at
      // 9.5px let the two round to different physical pixels on fractional
      // densities, which reads as the line stepping sideways.
    },
    intermediateDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      borderWidth: 2,
    },
    /** Rotated square, not a circle: the origin/interchange/destination
     * markers set a hard-edged shape language and a soft blob would read as
     * a different kind of thing entirely. */
    currentDiamond: {
      width: 11,
      height: 11,
      borderWidth: 2,
      transform: [{ rotate: '45deg' }],
    },
    markerWrap: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Each ring clears its own marker by ~4px and otherwise stays inside the
    // rail. Round on the origin dot, square on everything else -- it has to
    // read as a halo on that marker, not as a second marker.
    ringOrigin: {
      position: 'absolute',
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 1.5,
    },
    ringInterchange: {
      position: 'absolute',
      width: 26,
      height: 26,
      borderRadius: radius.none,
      borderWidth: 1.5,
    },
    ringDestination: {
      position: 'absolute',
      width: 21,
      height: 21,
      borderRadius: radius.none,
      borderWidth: 1.5,
    },
    /** Rotated, so its diagonal (~21px) is what has to fit the 22px rail. */
    ringIntermediate: {
      position: 'absolute',
      width: 15,
      height: 15,
      borderRadius: radius.none,
      borderWidth: 1.5,
    },
    /** Already behind you. Dimmed rather than hidden -- the itinerary is
     * still the whole journey, you've just done part of it. */
    passed: {
      opacity: 0.45,
    },
  });
}
