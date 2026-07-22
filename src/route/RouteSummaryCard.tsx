import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RouteResult } from '../engine/types';
import { colors } from '../theme/colors';

export function RouteSummaryCard({
  route,
  onGoToMap,
}: {
  route: RouteResult;
  onGoToMap: () => void;
}) {
  const minutes = Math.max(1, Math.round(route.totalTimeSeconds / 60));

  return (
    <View style={styles.card}>
      <View style={styles.metricsRow}>
        <Metric value={`${minutes}`} unit="min" label="Duration" />
        <Metric value={`${route.stationsPassed}`} label="Stations" />
        <Metric value={`${route.interchanges}`} label="Interchanges" />
        <Metric value={`₹${route.fareRupees}`} label="Est. Fare" />
      </View>
      <Pressable style={styles.goToMapButton} onPress={onGoToMap}>
        <Ionicons name="map" size={16} color={colors.background} />
        <Text style={styles.goToMapText}>Go to Map</Text>
      </Pressable>
    </View>
  );
}

function Metric({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>
        {value}
        {unit ? <Text style={styles.metricUnit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 14,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metric: {
    alignItems: 'center',
    flex: 1,
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  metricUnit: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  metricLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  goToMapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 11,
    gap: 8,
  },
  goToMapText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: '700',
  },
});
