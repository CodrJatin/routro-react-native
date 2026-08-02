import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { AnimatedPressable } from '../../src/components/AnimatedPressable';
import { Avatar } from '../../src/components/Avatar';
import { PlaceholderScreen } from '../../src/components/PlaceholderScreen';
import { RoutroMark } from '../../src/components/RoutroMark';
import { savePendingInvite } from '../../src/friends/pendingInvite';
import {
  createFriendRequest,
  getExistingFriendship,
  lookupUserByHandle,
  type ExistingFriendship,
  type HandleTarget,
} from '../../src/friends/useFriendships';
import { useTheme } from '../../src/theme/ThemeProvider';
import type { ColorTokens, TypeStyle } from '../../src/theme/tokens';

/**
 * Landing route for `routro://invite/<public_uid>` links and the QR that
 * encodes one (see src/friends/inviteLink.ts).
 *
 * Opening a link deliberately does NOT create a friendship: it resolves the ID
 * to a name, shows it, and -- on an explicit tap -- sends the same pending
 * request the Friends tab's add box sends. The person who shared the link is
 * the addressee and still has to accept, so a link that leaks into a group
 * chat costs them a request to decline, not a stranger on their live map.
 */
export default function InviteScreen() {
  const { uid } = useLocalSearchParams<{ uid: string }>();
  const { isConfigured, isLoading, session } = useAuth();
  const { colors } = useTheme();

  const publicUid = (uid ?? '').trim().toLowerCase();

  // Park the invite before handing off to sign-in, so it survives the trip out
  // to Google and back (the tab layout picks it up again on the way in).
  useEffect(() => {
    if (isConfigured && !isLoading && !session && publicUid) {
      void savePendingInvite(publicUid);
    }
  }, [isConfigured, isLoading, session, publicUid]);

  if (!isConfigured) {
    return (
      <PlaceholderScreen
        title="Invite"
        note="Backend not configured yet, so invite links can't be opened on this build."
      />
    );
  }

  // The session may still be rehydrating from storage on a cold start -- which
  // is exactly what a link tap is -- and redirecting on that would bounce a
  // signed-in user through sign-in for nothing.
  if (isLoading) {
    return (
      <View style={[bootStyles.root, { backgroundColor: colors.canvas }]}>
        <ActivityIndicator color={colors.textPrimary} />
      </View>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  return <InviteContent publicUid={publicUid} selfUserId={session.user.id} />;
}

/** Every distinct thing this screen can be showing. Derived once from the
 * lookup + friendship reads so the copy, the badge, the rail and the button
 * can't drift out of sync with each other the way parallel ternaries do. */
type InviteState =
  | { kind: 'resolving' }
  | { kind: 'invalid' }
  | { kind: 'self' }
  | { kind: 'connected' }
  | { kind: 'outgoing' }
  | { kind: 'incoming' }
  | { kind: 'sendable' };

function InviteContent({ publicUid, selfUserId }: { publicUid: string; selfUserId: string }) {
  const { colors, radius, typography } = useTheme();
  const styles = useMemo(
    () => createStyles(colors, radius.none, radius.badge, typography),
    [colors, radius, typography],
  );
  const router = useRouter();
  const { profile: selfProfile } = useAuth();

  const [isResolving, setIsResolving] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [target, setTarget] = useState<HandleTarget | null>(null);
  // Read fresh every time the screen opens rather than remembered locally,
  // so a re-tapped link -- or the OS replaying its deep-link Intent on
  // reload/process restore -- lands on the true current state (already
  // friends, request already pending) instead of a stale one.
  const [friendship, setFriendship] = useState<ExistingFriendship | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [didCopy, setDidCopy] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsResolving(true);
    setError(null);
    setTarget(null);
    setFriendship(null);

    void lookupUserByHandle(publicUid).then(async (result) => {
      if (cancelled) return;
      if (!result.target) {
        // The lookup's own copy talks about "email or ID", which is wrong
        // here -- the user never typed anything, they tapped a link.
        setError('This invite link is no longer valid.');
        setIsResolving(false);
        return;
      }

      setTarget(result.target);

      if (result.target.id === selfUserId) {
        setIsResolving(false);
        return;
      }

      const { friendship: existing, error: friendshipError } = await getExistingFriendship(
        selfUserId,
        result.target.id,
      );
      if (cancelled) return;
      if (friendshipError) setError(friendshipError);
      setFriendship(existing);
      setIsResolving(false);
    });

    return () => {
      cancelled = true;
    };
  }, [publicUid, selfUserId]);

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const state: InviteState = !isResolving
    ? !target
      ? { kind: 'invalid' }
      : target.id === selfUserId
        ? { kind: 'self' }
        : friendship?.status === 'accepted'
          ? { kind: 'connected' }
          : friendship?.direction === 'outgoing'
            ? { kind: 'outgoing' }
            : friendship?.direction === 'incoming'
              ? { kind: 'incoming' }
              : { kind: 'sendable' }
    : { kind: 'resolving' };

  const name = target?.display_name?.trim() || `User ${target?.public_uid ?? publicUid}`;
  const copy = copyFor(state, name);

  // A link tap is often a cold start, so there is usually nothing behind this
  // screen to go back to -- dismissTo lands on the Friends tab either way,
  // popping back to it if it's already on the stack or pushing it fresh if
  // this is the only screen there is.
  function handleClose() {
    router.dismissTo('/friends');
  }

  async function handleCopyUid() {
    if (!target) return;
    await Clipboard.setStringAsync(target.public_uid);
    setDidCopy(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setDidCopy(false), 1600);
  }

  async function handleSend() {
    if (!target) return;
    setIsSending(true);
    setError(null);

    const result = await createFriendRequest(selfUserId, target.id);
    setIsSending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setFriendship({ status: 'pending', direction: 'outgoing' });
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.brand}>
            <RoutroMark size={22} />
            <Text style={styles.eyebrow}>ROUTRO · INVITE</Text>
          </View>
          <AnimatedPressable
            hitSlop={12}
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Close invite"
          >
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </AnimatedPressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Animated.Text style={styles.title} layout={LinearTransition.duration(220)}>
            {copy.title}
          </Animated.Text>

          {/* The two of you as terminus stops on one line, with the diamond
              interchange from the app mark where you'd meet. Its state is the
              status: hollow and dashed until a request exists, filled and
              solid once one does. */}
          <ConnectionRail
            styles={styles}
            colors={colors}
            state={state}
            selfLabel={selfProfile?.display_name ?? selfProfile?.email ?? 'You'}
            selfAvatarUrl={selfProfile?.avatar_url ?? null}
            targetLabel={name}
            targetAvatarUrl={target?.avatar_url ?? null}
            isBusy={isResolving || isSending}
          />

          {state.kind === 'resolving' ? (
            <Animated.View style={styles.resolving} entering={FadeIn.duration(180)}>
              <ActivityIndicator color={colors.textSecondary} />
              <Text style={styles.resolvingText}>Resolving invite {publicUid}…</Text>
            </Animated.View>
          ) : (
            <Animated.View
              style={styles.ticket}
              entering={FadeIn.duration(200)}
              layout={LinearTransition.duration(220)}
            >
              <View style={styles.ticketStub}>
                <Text style={styles.stubLabel}>{copy.stub}</Text>
              </View>

              {target && (
                <View style={styles.ticketIdentity}>
                  <Avatar label={name} imageUrl={target.avatar_url} size={52} />
                  <View style={styles.ticketIdentityText}>
                    <Text style={styles.ticketName} numberOfLines={2}>
                      {name}
                    </Text>
                    <AnimatedPressable
                      style={styles.uidRow}
                      onPress={handleCopyUid}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Copy user ID"
                    >
                      <Text style={styles.uid}>
                        {didCopy ? 'COPIED' : `ID ${target.public_uid}`}
                      </Text>
                      <Ionicons
                        name={didCopy ? 'checkmark' : 'copy-outline'}
                        size={12}
                        color={didCopy ? colors.success : colors.textSecondary}
                      />
                    </AnimatedPressable>
                  </View>
                </View>
              )}

              <View style={styles.ticketDivider} />

              <View style={styles.statusRow}>
                <Ionicons name={copy.icon} size={14} color={toneColor(copy.tone, colors)} />
                <Text style={[styles.statusLabel, { color: toneColor(copy.tone, colors) }]}>
                  {copy.status}
                </Text>
              </View>
              <Text style={styles.note}>{copy.note}</Text>
            </Animated.View>
          )}

          {error && target && (
            <Animated.View
              style={styles.errorStrip}
              entering={FadeIn.duration(160)}
              exiting={FadeOut.duration(120)}
            >
              <Text style={styles.errorText}>{error}</Text>
            </Animated.View>
          )}
        </ScrollView>

        {/* flexDirection: row + flex: 1 on the button, not a lone button
            stretched via alignSelf -- this is the same shape as the working
            buttons on Settings and the InviteSheet share card, and unlike
            alignSelf it doesn't depend on Yoga treating an
            Animated.createAnimatedComponent(Pressable) as a normal flex child
            in a column. */}
        {state.kind !== 'resolving' && (
          <Animated.View style={styles.actions} entering={FadeIn.duration(200)}>
            <View style={styles.actionsRow}>
              <AnimatedPressable
                style={styles.primaryButton}
                onPress={state.kind === 'sendable' ? handleSend : handleClose}
                disabled={isSending}
                accessibilityRole="button"
              >
                {isSending ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : (
                  <>
                    {state.kind === 'sendable' && (
                      <Ionicons name="person-add" size={16} color={colors.onPrimary} />
                    )}
                    <Text style={styles.primaryButtonText}>{copy.action}</Text>
                  </>
                )}
              </AnimatedPressable>
            </View>

            {state.kind === 'sendable' && (
              <AnimatedPressable
                style={styles.ghostButton}
                onPress={handleClose}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text style={styles.ghostButtonText}>Not now</Text>
              </AnimatedPressable>
            )}
          </Animated.View>
        )}
    </SafeAreaView>
  );
}

type Tone = 'neutral' | 'positive' | 'accent' | 'danger';

interface StateCopy {
  title: string;
  stub: string;
  status: string;
  note: string;
  action: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tone: Tone;
}

function copyFor(state: InviteState, name: string): StateCopy {
  switch (state.kind) {
    case 'resolving':
      return {
        title: 'Opening invite',
        stub: 'INVITE',
        status: 'RESOLVING',
        note: '',
        action: '',
        icon: 'time-outline',
        tone: 'neutral',
      };
    case 'invalid':
      return {
        title: 'Invite not found',
        stub: 'DEAD LINK',
        status: 'NO LONGER VALID',
        note: 'This link points at an account that no longer exists. Ask for a fresh invite link or QR code.',
        action: 'Back to Friends',
        icon: 'alert-circle-outline',
        tone: 'danger',
      };
    case 'self':
      return {
        title: 'This is your own link',
        stub: 'YOUR INVITE',
        status: 'THAT’S YOU',
        note: 'Share it with someone else and they’ll be able to send you a request from here.',
        action: 'Back to Friends',
        icon: 'person-outline',
        tone: 'neutral',
      };
    case 'connected':
      return {
        title: 'Already connected',
        stub: 'BOARDING PASS',
        status: 'FRIENDS',
        note: `You and ${name} already share live locations. Nothing to do here.`,
        action: 'Back to Friends',
        icon: 'people',
        tone: 'positive',
      };
    case 'outgoing':
      return {
        title: 'Request sent',
        stub: 'AWAITING',
        status: 'PENDING THEIR ACCEPT',
        note: `${name} has to accept before either of you can see the other on the map.`,
        action: 'Done',
        icon: 'checkmark-circle',
        tone: 'positive',
      };
    case 'incoming':
      return {
        title: 'They invited you',
        stub: 'AWAITING YOU',
        status: 'PENDING YOUR ACCEPT',
        note: `${name} already sent you a request — accept it from the Friends tab to start sharing.`,
        action: 'Go to Friends',
        icon: 'mail-unread',
        tone: 'accent',
      };
    case 'sendable':
      return {
        title: 'You’ve been invited',
        stub: 'INVITE',
        status: 'NOT CONNECTED YET',
        note: `Sending a request lets you and ${name} see each other on the live map — once they accept it.`,
        action: 'Send friend request',
        icon: 'git-compare-outline',
        tone: 'neutral',
      };
  }
}

function toneColor(tone: Tone, colors: ColorTokens): string {
  switch (tone) {
    case 'positive':
      return colors.success;
    case 'accent':
      return colors.accent;
    case 'danger':
      return colors.danger;
    default:
      return colors.textSecondary;
  }
}

/** You and them as the two terminus stops of one line, with the diamond
 * interchange from the app mark where you'd meet. The rail carries the state:
 * dashed with a hollow diamond while the connection is only hypothetical,
 * closed up into a solid line with a filled diamond once a request exists.
 * While the screen is waiting on the network a car shuttles the length of it,
 * so the wait has the app's pulse rather than a bare spinner. */
function ConnectionRail({
  styles,
  colors,
  state,
  selfLabel,
  selfAvatarUrl,
  targetLabel,
  targetAvatarUrl,
  isBusy,
}: {
  styles: ReturnType<typeof createStyles>;
  colors: ColorTokens;
  state: InviteState;
  selfLabel: string;
  selfAvatarUrl: string | null;
  targetLabel: string;
  targetAvatarUrl: string | null;
  isBusy: boolean;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const progress = useSharedValue(0);
  const prefersReducedMotion = useReducedMotion();

  // Sending the request is what closes the line: an outgoing request (or a
  // friendship already made) joins the dashes up and fills the diamond.
  //
  // The closed line and filled diamond are drawn in the theme's primary ink
  // rather than the success green -- white on the dark canvas, black on the
  // light one. `textPrimary` and not a literal '#fff' so it stays legible in
  // light mode, where a white fill would vanish into the page.
  const isLinked = state.kind === 'outgoing' || state.kind === 'connected';
  const railColor = isLinked ? colors.textPrimary : colors.outlineVariant;
  const diamondColor = isLinked
    ? colors.textPrimary
    : state.kind === 'invalid'
      ? colors.outlineVariant
      : colors.outline;

  useEffect(() => {
    if (prefersReducedMotion || !isBusy) {
      progress.value = withTiming(0, { duration: 160 });
      return;
    }
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [progress, prefersReducedMotion, isBusy]);

  const travel = Math.max(trackWidth - CAR_WIDTH, 0);
  const carStyle = useAnimatedStyle(
    () => ({ opacity: isBusy ? 1 : 0, transform: [{ translateX: progress.value * travel }] }),
    [travel, isBusy],
  );

  function handleLayout(event: LayoutChangeEvent) {
    setTrackWidth(event.nativeEvent.layout.width);
  }

  const isTargetKnown = state.kind !== 'resolving' && state.kind !== 'invalid';

  return (
    <View style={styles.rail}>
      <View style={styles.railNode}>
        <Avatar label={selfLabel} imageUrl={selfAvatarUrl} size={40} />
        <Text style={styles.railNodeLabel} numberOfLines={1}>
          YOU
        </Text>
      </View>

      <View style={styles.railTrack} onLayout={handleLayout}>
        <View style={styles.railLine}>
          {RAIL_DASHES.map((key) => (
            <View
              key={key}
              style={[
                styles.railDash,
                { backgroundColor: railColor },
                // The same geometry with the gaps filled in, so connecting is
                // the dashes closing up rather than a different object.
                isLinked && styles.railDashLinked,
              ]}
            />
          ))}
        </View>

        <View style={styles.railDiamondSlot} pointerEvents="none">
          <View
            style={[
              styles.railDiamond,
              {
                borderColor: diamondColor,
                backgroundColor: isLinked ? diamondColor : colors.canvas,
              },
            ]}
          />
        </View>

        <Animated.View
          style={[styles.railCar, { backgroundColor: colors.textPrimary }, carStyle]}
          pointerEvents="none"
        />
      </View>

      <View style={styles.railNode}>
        {isTargetKnown ? (
          <Avatar label={targetLabel} imageUrl={targetAvatarUrl} size={40} />
        ) : (
          <View style={styles.railNodeUnknown}>
            <Ionicons
              name={state.kind === 'invalid' ? 'help' : 'ellipsis-horizontal'}
              size={16}
              color={colors.textSecondary}
            />
          </View>
        )}
        <Text style={styles.railNodeLabel} numberOfLines={1}>
          THEM
        </Text>
      </View>
    </View>
  );
}

const CAR_WIDTH = 22;
const RAIL_DASHES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];

const bootStyles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

function createStyles(
  colors: ColorTokens,
  radiusNone: number,
  radiusBadge: number,
  typography: Record<string, TypeStyle>,
) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.canvas,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 4,
    },
    brand: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    eyebrow: {
      ...typography.labelCaps,
      color: colors.textSecondary,
      letterSpacing: 1.6,
    },
    scrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: 20,
      paddingVertical: 24,
      gap: 24,
    },
    title: {
      ...typography.headlineLg,
      fontSize: 30,
      lineHeight: 36,
      color: colors.textPrimary,
    },

    // Connection rail
    rail: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    railNode: {
      alignItems: 'center',
      gap: 6,
      width: 52,
    },
    railNodeUnknown: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceContainerLow,
    },
    railNodeLabel: {
      ...typography.labelCaps,
      fontSize: 9,
      letterSpacing: 1.2,
      color: colors.textSecondary,
    },
    railTrack: {
      flex: 1,
      height: 40,
      justifyContent: 'center',
    },
    railLine: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    railDash: {
      flex: 1,
      height: 1,
    },
    railDashLinked: {
      height: 2,
      marginHorizontal: -2,
    },
    railDiamondSlot: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    railDiamond: {
      width: 14,
      height: 14,
      borderWidth: 1.5,
      transform: [{ rotate: '45deg' }],
    },
    railCar: {
      position: 'absolute',
      left: 0,
      width: CAR_WIDTH,
      height: 3,
    },

    // Resolving
    resolving: {
      alignItems: 'center',
      gap: 12,
      paddingVertical: 36,
    },
    resolvingText: {
      ...typography.dataSm,
      color: colors.textSecondary,
    },

    // Ticket
    ticket: {
      backgroundColor: colors.surfaceContainerLow,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radiusNone,
      padding: 16,
      gap: 12,
    },
    // The perforated stub of a paper ticket, squared off: a labelled band
    // above the identity block, bled to the card's edges.
    ticketStub: {
      marginHorizontal: -16,
      marginTop: -16,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surfaceContainer,
    },
    stubLabel: {
      ...typography.labelCaps,
      fontSize: 10,
      letterSpacing: 1.6,
      color: colors.textSecondary,
    },
    ticketIdentity: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
    },
    ticketIdentityText: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    ticketName: {
      ...typography.headlineMd,
      fontSize: 20,
      lineHeight: 26,
      color: colors.textPrimary,
    },
    uidRow: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
      paddingVertical: 3,
    },
    uid: {
      ...typography.dataSm,
      color: colors.textSecondary,
    },
    ticketDivider: {
      height: 1,
      backgroundColor: colors.border,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    statusLabel: {
      ...typography.labelCaps,
      letterSpacing: 1.2,
    },
    note: {
      ...typography.bodyMd,
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
    },

    errorStrip: {
      backgroundColor: colors.surfaceContainer,
      borderLeftWidth: 2,
      borderLeftColor: colors.danger,
      borderRadius: radiusBadge,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    errorText: {
      ...typography.bodyMd,
      fontSize: 13,
      lineHeight: 18,
      color: colors.danger,
    },

    // Actions
    actions: {
      paddingHorizontal: 20,
      paddingBottom: 12,
      gap: 4,
    },
    actionsRow: {
      flexDirection: 'row',
    },
    primaryButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 9,
      backgroundColor: colors.accent,
      borderRadius: radiusNone,
      paddingVertical: 16,
    },
    primaryButtonText: {
      ...typography.bodyMd,
      fontFamily: 'Outfit_600SemiBold',
      fontSize: 15,
      fontWeight: '700',
      color: colors.onPrimary,
    },
    ghostButton: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
    },
    ghostButtonText: {
      ...typography.labelCaps,
      color: colors.textSecondary,
    },
  });
}
