import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { AnimatedPressable } from '../components/AnimatedPressable';
// MOCK FRIEND -- temporary dev fixture, delete with src/dev/mockFriend.ts
import { isMockFriendId } from '../dev/mockFriend';
import { confirmDialog, showDialog } from '../dialog/dialogStore';
import { getStation } from '../engine/graph';
import type { StationId } from '../engine/types';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens, TypeStyle } from '../theme/tokens';
import { sendMeetRequest } from './meetController';
import { meetCooldownRemainingMs, useMeetStore } from './meetStore';

/**
 * "Meet" beside a friend's arrival time on the station card.
 *
 * Offered only where it makes sense: on a friend who is still coming to this
 * station (or standing at it), and only when there is a channel to reach them
 * on. A friend who has already gone through gets no button, because there is
 * nothing left to agree to.
 *
 * The confirmation step is deliberate. This buzzes someone else's phone and
 * starts a thirty-second clock on them, and it sits one thumb-width from an
 * arrival time people tap at while a train is moving.
 */
export function MeetButton({
  friendUserId,
  friendName,
  stationId,
}: {
  friendUserId: string;
  friendName: string;
  stationId: StationId;
}) {
  const { colors, radius, typography } = useTheme();
  const styles = useMemo(
    () => createStyles(colors, radius, typography),
    [colors, radius, typography],
  );

  const outgoing = useMeetStore((state) => state.outgoing[friendUserId] ?? null);
  const meet = useMeetStore((state) => state.meets[friendUserId] ?? null);
  const lastRequestAt = useMeetStore((state) => state.lastRequestAt[friendUserId]);
  // Subscribed rather than asked, so a channel that joins (or fails) after
  // this first rendered actually reaches the screen.
  const canReach = useMeetStore((state) => Boolean(state.reachable[friendUserId]));

  const [isSending, setIsSending] = useState(false);
  const [cooldownMs, setCooldownMs] = useState(() => meetCooldownRemainingMs(friendUserId));

  // A local tick, and only while the cooldown is actually running. The store's
  // own sweep deliberately doesn't publish a per-second value -- that would
  // re-render every screen reading it once a second, to animate one number on
  // one button.
  useEffect(() => {
    setCooldownMs(meetCooldownRemainingMs(friendUserId));
    const id = setInterval(() => {
      const remaining = meetCooldownRemainingMs(friendUserId);
      setCooldownMs(remaining);
      if (remaining <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [friendUserId, lastRequestAt]);

  // Nothing to send on. Rather than a button that fails on tap, say nothing --
  // this is the state a friend who was just unfriended, or one the channel
  // couldn't be opened for, sits in.
  // MOCK FRIEND -- the fixture has no channel and never will; delete the second
  // half of this with src/dev/mockFriend.ts.
  if (!canReach && !isMockFriendId(friendUserId)) return null;

  if (meet && meet.stationId === stationId) {
    return (
      <View style={styles.settled}>
        <Ionicons name="checkmark-circle" size={12} color={colors.success} />
        <Text style={styles.settledText}>MEETING</Text>
      </View>
    );
  }

  const isPending = outgoing?.outcome === 'pending' && outgoing.stationId === stationId;
  const isCoolingDown = cooldownMs > 0;

  async function handlePress() {
    const stationName = getStation(stationId)?.name ?? 'this station';
    const confirmed = await confirmDialog({
      title: 'Ask to meet?',
      message: `Ask ${friendName} to meet at ${stationName}. They get 30 seconds to answer.`,
      confirmText: 'Ask',
      cancelText: 'Cancel',
    });
    if (confirmed) await send();
  }

  /** Success needs no alert of its own: the button switches to ASKED the
   * moment the request is out, and the answer arrives as a notification. */
  async function send() {
    setIsSending(true);
    const result = await sendMeetRequest(friendUserId, stationId);
    setIsSending(false);
    if (!result.ok) {
      void showDialog({
        title: `Couldn't ask ${friendName}`,
        message: result.reason,
        tone: 'danger',
      });
    }
  }

  return (
    <AnimatedPressable
      style={[styles.button, (isPending || isCoolingDown) && styles.buttonQuiet]}
      onPress={() => void handlePress()}
      disabled={isSending || isPending || isCoolingDown}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`Ask ${friendName} to meet here`}
    >
      {isSending ? (
        <ActivityIndicator size="small" color={colors.accent} />
      ) : isPending ? (
        <Text style={styles.quietText}>ASKED</Text>
      ) : isCoolingDown ? (
        <Text style={styles.quietText}>{Math.ceil(cooldownMs / 1000)}s</Text>
      ) : (
        <>
          <Ionicons name="hand-left-outline" size={12} color={colors.accent} />
          <Text style={styles.buttonText}>MEET</Text>
        </>
      )}
    </AnimatedPressable>
  );
}

function createStyles(
  colors: ColorTokens,
  radius: { none: number; badge: number },
  typography: Record<string, TypeStyle>,
) {
  return StyleSheet.create({
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      minWidth: 58,
      height: 24,
      paddingHorizontal: 8,
      borderWidth: 1,
      borderColor: colors.accent,
      borderRadius: radius.none,
      flexShrink: 0,
    },
    /** ASKED and the cooldown count are states, not offers -- faded, with the
     * hairline knocked back, so they read as switched off rather than as a
     * button that will refuse the tap. Matches the Friends tab's version. */
    buttonQuiet: {
      opacity: 0.45,
      borderColor: colors.outlineVariant,
    },
    buttonText: {
      ...typography.labelCaps,
      fontSize: 9,
      color: colors.accent,
    },
    quietText: {
      ...typography.labelCaps,
      fontSize: 9,
      color: colors.textSecondary,
    },
    settled: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      minWidth: 58,
      height: 24,
      paddingHorizontal: 8,
      justifyContent: 'center',
      flexShrink: 0,
    },
    settledText: {
      ...typography.labelCaps,
      fontSize: 9,
      color: colors.success,
    },
  });
}
