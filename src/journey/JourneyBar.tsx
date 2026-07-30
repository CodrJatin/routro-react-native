import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { findRoute } from '../engine/graph';
import { useSelfPositionStore } from '../location/selfPosition';
import { getRouteProgress } from '../route/routeProgress';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens } from '../theme/tokens';
import { stopJourney } from './journeyController';
import { useJourneyStore } from './journeyStore';

/**
 * Shown on the map whenever a journey is being followed.
 *
 * The ongoing notification is the primary surface for a tracked journey -- it
 * is what the user sees with the phone in their hand. This exists so that
 * opening the app doesn't hide the fact that tracking is on, and so stopping
 * it never requires going and finding the route that started it.
 */
export function JourneyBar() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const session = useJourneyStore((state) => state.session);
  const position = useSelfPositionStore((state) => state.position);

  const progress = useMemo(() => {
    if (!session) return null;
    const route = findRoute(session.originId, session.destinationId, session.mode);
    return getRouteProgress(route, position);
  }, [session, position]);

  if (!session) return null;

  const remaining = progress ? progress.sequence.length - 1 - progress.nearestIndex : null;
  const destinationName = progress?.sequence[progress.sequence.length - 1].stationName;

  return (
    <View style={styles.bar}>
      <Ionicons name="navigate" size={14} color={colors.success} />
      <Text style={styles.text} numberOfLines={1}>
        {remaining === null
          ? 'Following your journey'
          : remaining === 0
            ? `Arrived at ${destinationName}`
            : `${remaining} ${remaining === 1 ? 'stop' : 'stops'} to ${destinationName}`}
      </Text>
      <Pressable
        onPress={() => void stopJourney()}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Stop following this journey"
      >
        <Text style={styles.stop}>Stop</Text>
      </Pressable>
    </View>
  );
}

function createStyles(colors: ColorTokens) {
  return StyleSheet.create({
    bar: {
      position: 'absolute',
      top: 12,
      left: 16,
      right: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
      zIndex: 4,
    },
    text: {
      flex: 1,
      fontSize: 12,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    stop: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.danger,
    },
  });
}
