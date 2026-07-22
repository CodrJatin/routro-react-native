import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ItineraryLeg, ItineraryStep, RawLines, RouteResult } from '../engine/types';
import { colors } from '../theme/colors';

export function ItineraryList({ route, lines }: { route: RouteResult; lines: RawLines }) {
  return (
    <View style={styles.container}>
      {route.legs.map((leg, index) => {
        const previousLeg = route.legs[index - 1];
        const isWalkTransfer =
          !!previousLeg &&
          previousLeg.alightingStation.stationId !== leg.boardingStation.stationId;

        return (
          <View key={`${leg.line}-${index}`}>
            {index > 0 && (
              <View style={styles.interchangeRow}>
                <Ionicons
                  name={isWalkTransfer ? 'walk' : 'swap-vertical'}
                  size={14}
                  color={colors.accent}
                />
                <Text style={styles.interchangeText}>
                  {isWalkTransfer
                    ? `Walk to ${leg.boardingStation.stationName}`
                    : `Change at ${leg.boardingStation.stationName}`}
                </Text>
              </View>
            )}
            <LegCard leg={leg} line={lines[leg.line]} />
          </View>
        );
      })}
    </View>
  );
}

function LegCard({ leg, line }: { leg: ItineraryLeg; line?: RawLines[string] }) {
  const [expanded, setExpanded] = useState(false);
  const color = line?.color ?? colors.accent;
  const stopCount = leg.intermediateStations.length;

  return (
    <View style={styles.legCard}>
      <View style={[styles.lineBar, { backgroundColor: color }]} />
      <View style={styles.legBody}>
        <Text style={[styles.lineName, { color }]}>{line?.name ?? leg.line}</Text>

        <StationRow station={leg.boardingStation} icon="radio-button-on" tag="Board" />

        {stopCount > 0 && (
          <Pressable style={styles.expandRow} onPress={() => setExpanded((e) => !e)}>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={colors.textSecondary}
            />
            <Text style={styles.expandText}>
              {expanded ? 'Hide stops' : `${stopCount} stop${stopCount > 1 ? 's' : ''}`}
            </Text>
          </Pressable>
        )}

        {expanded &&
          leg.intermediateStations.map((station) => (
            <StationRow key={station.stationId} station={station} icon="ellipse-outline" muted />
          ))}

        <StationRow station={leg.alightingStation} icon="flag" tag="Alight" />
      </View>
    </View>
  );
}

function StationRow({
  station,
  icon,
  tag,
  muted,
}: {
  station: ItineraryStep;
  icon: keyof typeof Ionicons.glyphMap;
  tag?: string;
  muted?: boolean;
}) {
  return (
    <View style={styles.stationRow}>
      <Ionicons name={icon} size={muted ? 10 : 14} color={muted ? colors.textSecondary : colors.textPrimary} />
      <Text style={[styles.stationName, muted && styles.stationNameMuted]} numberOfLines={1}>
        {station.stationName}
      </Text>
      {tag && <Text style={styles.stationTag}>{tag}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
  },
  interchangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingLeft: 14,
  },
  interchangeText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '600',
  },
  legCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  lineBar: {
    width: 5,
  },
  legBody: {
    flex: 1,
    padding: 14,
    gap: 8,
  },
  lineName: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  stationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stationName: {
    color: colors.textPrimary,
    fontSize: 14,
    flex: 1,
  },
  stationNameMuted: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  stationTag: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  expandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 22,
    paddingVertical: 2,
  },
  expandText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
});
