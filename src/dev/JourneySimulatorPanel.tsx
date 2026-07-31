import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { getStation } from '../engine/graph';
import type { RouteMode, StationId } from '../engine/types';
import { useJourneyStore } from '../journey/journeyStore';
import { useActiveRouteStore } from '../route/activeRouteStore';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens, TypeStyle } from '../theme/tokens';
import {
  SIMULATION_SPEEDS,
  simulatedStationName,
  useJourneySimulatorStore,
} from './journeySimulator';

/**
 * Drives a fake user along a real route, so the parts of this app that only
 * happen while moving can be tested without moving.
 *
 * Renders nothing outside `__DEV__`. It is in Settings rather than behind a
 * shake gesture because the things it is for -- the ongoing notification, the
 * get-off alert, the pin gliding across the map -- are watched from the
 * notification shade and the other tabs, so the panel has to be somewhere you
 * can reach and then leave.
 */
export function JourneySimulatorPanel() {
  const { colors, radius, typography } = useTheme();
  const styles = useMemo(
    () => createStyles(colors, radius.none, typography),
    [colors, radius, typography],
  );

  const session = useJourneyStore((state) => state.session);
  const activeOriginId = useActiveRouteStore((state) => state.originId);
  const activeDestinationId = useActiveRouteStore((state) => state.destinationId);
  const activeMode = useActiveRouteStore((state) => state.mode);

  const isRunning = useJourneySimulatorStore((state) => state.isRunning);
  const isPaused = useJourneySimulatorStore((state) => state.isPaused);
  const speed = useJourneySimulatorStore((state) => state.speed);
  const elapsedSeconds = useJourneySimulatorStore((state) => state.elapsedSeconds);
  const totalSeconds = useJourneySimulatorStore((state) => state.totalSeconds);
  const nearestIndex = useJourneySimulatorStore((state) => state.nearestIndex);
  const stationCount = useJourneySimulatorStore((state) => state.stationCount);

  if (!__DEV__) return null;

  // A tracked journey wins: it is the thing whose notification and alerts are
  // most likely being tested. The planner's route is the fallback, so a
  // simulation can also be run with no journey at all.
  const target: { originId: StationId; destinationId: StationId; mode: RouteMode } | null = session
    ? { originId: session.originId, destinationId: session.destinationId, mode: session.mode }
    : activeOriginId && activeDestinationId
      ? { originId: activeOriginId, destinationId: activeDestinationId, mode: activeMode }
      : null;

  const originName = target ? (getStation(target.originId)?.name ?? target.originId) : null;
  const destinationName = target
    ? (getStation(target.destinationId)?.name ?? target.destinationId)
    : null;

  const store = useJourneySimulatorStore.getState();
  const atStation = simulatedStationName(nearestIndex);
  const remaining = stationCount > 0 ? stationCount - 1 - nearestIndex : 0;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>DEV</Text>
        </View>
        <Text style={styles.headerText} numberOfLines={1}>
          {isRunning ? 'Faking your location' : 'Travel a route without moving'}
        </Text>
      </View>

      {target ? (
        <Text style={styles.routeLine} numberOfLines={2}>
          {originName} → {destinationName}
          <Text style={styles.routeSource}>
            {session ? '  · live journey' : '  · planner route'}
          </Text>
        </Text>
      ) : (
        <Text style={styles.hint}>
          Plan a route on the Routes tab (or start a journey) and it will show up here.
        </Text>
      )}

      {isRunning && (
        <View style={styles.readout}>
          <Text style={styles.readoutMain} numberOfLines={1}>
            {atStation ?? '—'}
          </Text>
          <Text style={styles.readoutMeta}>
            {remaining === 0 ? 'at the destination' : `${remaining} to go`} ·{' '}
            {formatClock(elapsedSeconds)} / {formatClock(totalSeconds)}
          </Text>
          <View style={styles.bar}>
            <View
              style={[
                styles.barFill,
                { width: `${totalSeconds > 0 ? (elapsedSeconds / totalSeconds) * 100 : 0}%` },
              ]}
            />
          </View>
        </View>
      )}

      <View style={styles.speedRow}>
        {SIMULATION_SPEEDS.map((option) => {
          const isSelected = option === speed;
          return (
            <Pressable
              key={option}
              style={[styles.speedChip, isSelected && styles.speedChipSelected]}
              onPress={() => store.setSpeed(option)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
            >
              <Text style={[styles.speedText, isSelected && styles.speedTextSelected]}>
                {option}×
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.actionRow}>
        {isRunning ? (
          <>
            <Action
              icon={isPaused ? 'play' : 'pause'}
              label={isPaused ? 'Resume' : 'Pause'}
              onPress={() => store.setPaused(!isPaused)}
              styles={styles}
              colors={colors}
            />
            <Action
              icon="play-skip-forward"
              label="Next stop"
              onPress={store.skipToNextStation}
              styles={styles}
              colors={colors}
            />
            <Action
              icon="refresh"
              label="Restart"
              onPress={store.restart}
              styles={styles}
              colors={colors}
            />
            <Action icon="stop" label="Stop" onPress={store.stop} styles={styles} colors={colors} />
          </>
        ) : (
          <Action
            icon="navigate"
            label="Start simulation"
            onPress={() => {
              if (target) store.start(target.originId, target.destinationId, target.mode);
            }}
            disabled={!target}
            styles={styles}
            colors={colors}
          />
        )}
      </View>

      <Text style={styles.footnote}>
        Real GPS is ignored while this runs. Sharing still broadcasts your actual position, not
        the fake one.
      </Text>
    </View>
  );
}

function Action({
  icon,
  label,
  onPress,
  disabled,
  styles,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  styles: ReturnType<typeof createStyles>;
  colors: ColorTokens;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.action,
        pressed && styles.actionPressed,
        disabled && styles.actionDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
    >
      <Ionicons
        name={icon}
        size={14}
        color={disabled ? colors.textSecondary : colors.textPrimary}
      />
      <Text style={[styles.actionText, disabled && styles.actionTextDisabled]}>{label}</Text>
    </Pressable>
  );
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

function createStyles(
  colors: ColorTokens,
  radiusNone: number,
  typography: Record<string, TypeStyle>,
) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radiusNone,
      padding: 14,
      gap: 12,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    badge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      backgroundColor: colors.textPrimary,
      borderRadius: radiusNone,
    },
    badgeText: {
      ...typography.labelCaps,
      fontSize: 9,
      color: colors.canvas,
    },
    headerText: {
      ...typography.bodyMd,
      flex: 1,
      minWidth: 0,
      fontSize: 13,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    routeLine: {
      ...typography.bodyMd,
      fontSize: 13,
      color: colors.textPrimary,
    },
    routeSource: {
      ...typography.dataSm,
      color: colors.textSecondary,
    },
    hint: {
      ...typography.bodyMd,
      fontSize: 12,
      color: colors.textSecondary,
    },
    readout: {
      gap: 6,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    readoutMain: {
      ...typography.headlineMd,
      fontSize: 16,
      color: colors.textPrimary,
    },
    readoutMeta: {
      ...typography.dataSm,
      color: colors.textSecondary,
    },
    bar: {
      height: 3,
      backgroundColor: colors.outlineVariant,
    },
    barFill: {
      height: 3,
      backgroundColor: colors.accent,
    },
    speedRow: {
      flexDirection: 'row',
      gap: 6,
    },
    speedChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radiusNone,
    },
    speedChipSelected: {
      backgroundColor: colors.surfaceContainerHigh,
      borderColor: colors.outline,
    },
    speedText: {
      ...typography.dataSm,
      color: colors.textSecondary,
    },
    speedTextSelected: {
      color: colors.textPrimary,
    },
    actionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    action: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radiusNone,
      backgroundColor: colors.surfaceContainerLow,
    },
    actionPressed: {
      backgroundColor: colors.surfaceContainerHigh,
    },
    actionDisabled: {
      opacity: 0.5,
    },
    actionText: {
      ...typography.bodyMd,
      fontSize: 12,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    actionTextDisabled: {
      color: colors.textSecondary,
    },
    footnote: {
      ...typography.bodyMd,
      fontSize: 11,
      lineHeight: 15,
      color: colors.textSecondary,
    },
  });
}
