import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { isJourneyServiceAvailable } from '../../modules/journey-service';
import type { RouteMode, StationId } from '../engine/types';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens, TypeStyle } from '../theme/tokens';
import { startJourney, stopJourney } from './journeyController';
import { useJourneyStore } from './journeyStore';

const ACTION_HEIGHT = 44;

/**
 * Starts (or stops) background tracking for the route currently on screen.
 *
 * Journeys can only begin on an explicit tap: Android refuses to start a
 * foreground service from the background, and there is no exemption to ask
 * for. That constraint turns out to suit the feature -- a notification that
 * outlives the app and keeps sharing your position is not something to switch
 * on quietly on the user's behalf.
 *
 * Sized to fill its parent's action row, since it sits beside the save button
 * in `RouteSummaryCard` rather than standing alone.
 */
export function StartJourneyButton({
  originId,
  destinationId,
  mode,
  onStarted,
}: {
  originId: StationId;
  destinationId: StationId;
  mode: RouteMode;
  /** Run after a journey actually starts. The route screen sends the user to
   * the map with it -- starting a journey and then wanting to watch it is the
   * same intent, and making that two taps was the old "Go to Map" button's
   * only remaining job. Deliberately not called on stop: ending a journey is
   * not a request to go anywhere. */
  onStarted?: () => void;
}) {
  const { colors, radius, typography } = useTheme();
  const styles = useMemo(
    () => createStyles(colors, radius.none, typography),
    [colors, radius, typography],
  );

  const session = useJourneyStore((state) => state.session);
  const hasSeenIntro = useJourneyStore((state) => state.hasSeenIntro);
  const [isBusy, setIsBusy] = useState(false);

  // Tracking *this* route, as opposed to a different one started earlier.
  const isTrackingThis =
    session?.originId === originId && session?.destinationId === destinationId;
  const isTrackingOther = session !== null && !isTrackingThis;

  if (!isJourneyServiceAvailable) return null;

  async function begin() {
    setIsBusy(true);
    const result = await startJourney(originId, destinationId, mode);
    setIsBusy(false);
    if (!result.ok) {
      Alert.alert("Couldn't start the journey", result.reason);
      return;
    }
    onStarted?.();
  }

  function handleStart() {
    if (hasSeenIntro) {
      void begin();
      return;
    }
    // Shown once. This changes what the app does while the user isn't looking
    // at it, which is exactly the kind of change that should be stated plainly
    // before it happens rather than discovered from a notification later.
    Alert.alert(
      'Start this journey?',
      'MetroSync will show a notification with your progress and tell you when to get off — ' +
        'including while the app is closed and your phone is locked.\n\n' +
        'If you are sharing your location, friends will keep seeing you move for the whole ' +
        'journey.\n\n' +
        'Stop any time from the notification, or by swiping the app away.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Start',
          onPress: () => {
            useJourneyStore.getState().markIntroSeen();
            void begin();
          },
        },
      ],
    );
  }

  async function handleStop() {
    setIsBusy(true);
    await stopJourney();
    setIsBusy(false);
  }

  if (isTrackingThis) {
    return (
      <View style={styles.group}>
        <AnimatedPressable
          style={styles.stopButton}
          onPress={handleStop}
          disabled={isBusy}
          accessibilityRole="button"
          accessibilityLabel="Stop following this journey"
        >
          {isBusy ? (
            <ActivityIndicator size="small" color={colors.textPrimary} />
          ) : (
            <Ionicons name="stop-circle-outline" size={18} color={colors.textPrimary} />
          )}
          <Text style={styles.stopText}>Stop</Text>
        </AnimatedPressable>
      </View>
    );
  }

  return (
    <View style={styles.group}>
      <AnimatedPressable
        style={styles.startButton}
        onPress={handleStart}
        disabled={isBusy}
        accessibilityRole="button"
        accessibilityLabel={isTrackingOther ? 'Switch to this journey' : 'Start this journey'}
      >
        {isBusy ? (
          <ActivityIndicator size="small" color={colors.onPrimary} />
        ) : (
          <Ionicons name="navigate" size={16} color={colors.onPrimary} />
        )}
        <Text style={styles.startText}>{isTrackingOther ? 'Switch journey' : 'Start journey'}</Text>
      </AnimatedPressable>
      {isTrackingOther && (
        <Text style={styles.hint}>
          This will stop the journey you're currently following and start tracking this route
          instead.
        </Text>
      )}
    </View>
  );
}

function createStyles(
  colors: ColorTokens,
  radiusNone: number,
  typography: Record<string, TypeStyle>,
) {
  return StyleSheet.create({
    // Takes the row's free width so the save button beside it stays square.
    group: {
      flex: 1,
      gap: 8,
    },
    startButton: {
      height: ACTION_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.accent,
      borderRadius: radiusNone,
    },
    startText: {
      ...typography.bodyMd,
      fontSize: 14,
      fontWeight: '700',
      color: colors.onPrimary,
    },
    // Outlined and neutral rather than red. Stopping a journey you started is
    // ordinary, reversible housekeeping -- the destructive styling belongs to
    // Sign Out, and spending it here would leave nothing louder for anything
    // that actually warrants it.
    stopButton: {
      height: ACTION_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: radiusNone,
      borderWidth: 1,
      borderColor: colors.outline,
      backgroundColor: colors.surface,
    },
    stopText: {
      ...typography.bodyMd,
      fontSize: 14,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    pressed: {
      opacity: 0.75,
    },
    hint: {
      ...typography.bodyMd,
      fontSize: 12,
      color: colors.textSecondary,
    },
  });
}
