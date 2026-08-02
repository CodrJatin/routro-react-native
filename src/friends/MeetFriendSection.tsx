import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { getStation } from '../engine/graph';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens, TypeStyle } from '../theme/tokens';
import { MeetRequestCard } from './MeetRequestCard';
import { cancelMeet, cancelMeetRequest } from './meetController';
import type { AcceptedMeet, OutgoingMeetRequest } from './meetStore';
import { useAgreedMeetView, useMeetWith } from './useMeet';

/**
 * Whatever is going on about meeting this one friend, inside their card on the
 * Friends tab.
 *
 * The Friends tab is where someone goes to look for a person, so a request
 * from them has to be answerable here too -- not only on the map, where it
 * happens to arrive. It is the same card either way.
 *
 * This slot is also what replaced the old "your routes cross at N stops" list.
 * That list answered a question nobody had yet; the crossings are still there
 * to be found by tapping the friend and reading the station card, which is
 * where you are already standing when you want them.
 */
export function MeetFriendSection({ friendUserId }: { friendUserId: string }) {
  const { colors, radius, typography } = useTheme();
  const styles = useMemo(
    () => createStyles(colors, radius, typography),
    [colors, radius, typography],
  );

  const { incoming, outgoing, meet } = useMeetWith(friendUserId);

  // Ordered by who is waiting on whom: a request wanting an answer outranks a
  // report of one already sent, which outranks a meet already settled.
  if (incoming) {
    return (
      <Animated.View
        style={styles.block}
        entering={FadeIn.duration(180)}
        exiting={FadeOut.duration(140)}
        layout={LinearTransition.duration(220)}
      >
        {/* Nameless: their name is already at the top of the card this is
            sitting inside. */}
        <MeetRequestCard request={incoming} showSender={false} />
      </Animated.View>
    );
  }

  if (outgoing) {
    return <OutgoingRow request={outgoing} styles={styles} colors={colors} />;
  }

  if (meet) {
    return <AgreedRow meet={meet} styles={styles} colors={colors} />;
  }

  return null;
}

function OutgoingRow({
  request,
  styles,
  colors,
}: {
  request: OutgoingMeetRequest;
  styles: ReturnType<typeof createStyles>;
  colors: ColorTokens;
}) {
  const stationName = getStation(request.stationId)?.name ?? 'that station';
  const isPending = request.outcome === 'pending';

  const text =
    request.outcome === 'pending'
      ? `Asked to meet at ${stationName}`
      : request.outcome === 'accepted'
        ? `They said yes — ${stationName}`
        : request.outcome === 'declined'
          ? `They can't meet at ${stationName}`
          : request.outcome === 'expired'
            ? `No answer about ${stationName}`
            : `Couldn't reach them about ${stationName}`;

  const tone =
    request.outcome === 'accepted'
      ? colors.success
      : request.outcome === 'pending'
        ? colors.accent
        : colors.textSecondary;

  return (
    <Animated.View
      style={styles.statusRow}
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      layout={LinearTransition.duration(220)}
    >
      <Ionicons
        name={
          request.outcome === 'accepted'
            ? 'checkmark-circle'
            : isPending
              ? 'hourglass-outline'
              : 'close-circle-outline'
        }
        size={13}
        color={tone}
      />
      <Text style={[styles.statusText, { color: tone }]} numberOfLines={2}>
        {text}
      </Text>
      {isPending && (
        <AnimatedPressable
          onPress={() => void cancelMeetRequest(request.toUserId)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Withdraw the meet request"
        >
          <Text style={styles.action}>CANCEL</Text>
        </AnimatedPressable>
      )}
    </Animated.View>
  );
}

function AgreedRow({
  meet,
  styles,
  colors,
}: {
  meet: AcceptedMeet;
  styles: ReturnType<typeof createStyles>;
  colors: ColorTokens;
}) {
  const view = useAgreedMeetView(meet);

  return (
    <Animated.View
      style={styles.agreed}
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      layout={LinearTransition.duration(220)}
    >
      <View style={styles.agreedHeader}>
        <Ionicons name="hand-left" size={12} color={colors.success} />
        <Text style={styles.agreedLabel}>MEETING AT</Text>
      </View>
      <Text style={styles.agreedStation} numberOfLines={1}>
        {view.stationName}
      </Text>
      <Text style={styles.agreedDetail} numberOfLines={2}>
        {view.label}
      </Text>

      {/* A real button, not a word in the corner. Calling this off tells the
          other person too -- it is an action with a consequence at their end,
          and it should look like one. */}
      <AnimatedPressable
        style={styles.callOffButton}
        onPress={() => cancelMeet(meet.friendUserId)}
        accessibilityRole="button"
        accessibilityLabel={`Call off meeting ${view.friendName} at ${view.stationName}`}
      >
        <Ionicons name="close" size={14} color={colors.danger} />
        <Text style={styles.callOffText}>CALL OFF</Text>
      </AnimatedPressable>
    </Animated.View>
  );
}

function createStyles(
  colors: ColorTokens,
  radius: { none: number; badge: number },
  typography: Record<string, TypeStyle>,
) {
  return StyleSheet.create({
    block: {
      marginTop: 4,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 4,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    statusText: {
      ...typography.dataSm,
      fontSize: 11,
      flex: 1,
      minWidth: 0,
    },
    action: {
      ...typography.labelCaps,
      fontSize: 9,
      color: colors.textSecondary,
    },
    agreed: {
      marginTop: 4,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      gap: 2,
    },
    agreedHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    agreedLabel: {
      ...typography.labelCaps,
      fontSize: 9,
      color: colors.success,
    },
    agreedStation: {
      ...typography.bodyMd,
      fontSize: 14,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    agreedDetail: {
      ...typography.dataSm,
      fontSize: 11,
      color: colors.textSecondary,
    },
    // Outlined rather than filled, like the journey bar's stop button: calling
    // off is deliberate, but it isn't what the card is for.
    callOffButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      height: 32,
      marginTop: 4,
      borderWidth: 1,
      borderColor: colors.danger,
      borderRadius: radius.none,
    },
    callOffText: {
      ...typography.labelCaps,
      fontSize: 10,
      color: colors.danger,
    },
  });
}
