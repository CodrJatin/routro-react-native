import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { AnimatedPressable } from '../components/AnimatedPressable';
// MOCK FRIEND -- temporary dev fixture, delete with src/dev/mockFriend.ts
import { isMockFriendId } from '../dev/mockFriend';
import type { SelfRouteView } from '../route/useSelfRoute';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens, TypeStyle } from '../theme/tokens';
import type { FriendJourneyView } from './friendJourney';
import { buildMeetCandidates, type MeetCandidate } from './meetCandidates';
import { sendMeetRequest } from './meetController';
import { meetCooldownRemainingMs, useMeetStore } from './meetStore';

/** Stable identity for the closed picker, so a card with nothing open doesn't
 * hand its children a fresh array on every render. */
const NO_CANDIDATES: MeetCandidate[] = [];

/**
 * The two things there are to do with a friend who is around: look at them, or
 * arrange to be in the same place as them.
 *
 * Meet opens a picker rather than sending anything, because the station is the
 * whole decision -- the map's version of this button already knows which
 * station you mean (you tapped it), and this one cannot. The second tap on
 * Meet is what sends, so the button reads the same both times and nothing goes
 * out on a single stray tap.
 *
 * Every state and rule is shared with the map's `MeetButton` through the same
 * store and controller: one cooldown, one pending request per friend, one
 * agreed meet.
 */
export function FriendMeetActions({
  friendUserId,
  friendName,
  journey,
  selfRoute,
  onShowOnMap,
  canShowOnMap,
}: {
  friendUserId: string;
  friendName: string;
  /** Their journey, and the viewer's own route. Both handed down rather than
   * resolved here: this renders once per friend, and each of them costs a
   * route progress pass over every station on a journey. Working them out per
   * card meant redoing that for every friend on every GPS fix -- and the
   * screen already resolves both once, so that every row is also answering
   * against the same journey. */
  journey: FriendJourneyView | null;
  selfRoute: SelfRouteView | null;
  onShowOnMap: () => void;
  /** False until we hold a position for them -- there is nowhere for the map
   * to fly to, and the tap would do nothing. */
  canShowOnMap: boolean;
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
  const isReachable = useMeetStore((state) => Boolean(state.reachable[friendUserId]));

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [cooldownMs, setCooldownMs] = useState(() => meetCooldownRemainingMs(friendUserId));

  // Only while the picker is actually open. Intersecting two journeys means
  // walking both station sequences, and both of them are rebuilt whenever
  // either person moves -- doing that for every friend on the screen, on every
  // fix, to fill a control nobody has opened is the one genuinely expensive
  // thing this component could do.
  const candidates = useMemo(
    () =>
      isPickerOpen
        ? buildMeetCandidates({
            self: selfRoute
              ? { route: selfRoute.route, progress: selfRoute.progress, clock: selfRoute.clock }
              : null,
            friend: journey
              ? { route: journey.route, progress: journey.progress, clock: journey.clock }
              : null,
            friendName,
          })
        : NO_CANDIDATES,
    [isPickerOpen, selfRoute, journey, friendName],
  );

  // A local tick, and only while the cooldown is running -- the store
  // deliberately doesn't publish a per-second value. Same arrangement as the
  // map's button.
  useEffect(() => {
    setCooldownMs(meetCooldownRemainingMs(friendUserId));
    const id = setInterval(() => {
      const remaining = meetCooldownRemainingMs(friendUserId);
      setCooldownMs(remaining);
      if (remaining <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [friendUserId, lastRequestAt]);

  // Either journey can change under the picker while it is open -- a train
  // moves, someone re-plans -- and the list is rebuilt when it does. What is
  // sent is always whatever this same render is showing, but an index left
  // past the end of a list that just got shorter would leave the picker
  // showing nothing at all.
  useEffect(() => {
    setIndex((current) => (current < candidates.length ? current : 0));
  }, [candidates]);

  // A meet agreed anywhere -- here, or by answering from the map -- closes the
  // picker: there is nothing left to choose, and the button that would send is
  // gone with it.
  useEffect(() => {
    if (meet) setIsPickerOpen(false);
  }, [meet]);

  const isPending = outgoing?.outcome === 'pending';
  const isCoolingDown = cooldownMs > 0;
  const canReach =
    isReachable ||
    // MOCK FRIEND -- delete with src/dev/mockFriend.ts.
    isMockFriendId(friendUserId);
  const selected = candidates[index] ?? null;

  async function handleMeetPress() {
    if (!isPickerOpen) {
      setIsPickerOpen(true);
      return;
    }
    if (!selected) return;

    setIsSending(true);
    const result = await sendMeetRequest(friendUserId, selected.stationId);
    setIsSending(false);
    if (result.ok) {
      // Closed on success: the outgoing state below now carries the whole
      // story, and leaving a picker open next to "asked" invites a second tap
      // that the cooldown would only refuse.
      setIsPickerOpen(false);
    } else {
      Alert.alert(`Couldn't ask ${friendName}`, result.reason);
    }
  }

  const meetLabel = isPending
    ? 'ASKED'
    : isCoolingDown
      ? `WAIT ${Math.ceil(cooldownMs / 1000)}s`
      : isPickerOpen
        ? 'SEND'
        : 'MEET';

  // Hidden rather than disabled once a meet is agreed: the section above this
  // already says where and when in full, and owns calling it off. Two controls
  // for one arrangement is one too many.
  const canOfferMeet = canReach && meet === null;
  const isMeetDisabled = isPending || isCoolingDown || isSending || (isPickerOpen && !selected);

  return (
    <Animated.View style={styles.wrap} layout={LinearTransition.duration(220)}>
      {isPickerOpen && (
        <Animated.View
          style={styles.picker}
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(140)}
          layout={LinearTransition.duration(220)}
        >
          {selected ? (
            <>
              <View style={styles.pickerRow}>
                <AnimatedPressable
                  style={styles.arrow}
                  onPress={() => setIndex((i) => (i - 1 + candidates.length) % candidates.length)}
                  disabled={candidates.length < 2}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Previous station"
                >
                  <Ionicons
                    name="chevron-back"
                    size={16}
                    color={candidates.length < 2 ? colors.textSecondary : colors.textPrimary}
                  />
                </AnimatedPressable>

                <View style={styles.pickerCentre}>
                  <Text style={styles.pickerStation} numberOfLines={1}>
                    {selected.stationName}
                  </Text>
                  <Text style={styles.pickerDetail} numberOfLines={2}>
                    {selected.detail}
                  </Text>
                </View>

                <AnimatedPressable
                  style={styles.arrow}
                  onPress={() => setIndex((i) => (i + 1) % candidates.length)}
                  disabled={candidates.length < 2}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Next station"
                >
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={candidates.length < 2 ? colors.textSecondary : colors.textPrimary}
                  />
                </AnimatedPressable>
              </View>

              <Text style={styles.pickerFooter}>
                {`${index + 1} of ${candidates.length} · `}
                {selected.source === 'shared'
                  ? 'on both your routes'
                  : selected.source === 'theirs'
                    ? `on ${friendName}'s route`
                    : 'on your route'}
              </Text>
            </>
          ) : (
            <Text style={styles.pickerEmpty}>
              Nowhere to suggest yet — neither of you has a route on the go. Plan one, or wait for{' '}
              {friendName} to start sharing a journey.
            </Text>
          )}
        </Animated.View>
      )}

      <View style={styles.buttons}>
        {canShowOnMap && (
          <AnimatedPressable
            style={styles.button}
            onPress={onShowOnMap}
            accessibilityRole="button"
            accessibilityLabel={`Show ${friendName} on the map`}
          >
            <Ionicons name="map-outline" size={14} color={colors.textPrimary} />
            <Text style={styles.buttonText}>MAP</Text>
          </AnimatedPressable>
        )}

        {canOfferMeet && (
          <AnimatedPressable
            style={[
              styles.button,
              isPickerOpen && !isMeetDisabled && styles.buttonPrimary,
              isMeetDisabled && styles.buttonDisabled,
            ]}
            onPress={handleMeetPress}
            disabled={isMeetDisabled}
            accessibilityRole="button"
            accessibilityLabel={
              isPickerOpen && selected
                ? `Ask ${friendName} to meet at ${selected.stationName}`
                : `Choose where to meet ${friendName}`
            }
          >
            {isSending ? (
              <ActivityIndicator size="small" color={colors.onPrimary} />
            ) : (
              <>
                <Ionicons
                  name="hand-left-outline"
                  size={14}
                  color={
                    isMeetDisabled
                      ? colors.textSecondary
                      : isPickerOpen
                        ? colors.onPrimary
                        : colors.accent
                  }
                />
                <Text
                  style={[
                    styles.buttonText,
                    isMeetDisabled
                      ? styles.buttonTextQuiet
                      : isPickerOpen
                        ? styles.buttonTextOnPrimary
                        : styles.buttonTextAccent,
                  ]}
                >
                  {meetLabel}
                </Text>
              </>
            )}
          </AnimatedPressable>
        )}

        {isPickerOpen && (
          <AnimatedPressable
            style={styles.button}
            onPress={() => setIsPickerOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close the meeting point picker"
          >
            <Text style={styles.buttonText}>CANCEL</Text>
          </AnimatedPressable>
        )}
      </View>
    </Animated.View>
  );
}

function createStyles(
  colors: ColorTokens,
  radius: { none: number; badge: number },
  typography: Record<string, TypeStyle>,
) {
  return StyleSheet.create({
    wrap: {
      gap: 8,
      marginTop: 2,
    },
    buttons: {
      flexDirection: 'row',
      gap: 8,
    },
    button: {
      flex: 1,
      height: 34,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.none,
    },
    // Once the picker is open, sending is the primary act on the card.
    buttonPrimary: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    /** ASKED and the cooldown count are states, not offers. They read as
     * switched off -- faded, with the hairline knocked back too -- so the eye
     * doesn't keep landing on a control that will refuse the tap. */
    buttonDisabled: {
      opacity: 0.45,
      borderColor: colors.outlineVariant,
      backgroundColor: 'transparent',
    },
    buttonText: {
      ...typography.labelCaps,
      fontSize: 10,
      color: colors.textPrimary,
    },
    buttonTextAccent: {
      color: colors.accent,
    },
    buttonTextOnPrimary: {
      color: colors.onPrimary,
    },
    buttonTextQuiet: {
      color: colors.textSecondary,
    },
    picker: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.none,
      backgroundColor: colors.surfaceContainerHigh,
      paddingVertical: 8,
      paddingHorizontal: 6,
      gap: 4,
    },
    pickerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    arrow: {
      width: 30,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pickerCentre: {
      flex: 1,
      minWidth: 0,
      alignItems: 'center',
      gap: 1,
    },
    pickerStation: {
      ...typography.bodyMd,
      fontSize: 15,
      fontWeight: '700',
      color: colors.textPrimary,
      textAlign: 'center',
    },
    pickerDetail: {
      ...typography.dataSm,
      fontSize: 10,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    pickerFooter: {
      ...typography.labelCaps,
      fontSize: 9,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    pickerEmpty: {
      ...typography.bodyMd,
      fontSize: 12,
      lineHeight: 17,
      color: colors.textSecondary,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
  });
}
