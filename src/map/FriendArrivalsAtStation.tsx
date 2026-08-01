import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import type { StationId } from '../engine/types';
import { friendColorFor } from '../friends/friendColor';
import { useFriendJourneys } from '../friends/friendJourney';
import { useLocationStore } from '../realtime/locationStore';
import { formatStationArrival, routeClockMs } from '../route/routeClock';
import { buildStationMarks, type RouteStationMark } from '../route/routeProgress';
import { findStationOnRoute } from '../route/stationOnRoute';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens } from '../theme/tokens';

/** Ordering groups, ahead of any comparison of the times themselves. A friend
 * standing here now outranks any predicted arrival; a friend we cannot place
 * on their route contributes no time, so they sit below everyone we can
 * actually schedule; and anyone already through drops to the bottom. */
const RANK_CURRENT = 0;
const RANK_UPCOMING = 1;
const RANK_UNKNOWN = 2;
const RANK_PASSED = 3;

function rankFor(mark: RouteStationMark | undefined, arrivalMs: number | null): number {
  if (mark === 'passed') return RANK_PASSED;
  if (mark === 'current') return RANK_CURRENT;
  return arrivalMs === null ? RANK_UNKNOWN : RANK_UPCOMING;
}

/**
 * When each friend travelling through this station gets here.
 *
 * A separate self-subscribing component rather than props from the map screen,
 * and deliberately so: this reads `friendLocations`, which changes every few
 * seconds per broadcasting friend. Lifting that subscription into MapScreen
 * would re-render the whole map tree on every friend's every fix -- the exact
 * cost FriendsLayer was split out to avoid.
 *
 * Times come from each friend's own clock (see `FriendJourneyView.clock`), so a
 * friend whose last fix is stale reads late here rather than being quietly
 * brought up to date. Friends we can't place on their route contribute no time
 * at all, only the fact that they pass through.
 */
export function FriendArrivalsAtStation({ stationId }: { stationId: StationId }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const friendJourneys = useFriendJourneys();
  const friendNames = useLocationStore((state) => state.friendNames);

  const arrivals = useMemo(() => {
    const result: {
      userId: string;
      name: string;
      arrival: string | null;
      rank: number;
      arrivalMs: number | null;
    }[] = [];

    for (const [userId, view] of Object.entries(friendJourneys)) {
      const onRoute = findStationOnRoute(view.route, stationId);
      if (!onRoute) continue;

      // The same mark the user's own route uses, so a station a friend has
      // already gone through says 'Passed' here exactly as it would there.
      const mark = view.progress ? buildStationMarks(view.progress).get(stationId) : undefined;
      const arrivalMs = view.clock ? routeClockMs(view.clock, onRoute.offsetSeconds) : null;

      result.push({
        userId,
        name: friendNames[userId] ?? 'A friend',
        arrival: view.clock
          ? formatStationArrival(view.clock, onRoute.offsetSeconds, mark)
          : null,
        rank: rankFor(mark, arrivalMs),
        arrivalMs,
      });
    }

    // Soonest first, because the question this block answers is "who is about
    // to be here". Someone standing here now leads; anyone already through
    // sinks to the bottom, where they read as history rather than as a plan.
    return result.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;

      if (a.arrivalMs !== null && b.arrivalMs !== null && a.arrivalMs !== b.arrivalMs) {
        // Within the passed group the order flips: the friend who went
        // through a minute ago is worth more than the one who went through
        // half an hour ago.
        return a.rank === RANK_PASSED ? b.arrivalMs - a.arrivalMs : a.arrivalMs - b.arrivalMs;
      }

      // Same rank and same (or no) time -- name only as a tiebreak, so the
      // list order is at least stable between renders.
      return a.name.localeCompare(b.name);
    });
  }, [friendJourneys, friendNames, stationId]);

  if (arrivals.length === 0) return null;

  return (
    <Animated.View
      style={styles.block}
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(120)}
      layout={LinearTransition.duration(220)}
    >
      <Text style={styles.label}>FRIENDS PASSING THROUGH</Text>
      {arrivals.map(({ userId, name, arrival }) => (
        <View key={userId} style={styles.row}>
          <View style={[styles.dot, { backgroundColor: friendColorFor(userId) }]} />
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.arrival}>{arrival ?? '—'}</Text>
        </View>
      ))}
    </Animated.View>
  );
}

function createStyles(colors: ColorTokens) {
  return StyleSheet.create({
    block: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 10,
      gap: 6,
    },
    label: {
      fontFamily: 'SpaceMono_700Bold',
      fontSize: 11,
      lineHeight: 14,
      letterSpacing: 1,
      color: colors.textSecondary,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    dot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      flexShrink: 0,
    },
    name: {
      flex: 1,
      minWidth: 0,
      fontFamily: 'Outfit_400Regular',
      fontSize: 13,
      lineHeight: 18,
      color: colors.textPrimary,
    },
    arrival: {
      fontFamily: 'SpaceMono_700Bold',
      fontSize: 13,
      lineHeight: 18,
      color: colors.textPrimary,
      flexShrink: 0,
    },
  });
}
