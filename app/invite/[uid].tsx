import { Ionicons } from '@expo/vector-icons';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { Avatar } from '../../src/components/Avatar';
import { PlaceholderScreen } from '../../src/components/PlaceholderScreen';
import { savePendingInvite } from '../../src/friends/pendingInvite';
import { createFriendRequest, lookupUserByHandle, type HandleTarget } from '../../src/friends/useFriendships';
import { useTheme } from '../../src/theme/ThemeProvider';
import type { ColorTokens, TypeStyle } from '../../src/theme/tokens';

/**
 * Landing route for `metrosync://invite/<public_uid>` links and the QR that
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
      <View style={[styles.loadingRoot, { backgroundColor: colors.canvas }]}>
        <ActivityIndicator color={colors.textPrimary} />
      </View>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  return <InviteContent publicUid={publicUid} selfUserId={session.user.id} />;
}

type Phase = 'resolving' | 'ready' | 'sending' | 'sent';

function InviteContent({ publicUid, selfUserId }: { publicUid: string; selfUserId: string }) {
  const { colors, radius, typography } = useTheme();
  const themedStyles = useMemo(
    () => createStyles(colors, radius.none, typography),
    [colors, radius, typography],
  );
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('resolving');
  const [target, setTarget] = useState<HandleTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isSelf = target?.id === selfUserId;

  useEffect(() => {
    let cancelled = false;
    setPhase('resolving');
    setError(null);

    void lookupUserByHandle(publicUid).then((result) => {
      if (cancelled) return;
      if (!result.target) {
        // The lookup's own copy talks about "email or ID", which is wrong here
        // -- the user never typed anything, they tapped a link.
        setError('This invite link is no longer valid.');
      } else {
        setTarget(result.target);
      }
      setPhase('ready');
    });

    return () => {
      cancelled = true;
    };
  }, [publicUid]);

  async function handleSend() {
    if (!target) return;
    setPhase('sending');
    setError(null);

    const result = await createFriendRequest(selfUserId, target.id);
    if (result.error) {
      setError(result.error);
      setPhase('ready');
      return;
    }
    setPhase('sent');
  }

  /** A link tap is often a cold start, so there is usually nothing behind this
   * screen to go back to -- land on the Friends tab instead of a dead end. */
  function handleClose() {
    if (router.canGoBack()) router.back();
    else router.replace('/friends');
  }

  const name = target?.display_name?.trim() || `User ${target?.public_uid ?? publicUid}`;

  return (
    <SafeAreaView style={themedStyles.safeArea} edges={['top', 'bottom']}>
      <View style={themedStyles.header}>
        <Pressable
          hitSlop={10}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close invite"
        >
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>

      <View style={themedStyles.content}>
        <Text style={themedStyles.eyebrow}>METROSYNC INVITE</Text>

        {phase === 'resolving' ? (
          <ActivityIndicator color={colors.textPrimary} style={themedStyles.resolving} />
        ) : !target ? (
          <>
            <Text style={themedStyles.title}>Invite not found</Text>
            <Text style={themedStyles.note}>
              {error ?? 'This invite link is no longer valid.'}
            </Text>
          </>
        ) : isSelf ? (
          <>
            <Text style={themedStyles.title}>This is your own link</Text>
            <Text style={themedStyles.note}>
              Share it with someone else and they'll be able to send you a request.
            </Text>
          </>
        ) : (
          <Animated.View
            style={themedStyles.card}
            entering={FadeIn.duration(180)}
            layout={LinearTransition.duration(220)}
          >
            <Avatar label={name} imageUrl={null} size={64} />
            <Text style={themedStyles.name} numberOfLines={2}>
              {name}
            </Text>
            <Text style={themedStyles.uid}>ID: {target.public_uid}</Text>

            {phase === 'sent' ? (
              <Animated.View style={themedStyles.sentBlock} entering={FadeIn.duration(180)}>
                <View style={themedStyles.sentBadge}>
                  <Ionicons name="checkmark" size={14} color={colors.success} />
                  <Text style={themedStyles.sentBadgeText}>REQUEST SENT</Text>
                </View>
                <Text style={themedStyles.note}>
                  {name} has to accept before either of you can see the other on the map.
                </Text>
              </Animated.View>
            ) : (
              <Text style={themedStyles.note}>
                Sending a request lets you share live locations once they accept it.
              </Text>
            )}
          </Animated.View>
        )}

        {error && target && (
          <Animated.Text
            style={themedStyles.errorText}
            entering={FadeIn.duration(160)}
            exiting={FadeOut.duration(120)}
          >
            {error}
          </Animated.Text>
        )}
      </View>

      <View style={themedStyles.actions}>
        {target && !isSelf && phase !== 'sent' ? (
          <Pressable
            style={({ pressed }) => [
              themedStyles.primaryButton,
              pressed && themedStyles.primaryButtonPressed,
            ]}
            onPress={handleSend}
            disabled={phase !== 'ready'}
            accessibilityRole="button"
          >
            {phase === 'sending' ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <>
                <Ionicons name="person-add" size={17} color={colors.onPrimary} />
                <Text style={themedStyles.primaryButtonText}>Send friend request</Text>
              </>
            )}
          </Pressable>
        ) : (
          phase !== 'resolving' && (
            <Pressable
              style={({ pressed }) => [
                themedStyles.primaryButton,
                pressed && themedStyles.primaryButtonPressed,
              ]}
              onPress={handleClose}
              accessibilityRole="button"
            >
              <Text style={themedStyles.primaryButtonText}>Done</Text>
            </Pressable>
          )
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

function createStyles(
  colors: ColorTokens,
  radiusNone: number,
  typography: Record<string, TypeStyle>,
) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.canvas,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      paddingHorizontal: 20,
      paddingTop: 8,
    },
    content: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: 24,
      gap: 14,
    },
    eyebrow: {
      ...typography.labelCaps,
      color: colors.textSecondary,
      letterSpacing: 2,
      textAlign: 'center',
    },
    resolving: {
      paddingVertical: 40,
    },
    title: {
      ...typography.headlineMd,
      color: colors.textPrimary,
      textAlign: 'center',
    },
    card: {
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.surfaceContainerLow,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radiusNone,
      paddingVertical: 28,
      paddingHorizontal: 20,
    },
    name: {
      ...typography.headlineMd,
      fontSize: 20,
      color: colors.textPrimary,
      textAlign: 'center',
      marginTop: 4,
    },
    uid: {
      ...typography.dataSm,
      color: colors.textSecondary,
    },
    note: {
      ...typography.bodyMd,
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: 4,
    },
    sentBlock: {
      alignItems: 'center',
      gap: 2,
      marginTop: 6,
    },
    sentBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    sentBadgeText: {
      ...typography.labelCaps,
      color: colors.success,
    },
    errorText: {
      ...typography.bodyMd,
      fontSize: 13,
      color: colors.danger,
      textAlign: 'center',
    },
    actions: {
      paddingHorizontal: 24,
      paddingBottom: 16,
    },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 9,
      backgroundColor: colors.accent,
      borderRadius: radiusNone,
      paddingVertical: 16,
    },
    primaryButtonPressed: {
      opacity: 0.85,
    },
    primaryButtonText: {
      ...typography.bodyMd,
      fontFamily: 'Outfit_600SemiBold',
      fontSize: 15,
      fontWeight: '700',
      color: colors.onPrimary,
    },
  });
}
