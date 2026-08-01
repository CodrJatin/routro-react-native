import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { AnimatedPressable } from '../components/AnimatedPressable';
import type { SelfRouteView } from '../route/useSelfRoute';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens, TypeStyle } from '../theme/tokens';
import type { FriendJourneyView } from './friendJourney';
import { findMeetingStations, type MeetingStation } from './meetingStations';

/** How many crossings to list before collapsing the rest behind a count. Two
 * routes that share a long stretch can cross at a dozen stations, and a list
 * that long inside a friend card stops being a list and becomes the screen. */
const VISIBLE_LIMIT = 4;

/** Below this the two arrivals are close enough that saying who waits is
 * noise -- a minute of quoted difference on a metro is inside the error bars
 * of the estimate itself. */
const NEGLIGIBLE_WAIT_MS = 90_000;

function formatTime(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatWait(option: MeetingStation, friendName: string): string | null {
  if (option.waitMs === null) return null;
  if (option.whoWaits === null || option.waitMs < NEGLIGIBLE_WAIT_MS) {
    return 'you arrive together';
  }
  const minutes = Math.round(option.waitMs / 60_000);
  return option.whoWaits === 'self'
    ? `you wait ${minutes} min`
    : `${friendName} waits ${minutes} min`;
}

/**
 * Stations where the viewer's journey and a friend's still cross, offered as
 * places the two could meet.
 *
 * Every crossing is listed rather than a single suggested one. Which is best
 * depends on things the app has no access to -- who has time to spare, where
 * they actually want to end up -- so this presents the facts (how far each
 * person is, when each arrives, who ends up waiting) and leaves the choice
 * where it belongs.
 *
 * Renders nothing at all unless both people are on a journey and those
 * journeys genuinely cross, which keeps it out of the way in the ordinary case
 * where it has nothing to say.
 */
export function FriendMeetUp({
  friendJourney,
  selfRoute,
  friendName,
}: {
  friendJourney: FriendJourneyView;
  selfRoute: SelfRouteView | null;
  friendName: string;
}) {
  const { colors, radius, typography } = useTheme();
  const styles = useMemo(
    () => createStyles(colors, radius.none, radius.badge, typography),
    [colors, radius, typography],
  );
  const [isExpanded, setIsExpanded] = useState(false);

  const options = useMemo(() => {
    if (!selfRoute) return [];
    return findMeetingStations(
      { route: selfRoute.route, progress: selfRoute.progress, clock: selfRoute.clock },
      { route: friendJourney.route, progress: friendJourney.progress, clock: friendJourney.clock },
    );
  }, [selfRoute, friendJourney]);

  if (options.length === 0) return null;

  const shown = isExpanded ? options : options.slice(0, VISIBLE_LIMIT);
  const hidden = options.length - shown.length;

  return (
    <Animated.View
      style={styles.block}
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      layout={LinearTransition.duration(220)}
    >
      <View style={styles.header}>
        <Ionicons name="git-merge-outline" size={12} color={colors.accent} />
        <Text style={styles.headerText}>
          {options.length === 1 ? 'YOUR ROUTES CROSS AT' : `YOUR ROUTES CROSS AT ${options.length} STOPS`}
        </Text>
      </View>

      {shown.map((option) => {
        const wait = formatWait(option, friendName);
        return (
          <Animated.View
            key={option.stationId}
            style={styles.option}
            entering={FadeIn.duration(160)}
            exiting={FadeOut.duration(120)}
            layout={LinearTransition.duration(200)}
          >
            <Text style={styles.stationName} numberOfLines={1}>
              {option.stationName}
            </Text>
            <Text style={styles.detail} numberOfLines={2}>
              {/* Stops first: it is the part that stays true even when neither
                  clock is live, and the part someone acts on. */}
              {option.selfStopsAway === 0
                ? "you're there"
                : `${option.selfStopsAway} ${option.selfStopsAway === 1 ? 'stop' : 'stops'} for you`}
              {' · '}
              {option.friendStopsAway === 0
                ? `${friendName} is there`
                : `${option.friendStopsAway} for ${friendName}`}
              {option.selfArrivalMs !== null && option.friendArrivalMs !== null && (
                <Text style={styles.times}>
                  {`\n${formatTime(option.selfArrivalMs)} vs ${formatTime(option.friendArrivalMs)}`}
                  {wait ? ` · ${wait}` : ''}
                </Text>
              )}
            </Text>
          </Animated.View>
        );
      })}

      {(hidden > 0 || isExpanded) && (
        <AnimatedPressable
          style={styles.moreButton}
          onPress={() => setIsExpanded((value) => !value)}
          accessibilityRole="button"
          accessibilityLabel={isExpanded ? 'Show fewer meeting points' : `Show ${hidden} more meeting points`}
        >
          <Text style={styles.moreText}>{isExpanded ? 'SHOW FEWER' : `${hidden} MORE`}</Text>
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={12}
            color={colors.accent}
          />
        </AnimatedPressable>
      )}
    </Animated.View>
  );
}

function createStyles(
  colors: ColorTokens,
  radiusNone: number,
  radiusBadge: number,
  typography: Record<string, TypeStyle>,
) {
  return StyleSheet.create({
    block: {
      marginTop: 4,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      gap: 6,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    headerText: {
      ...typography.labelCaps,
      fontSize: 9,
      color: colors.accent,
      flexShrink: 1,
    },
    option: {
      borderRadius: radiusNone,
      backgroundColor: colors.surfaceContainerHigh,
      paddingHorizontal: 8,
      paddingVertical: 6,
      gap: 1,
    },
    stationName: {
      ...typography.bodyMd,
      fontSize: 13,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    detail: {
      ...typography.dataSm,
      fontSize: 11,
      color: colors.textSecondary,
    },
    times: {
      ...typography.dataSm,
      fontSize: 11,
      color: colors.textSecondary,
    },
    moreButton: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 4,
      paddingVertical: 3,
      borderRadius: radiusBadge,
    },
    moreText: {
      ...typography.labelCaps,
      fontSize: 9,
      color: colors.accent,
    },
  });
}
