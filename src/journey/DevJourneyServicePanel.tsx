import { useEffect, useMemo, useRef, useState } from 'react';
import { PermissionsAndroid, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  addJourneyServiceActionListener,
  addJourneyServiceTickListener,
  isJourneyServiceAvailable,
  isJourneyServiceRunning,
  startJourneyService,
  stopJourneyService,
  updateJourneyService,
  type JourneyServiceAction,
} from '../../modules/journey-service';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens } from '../theme/tokens';

/** How often the fake journey advances a station. Short on purpose: the point
 * is to lock the phone and watch the notification change without waiting.
 *
 * Driven by the service's native tick, NOT `setInterval`. React Native removes
 * the Choreographer frame callback its timers run on as soon as the app is
 * backgrounded, so a `setInterval` here froze the moment the app was minimised
 * -- which is exactly what this panel exists to catch. */
const TICK_MS = 5000;

/** Stand-ins for a real route, so the notification reads like the real thing
 * rather than like a counter. Replaced in M2 by `notificationContent.ts`. */
const FAKE_STATIONS = [
  'Rajiv Chowk',
  'Patel Chowk',
  'Central Secretariat',
  'Udyog Bhawan',
  'Lok Kalyan Marg',
  'Jor Bagh',
  'INA',
  'AIIMS',
  'Green Park',
  'Hauz Khas',
];

const YELLOW_LINE = '#F0C808';

/**
 * Dev-only proof that the foreground service does the one thing it exists for:
 * update its notification while the app is backgrounded and the screen is off.
 *
 * Start it, lock the phone, and the notification should keep advancing a
 * station every 5 seconds. If it freezes the moment the screen goes off, the
 * whole background plan needs rethinking -- so this panel earns its keep until
 * M2 replaces it with the real journey controller.
 */
export function DevJourneyServicePanel() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [isRunning, setIsRunning] = useState(() => isJourneyServiceRunning());
  const [stationIndex, setStationIndex] = useState(0);
  const [tickCount, setTickCount] = useState(0);
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<JourneyServiceAction | null>(null);

  // Read by the tick listener, which is mounted once and would otherwise close
  // over the first render's index forever.
  const stationIndexRef = useRef(0);

  // Stop / swipe-away happen outside JS, so the panel has to be told rather
  // than assume its own state is still true.
  useEffect(() => {
    const subscription = addJourneyServiceActionListener(({ action }) => {
      setLastAction(action);
      setIsRunning(false);
    });
    return () => subscription.remove();
  }, []);

  // The whole point of the panel. Ticks arrive from the service's Looper, so
  // they keep coming while the app is backgrounded -- come back to the app
  // after a few minutes and the count should have kept climbing.
  useEffect(() => {
    const subscription = addJourneyServiceTickListener(async ({ at }) => {
      setTickCount((count) => count + 1);
      setLastTickAt(at);

      const next = (stationIndexRef.current + 1) % FAKE_STATIONS.length;
      stationIndexRef.current = next;
      setStationIndex(next);

      // False means the service went away underneath us -- stop pretending.
      if (!(await updateJourneyService(contentFor(next)))) {
        setIsRunning(false);
      }
    });
    return () => subscription.remove();
  }, []);

  async function handleStart() {
    setLastError(null);
    setLastAction(null);
    setTickCount(0);
    setLastTickAt(null);
    stationIndexRef.current = 0;
    setStationIndex(0);

    // Android 13+ hides the notification without this. The service still runs,
    // which is a confusing way to fail. Moves into the journey controller in M2.
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }

    try {
      await startJourneyService(contentFor(0), { tickIntervalMs: TICK_MS });
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error));
      return;
    }

    setIsRunning(true);
  }

  async function handleStop() {
    await stopJourneyService();
    setIsRunning(false);
  }

  if (!isJourneyServiceAvailable) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Journey service (dev)</Text>
        <Text style={styles.hint}>Not available on this platform — Android only for now.</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Journey service (dev)</Text>
      <Text style={styles.hint}>
        Start it, then minimise the app and lock the phone. The notification should advance a
        station every 5s. Come back and the tick count should have kept climbing the whole time —
        if it stalled, background tracking will not work.
      </Text>

      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Status</Text>
        <Text style={styles.statusValue}>
          {isRunning ? `Running · ${FAKE_STATIONS[stationIndex]}` : 'Stopped'}
        </Text>
      </View>

      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Ticks</Text>
        <Text style={styles.statusValue}>
          {tickCount}
          {lastTickAt !== null ? ` · last ${clockOf(lastTickAt)}` : ''}
        </Text>
      </View>

      {lastAction && (
        <Text style={styles.hint}>
          Ended from outside the app: {lastAction === 'stop' ? 'Stop button' : 'swiped away'}.
        </Text>
      )}
      {lastError && <Text style={styles.error}>{lastError}</Text>}

      <View style={styles.buttonRow}>
        <Pressable style={styles.button} onPress={handleStart} disabled={isRunning}>
          <Text style={styles.buttonText}>Start</Text>
        </Pressable>
        <Pressable style={styles.buttonOutline} onPress={handleStop} disabled={!isRunning}>
          <Text style={styles.buttonOutlineText}>Stop</Text>
        </Pressable>
      </View>
    </View>
  );
}

function contentFor(index: number) {
  const remaining = FAKE_STATIONS.length - 1 - index;
  const destination = FAKE_STATIONS[FAKE_STATIONS.length - 1];
  return {
    title: remaining === 0 ? `Arrived at ${destination}` : `${destination} · ${arrivalClock(remaining)}`,
    body:
      remaining === 0
        ? 'Journey complete'
        : `${remaining} ${remaining === 1 ? 'stop' : 'stops'} · next ${FAKE_STATIONS[index + 1]}`,
    progress: { current: index, max: FAKE_STATIONS.length - 1 },
    color: YELLOW_LINE,
    showStopAction: true,
  };
}

/** Two minutes a stop, formatted like the real itinerary does. */
function arrivalClock(remainingStops: number): string {
  return clockOf(Date.now() + remainingStops * 2 * 60_000).slice(0, 5);
}

/** Seconds included: the point is to see that ticks kept arriving while the
 * app was away, which minute resolution would hide. */
function clockOf(ms: number): string {
  const at = new Date(ms);
  return [at.getHours(), at.getMinutes(), at.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
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
    },
    statusLabel: {
      color: colors.textSecondary,
      fontSize: 13,
    },
    statusValue: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '600',
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
