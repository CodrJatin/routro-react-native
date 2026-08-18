import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { showDialog } from '../dialog/dialogStore';
import { MEET_REQUEST_TTL_MS } from '../realtime/meetMessage';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens, TypeStyle } from '../theme/tokens';
import { friendColorFor } from './friendColor';
import { acceptMeetRequest, declineMeetRequest } from './meetController';
import { formatClockTime, formatDelay, formatMinutes } from './meetFormat';
import type { IncomingMeetRequest } from './meetStore';
import { NEGLIGIBLE_WAIT_MS } from './meetTiming';
import { useIncomingMeetRequests, useMeetRequestView } from './useMeet';

/**
 * Every request currently waiting on an answer, soonest to expire first.
 *
 * For the map, where requests arrive unannounced and there may be two of them
 * -- nothing stops two friends asking at once, and silently showing only one
 * would leave the other to expire unseen.
 */
export function MeetRequestStack() {
  const requests = useIncomingMeetRequests();
  if (requests.length === 0) return null;
  return (
    <>
      {requests.map((request) => (
        <MeetRequestCard key={request.id} request={request} />
      ))}
    </>
  );
}

/**
 * A friend asking to meet, with the clock running.
 *
 * The card answers the only question worth answering in thirty seconds: what
 * does saying yes cost me. So the biggest number on it is not when *they* get
 * to the station -- it is when the user themselves would now reach their own
 * destination, and how much later that is than not meeting at all.
 *
 * The rule behind that number: whoever arrives at the station later decides
 * when the two of them can leave it, so the wait is the gap between the two
 * arrivals, and everything after the station simply happens that much later.
 *
 * Rendered both over the map and inside the friend's card on the Friends tab
 * -- one component, because a request that looked like two different things in
 * two places would read as two different requests.
 */
export function MeetRequestCard({
  request,
  showSender = true,
}: {
  request: IncomingMeetRequest;
  /** False inside that friend's own card on the Friends tab, where their name
   * is already at the top of the thing this is sitting in. Their name comes
   * out of the body text too -- "They arrive 10:41" reads better than repeating
   * it three times under their own heading. */
  showSender?: boolean;
}) {
  const { colors, radius, typography } = useTheme();
  const styles = useMemo(
    () => createStyles(colors, radius, typography),
    [colors, radius, typography],
  );

  const view = useMeetRequestView(request);
  const [isAnswering, setIsAnswering] = useState(false);

  // The expiry bar. Driven straight off the remaining time rather than a JS
  // interval: it is a linear sweep with a known end, which is exactly what the
  // UI thread can run on its own -- and a per-second setState here would
  // re-render this card, and the map behind it, thirty times per request.
  const remaining = useSharedValue(1);
  useEffect(() => {
    const left = Math.max(0, request.expiresAt - Date.now());
    remaining.value = left / MEET_REQUEST_TTL_MS;
    remaining.value = withTiming(0, { duration: left, easing: Easing.linear });
  }, [request.expiresAt, remaining]);

  const barStyle = useAnimatedStyle(() => ({ width: `${Math.max(0, remaining.value) * 100}%` }));

  async function handleAccept() {
    if (isAnswering) return;
    setIsAnswering(true);
    const result = await acceptMeetRequest(request.id);
    setIsAnswering(false);
    if (!result.ok) {
      void showDialog({ title: "Couldn't accept", message: result.reason, tone: 'danger' });
    }
  }

  async function handleDecline() {
    if (isAnswering) return;
    setIsAnswering(true);
    await declineMeetRequest(request.id);
    // No spinner reset: declining removes the request, which unmounts this.
  }

  const { timing } = view;
  // Who they are is either in the header above or in the card this is sitting
  // inside; either way the body doesn't need to keep saying it.
  const them = showSender ? view.friendName : 'They';
  const themLower = showSender ? view.friendName : 'they';
  const waitLine = describeWait(themLower, timing.myWaitMs, timing.theirWaitMs);

  return (
    <Animated.View
      style={styles.card}
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(160)}
      layout={LinearTransition.duration(220)}
    >
      {showSender ? (
        <View style={styles.header}>
          <View style={[styles.dot, { backgroundColor: friendColorFor(request.fromUserId) }]} />
          <Text style={styles.headerText} numberOfLines={1}>
            <Text style={styles.headerName}>{view.friendName}</Text> wants to meet
          </Text>
        </View>
      ) : (
        <Text style={styles.headerBare}>WANTS TO MEET AT</Text>
      )}

      <Text style={styles.station} numberOfLines={2}>
        {view.stationName}
      </Text>

      <View style={styles.lines}>
        <DetailLine
          styles={styles}
          colors={colors}
          icon="walk"
          text={
            timing.theirArrivalMs === null
              ? `We can't tell when ${themLower === 'they' ? 'they' : themLower} get${
                  showSender ? 's' : ''
                } there`
              : `${them} arrive${showSender ? 's' : ''} ${formatClockTime(timing.theirArrivalMs)}${
                  view.arrivalSource === 'quoted' ? ' (their estimate)' : ''
                }${view.senderDestinationName ? ` · heading to ${view.senderDestinationName}` : ''}`
          }
        />

        {timing.myArrivalMs !== null ? (
          <DetailLine
            styles={styles}
            colors={colors}
            icon="time-outline"
            text={`You arrive ${formatClockTime(timing.myArrivalMs)}${waitLine ? ` · ${waitLine}` : ''}`}
          />
        ) : (
          <DetailLine
            styles={styles}
            colors={colors}
            icon="information-circle-outline"
            // Accepting is still meaningful without a route -- it tells them
            // you are coming. It just cannot be costed.
            text="That station isn't on a route of yours, so there's nothing to delay"
          />
        )}
      </View>

      {/* The decision, given the weight it deserves: not when they arrive, but
          when you would. */}
      {timing.destinationMs !== null && view.myDestinationName && (
        <View style={styles.outcome}>
          <Text style={styles.outcomeLabel} numberOfLines={1}>
            {timing.isAtMyDestination
              ? `YOU'D STILL REACH ${view.myDestinationName.toUpperCase()}`
              : `YOU'D REACH ${view.myDestinationName.toUpperCase()}`}
          </Text>
          <View style={styles.outcomeRow}>
            <Text style={styles.outcomeTime}>{formatClockTime(timing.destinationMs)}</Text>
            {formatDelay(timing.delayMs) && (
              <Text style={styles.outcomeDelay}>{formatDelay(timing.delayMs)}</Text>
            )}
          </View>
        </View>
      )}

      <View style={styles.actions}>
        <AnimatedPressable
          style={styles.declineButton}
          onPress={handleDecline}
          disabled={isAnswering}
          accessibilityRole="button"
          accessibilityLabel={`Decline meeting ${view.friendName} at ${view.stationName}`}
        >
          <Text style={styles.declineText}>NOT NOW</Text>
        </AnimatedPressable>
        <AnimatedPressable
          style={styles.acceptButton}
          onPress={handleAccept}
          disabled={isAnswering}
          accessibilityRole="button"
          accessibilityLabel={`Accept meeting ${view.friendName} at ${view.stationName}`}
        >
          {isAnswering ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <>
              <Ionicons name="checkmark" size={14} color={colors.onPrimary} />
              <Text style={styles.acceptText}>MEET THEM</Text>
            </>
          )}
        </AnimatedPressable>
      </View>

      {/* The countdown, along the bottom edge of the card. Full width at
          thirty seconds, gone at zero. */}
      <View style={styles.timerTrack}>
        <Animated.View style={[styles.timerFill, barStyle]} />
      </View>
    </Animated.View>
  );
}

function DetailLine({
  styles,
  colors,
  icon,
  text,
}: {
  styles: ReturnType<typeof createStyles>;
  colors: ColorTokens;
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View style={styles.line}>
      <Ionicons name={icon} size={12} color={colors.textSecondary} />
      <Text style={styles.lineText} numberOfLines={2}>
        {text}
      </Text>
    </View>
  );
}

/** Who ends up standing on the platform, and for how long. Silent when the
 * two arrivals are close enough that saying so would be inventing precision. */
function describeWait(
  them: string,
  myWaitMs: number | null,
  theirWaitMs: number | null,
): string | null {
  if (myWaitMs === null) return null;
  if (myWaitMs >= NEGLIGIBLE_WAIT_MS) return `you wait ${formatMinutes(myWaitMs)}`;
  if ((theirWaitMs ?? 0) >= NEGLIGIBLE_WAIT_MS) {
    return `${them} wait${them === 'they' ? '' : 's'} ${formatMinutes(theirWaitMs ?? 0)}`;
  }
  return 'you arrive together';
}

function createStyles(
  colors: ColorTokens,
  radius: { none: number; badge: number },
  typography: Record<string, TypeStyle>,
) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.accent,
      borderRadius: radius.none,
      // Clips the countdown to the card's edges, the same way the journey bar
      // clips its progress rail.
      overflow: 'hidden',
      paddingTop: 10,
      gap: 8,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingHorizontal: 12,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      flexShrink: 0,
    },
    headerText: {
      ...typography.bodyMd,
      fontSize: 12,
      color: colors.textSecondary,
      flex: 1,
      minWidth: 0,
    },
    headerName: {
      color: colors.textPrimary,
      fontWeight: '700',
    },
    /** The nameless version, for when this sits inside that friend's own card. */
    headerBare: {
      ...typography.labelCaps,
      fontSize: 9,
      color: colors.accent,
      paddingHorizontal: 12,
    },
    station: {
      ...typography.headlineMd,
      fontSize: 18,
      lineHeight: 22,
      color: colors.textPrimary,
      paddingHorizontal: 12,
    },
    lines: {
      gap: 4,
      paddingHorizontal: 12,
    },
    line: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
    },
    lineText: {
      ...typography.dataSm,
      fontSize: 11,
      color: colors.textSecondary,
      flex: 1,
      minWidth: 0,
    },
    outcome: {
      marginHorizontal: 12,
      paddingHorizontal: 10,
      paddingVertical: 7,
      backgroundColor: colors.surfaceContainerHigh,
      borderRadius: radius.none,
      gap: 1,
    },
    outcomeLabel: {
      ...typography.labelCaps,
      fontSize: 9,
      color: colors.textSecondary,
    },
    outcomeRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 8,
    },
    outcomeTime: {
      ...typography.dataLg,
      fontSize: 18,
      color: colors.textPrimary,
    },
    outcomeDelay: {
      ...typography.labelCaps,
      fontSize: 10,
      color: colors.accent,
    },
    actions: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 12,
      paddingBottom: 10,
    },
    declineButton: {
      flex: 1,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.none,
    },
    declineText: {
      ...typography.labelCaps,
      fontSize: 10,
      color: colors.textSecondary,
    },
    acceptButton: {
      flex: 1.4,
      height: 36,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.accent,
      borderRadius: radius.none,
    },
    acceptText: {
      ...typography.labelCaps,
      fontSize: 10,
      color: colors.onPrimary,
    },
    timerTrack: {
      height: 3,
      backgroundColor: colors.surfaceContainerHigh,
    },
    timerFill: {
      height: 3,
      backgroundColor: colors.accent,
    },
  });
}
