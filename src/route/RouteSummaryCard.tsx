import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RawLines, RouteResult } from '../engine/types';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens, TypeStyle } from '../theme/tokens';

const ACTION_HEIGHT = 44;

export function RouteSummaryCard({
  route,
  lines,
  onGoToMap,
  isSaved,
  onToggleSave,
}: {
  route: RouteResult;
  lines: RawLines;
  onGoToMap: () => void;
  isSaved: boolean;
  onToggleSave: () => void;
}) {
  const { colors, radius, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, radius.none, typography), [colors, radius, typography]);
  const minutes = Math.max(1, Math.round(route.totalTimeSeconds / 60));
  // Swatch colours come from the legs (one per boarding after the first);
  // the count itself comes from the engine, which is authoritative.
  const interchangeColors = route.legs.slice(1).map((leg) => lines[leg.line]?.color ?? colors.accent);
  const distanceLabel =
    route.distanceMeters < 1000
      ? `${Math.round(route.distanceMeters)} m`
      : `${(route.distanceMeters / 1000).toFixed(1)} km`;

  return (
    <View style={styles.card}>
      <View style={styles.metricsRow}>
        <Metric value={`${minutes}`} unit="MIN" label="Time" styles={styles} />
        <Metric value={`₹${route.fareRupees}`} label="Fare" styles={styles} />
        <View style={styles.interchangeGroup}>
          <Text style={styles.metricLabel}>Interchanges ({route.interchanges})</Text>
          <View style={styles.swatchRow}>
            {interchangeColors.length === 0 ? (
              <Text style={styles.directText}>Direct</Text>
            ) : (
              interchangeColors.map((color, index) => (
                <View key={index} style={[styles.swatch, { backgroundColor: color }]} />
              ))
            )}
          </View>
        </View>
      </View>

      {/* Distance and station count were computed by the engine and never
          shown. A quiet secondary line rather than a fourth headline metric:
          four 30px display values don't fit a phone width without cramping. */}
      <Text style={styles.metaLine}>
        {distanceLabel} · {route.stationsPassed} stations
      </Text>

      <View style={styles.actionRow}>
        <Pressable
          style={({ pressed }) => [styles.goToMapButton, pressed && styles.pressed]}
          onPress={onGoToMap}
        >
          <Ionicons name="map" size={16} color={colors.onPrimary} />
          <Text style={styles.goToMapText}>Go to Map</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.saveButton, isSaved && styles.saveButtonActive, pressed && styles.pressed]}
          onPress={onToggleSave}
          accessibilityRole="button"
          accessibilityState={{ selected: isSaved }}
          accessibilityLabel={isSaved ? 'Remove from saved journeys' : 'Save this journey'}
        >
          <Ionicons
            name={isSaved ? 'bookmark' : 'bookmark-outline'}
            size={18}
            color={isSaved ? colors.onPrimary : colors.textPrimary}
          />
        </Pressable>
      </View>
    </View>
  );
}

function Metric({
  value,
  unit,
  label,
  styles,
}: {
  value: string;
  unit?: string;
  label: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>
        {value}
        {unit ? <Text style={styles.metricUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

function createStyles(colors: ColorTokens, radiusNone: number, typography: Record<string, TypeStyle>) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surfaceContainerLow,
      borderRadius: radiusNone,
      borderWidth: 1,
      borderColor: colors.outline,
      padding: 16,
      gap: 16,
    },
    metricsRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
    },
    metric: {
      gap: 4,
    },
    metricLabel: {
      ...typography.labelCaps,
      color: colors.textSecondary,
    },
    metricValue: {
      ...typography.displayLg,
      fontSize: 30,
      lineHeight: 34,
      color: colors.textPrimary,
    },
    metricUnit: {
      ...typography.dataSm,
      color: colors.textSecondary,
    },
    metaLine: {
      ...typography.dataSm,
      color: colors.textSecondary,
      // Pulls up against the metrics row so it reads as their footnote
      // rather than as a third, equally-weighted block.
      marginTop: -8,
    },
    interchangeGroup: {
      alignItems: 'flex-end',
      gap: 8,
    },
    swatchRow: {
      flexDirection: 'row',
      gap: 6,
    },
    swatch: {
      width: 18,
      height: 18,
      borderRadius: radiusNone,
    },
    directText: {
      ...typography.dataSm,
      color: colors.textSecondary,
    },
    actionRow: {
      flexDirection: 'row',
      gap: 8,
    },
    // Fixed height (rather than vertical padding) so the square save button
    // beside it can match on both axes without measuring.
    goToMapButton: {
      flex: 1,
      height: ACTION_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
      borderRadius: radiusNone,
      gap: 8,
    },
    saveButton: {
      width: ACTION_HEIGHT,
      height: ACTION_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radiusNone,
      borderWidth: 1,
      borderColor: colors.outline,
      backgroundColor: colors.surface,
    },
    saveButtonActive: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    pressed: {
      opacity: 0.75,
    },
    goToMapText: {
      ...typography.bodyMd,
      fontSize: 14,
      fontWeight: '700',
      color: colors.onPrimary,
    },
  });
}
