import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { isJourneyServiceAvailable } from '../../modules/journey-service';
import { findRoute, getStation } from '../engine/graph';
import { useSelfPositionStore } from '../location/selfPosition';
import { useActiveRouteStore } from '../route/activeRouteStore';
import { getRouteProgress } from '../route/routeProgress';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens } from '../theme/tokens';
import { useFriendAlertsStore } from './friendAlerts';
import { startJourney, stopJourney } from './journeyController';
import { useJourneyStore } from './journeyStore';

/**
 * Dev-only front end for the journey controller, standing in until M5 builds
 * the real "Start journey" affordance on the route screen.
 *
 * It deliberately drives the *real* controller against the *real* planned
 * route rather than a fixture, so what it proves is what will ship.
 */
export function DevJourneyServicePanel() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const originId = useActiveRouteStore((state) => state.originId);
  const destinationId = useActiveRouteStore((state) => state.destinationId);
  const mode = useActiveRouteStore((state) => state.mode);

  const session = useJourneyStore((state) => state.session);
  const endedNotice = useJourneyStore((state) => state.endedNotice);
  const position = useSelfPositionStore((state) => state.position);

  const friendAlertsEnabled = useFriendAlertsStore((state) => state.isEnabled);
  const setFriendAlertsEnabled = useFriendAlertsStore((state) => state.setEnabled);
  const hydrateFriendAlerts = useFriendAlertsStore((state) => state.hydrate);

  const [isBusy, setIsBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    void hydrateFriendAlerts();
  }, [hydrateFriendAlerts]);

  useEffect(() => {
    if (endedNotice) setLastError(endedNotice);
  }, [endedNotice]);

  const origin = originId ? getStation(originId) : undefined;
  const destination = destinationId ? getStation(destinationId) : undefined;

  // Recomputed here purely to show what the notification is being built from --
  // the controller does its own, from the same store.
  const progress = useMemo(() => {
    if (!session) return null;
    const route = findRoute(session.originId, session.destinationId, session.mode);
    return getRouteProgress(route, position);
  }, [session, position]);

  async function handleStart() {
    if (!originId || !destinationId) return;
    setIsBusy(true);
    setLastError(null);
    useJourneyStore.getState().setEndedNotice(null);
    const result = await startJourney(originId, destinationId, mode);
    setIsBusy(false);
    if (!result.ok) setLastError(result.reason);
  }

  async function handleStop() {
    setIsBusy(true);
    await stopJourney();
    setIsBusy(false);
  }

  if (!isJourneyServiceAvailable) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Journey tracking (dev)</Text>
        <Text style={styles.hint}>Not available on this platform — Android only for now.</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Journey tracking (dev)</Text>
      <Text style={styles.hint}>
        Plan a route on the Route tab, then start it here. Minimise the app and the notification
        should keep following you.
      </Text>

      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Route</Text>
        <Text style={styles.statusValue} numberOfLines={1}>
          {origin && destination ? `${origin.name} → ${destination.name}` : 'None planned'}
        </Text>
      </View>

      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Journey</Text>
        <Text style={styles.statusValue}>{session ? 'Tracking' : 'Not tracking'}</Text>
      </View>

      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Position</Text>
        <Text style={styles.statusValue}>
          {progress
            ? `${progress.sequence[progress.nearestIndex].stationName} (${progress.nearestIndex + 1}/${progress.sequence.length})`
            : position
              ? 'Off route'
              : 'No fix'}
        </Text>
      </View>

      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Friend alerts</Text>
        <Switch value={friendAlertsEnabled} onValueChange={setFriendAlertsEnabled} />
      </View>
      <Text style={styles.hint}>
        Off by default. Alerts when a friend gets within two stops, or arrives somewhere — only
        while a journey is running.
      </Text>

      {lastError && <Text style={styles.error}>{lastError}</Text>}

      <View style={styles.buttonRow}>
        <Pressable
          style={styles.button}
          onPress={handleStart}
          disabled={isBusy || !!session || !originId || !destinationId}
        >
          <Text style={styles.buttonText}>Start journey</Text>
        </Pressable>
        <Pressable style={styles.buttonOutline} onPress={handleStop} disabled={isBusy || !session}>
          <Text style={styles.buttonOutlineText}>Stop</Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(colors: ColorTokens) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      gap: 10,
    },
    title: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '700',
    },
    hint: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
    },
    statusRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
    },
    statusLabel: {
      color: colors.textSecondary,
      fontSize: 13,
    },
    statusValue: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '600',
      flexShrink: 1,
    },
    error: {
      color: colors.danger,
      fontSize: 12,
      lineHeight: 17,
    },
    buttonRow: {
      flexDirection: 'row',
      gap: 10,
    },
    button: {
      flex: 1,
      backgroundColor: colors.primary,
      paddingVertical: 10,
      alignItems: 'center',
    },
    buttonText: {
      color: colors.onPrimary,
      fontSize: 13,
      fontWeight: '600',
    },
    buttonOutline: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 10,
      alignItems: 'center',
    },
    buttonOutlineText: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '600',
    },
  });
}
