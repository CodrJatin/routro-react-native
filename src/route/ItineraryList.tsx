import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import type { ItineraryLeg, ItineraryStep, RawLines, RouteResult } from '../engine/types';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens, TypeStyle } from '../theme/tokens';

const RAIL_WIDTH = 22;
const LINE_THICKNESS = 3;

function formatClock(startMs: number, offsetSeconds: number): string {
  const d = new Date(startMs + offsetSeconds * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatStops(count: number): string {
  return `${count} ${count === 1 ? 'Stop' : 'Stops'}`;
}

function formatMinutes(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export function ItineraryList({
  route,
  lines,
  startMs,
}: {
  route: RouteResult;
  lines: RawLines;
  startMs: number;
}) {
  const { colors, radius, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, radius, typography), [colors, radius, typography]);

  const rows = useMemo(() => buildRows(route.legs, lines), [route.legs, lines]);

  return (
    <View style={styles.card}>
      {rows.map((row, index) =>
        row.kind === 'ride' ? (
          <RideRow key={`ride-${index}`} row={row} styles={styles} colors={colors} />
        ) : (
          <StationRow
            key={`station-${index}`}
            row={row}
            time={formatClock(startMs, row.timeOffsetSeconds)}
            styles={styles}
            colors={colors}
          />
        ),
      )}
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

    clockSeconds += leg.transferSecondsBefore + leg.legTimeSeconds;
    rows.push({ kind: 'ride', leg, color, lineName });
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
  time,
  styles,
  colors,
}: {
  row: StationRowData;
  time: string;
  styles: ReturnType<typeof createStyles>;
  colors: ColorTokens;
}) {
  return (
    <Animated.View style={styles.row} layout={LinearTransition.duration(200)}>
      <View style={styles.rail}>
        <View
          style={[
            styles.railHalf,
            { backgroundColor: row.kind === 'origin' ? 'transparent' : row.lineColorAbove },
          ]}
        />
        <StationMarker row={row} styles={styles} colors={colors} />
        <View
          style={[
            styles.railHalf,
            { backgroundColor: row.kind === 'destination' ? 'transparent' : row.lineColorBelow },
          ]}
        />
      </View>
      <View style={styles.stationContent}>
        <View style={styles.stationHeaderRow}>
          <Text style={styles.stationName}>{row.step.stationName}</Text>
          <Text style={styles.stationTime}>{time}</Text>
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
  styles,
  colors,
}: {
  row: StationRowData;
  styles: ReturnType<typeof createStyles>;
  colors: ColorTokens;
}) {
  if (row.kind === 'destination') {
    return <View style={styles.destinationMarker} />;
  }
  if (row.kind === 'interchange') {
    return (
      <View style={styles.interchangeMarker}>
        <Ionicons name={row.isWalk ? 'walk' : 'swap-vertical'} size={11} color={colors.textPrimary} />
      </View>
    );
  }
  return <View style={styles.originMarker} />;
}

function RideRow({
  row,
  styles,
  colors,
}: {
  row: RideRowData;
  styles: ReturnType<typeof createStyles>;
  colors: ColorTokens;
}) {
  const [expanded, setExpanded] = useState(false);
  const stopCount = row.leg.intermediateStations.length + 1;

  return (
    <Animated.View style={styles.row} layout={LinearTransition.duration(200)}>
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
        {expanded && (
          <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)}>
            {row.leg.intermediateStations.map((station) => (
              <Text key={station.stationId} style={styles.intermediateStation} numberOfLines={1}>
                {station.stationName}
              </Text>
            ))}
          </Animated.View>
        )}
      </View>
    </Animated.View>
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
    },
    row: {
      flexDirection: 'row',
    },
    rail: {
      width: RAIL_WIDTH,
      alignItems: 'center',
    },
    railHalf: {
      width: LINE_THICKNESS,
      flex: 1,
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
      paddingHorizontal: 14,
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
      paddingHorizontal: 14,
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
      paddingLeft: 19,
    },
  });
}
