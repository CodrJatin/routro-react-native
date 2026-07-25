import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import type { Profile } from '../auth/AuthProvider';
import { useAuth } from '../auth/AuthProvider';
import { useFriendshipsContext } from '../friends/FriendshipsProvider';
import { otherParty } from '../friends/useFriendships';
import { useFriendStatuses, useLocationStore } from '../realtime/locationStore';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens } from '../theme/tokens';

export interface ActiveFriend {
  userId: string;
  lat: number;
  lon: number;
  profile: Profile;
}

function initialsOf(profile: Profile): string {
  const source = profile.display_name?.trim() || profile.email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[1]?.[0] ?? '') : '');
  return letters.toUpperCase() || '?';
}

/**
 * Vertical stack of active friends' profile icons, anchored above the
 * broadcast button. Tapping one asks the map to fly to that friend. Renders
 * nothing when no friend is currently broadcasting a live location.
 */
export function FriendFocusStack({
  onSelectFriend,
}: {
  onSelectFriend: (friend: ActiveFriend) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { session } = useAuth();
  const selfUserId = session?.user.id;
  const { rows } = useFriendshipsContext();
  const friendLocations = useLocationStore((state) => state.friendLocations);
  const statuses = useFriendStatuses();

  const profilesByUserId = useMemo(() => {
    const map = new Map<string, Profile>();
    if (!selfUserId) return map;
    for (const row of rows) {
      if (row.status !== 'accepted') continue;
      const friend = otherParty(row, selfUserId);
      map.set(friend.id, friend);
    }
    return map;
  }, [rows, selfUserId]);

  const activeFriends = useMemo<ActiveFriend[]>(() => {
    // 'live' (not 'stale') matches the stack's original <=30s freshness
    // window, now sourced from the single shared status model instead of a
    // duplicated local constant.
    return Object.values(friendLocations)
      .filter((loc) => statuses[loc.userId] === 'live' && profilesByUserId.has(loc.userId))
      .map((loc) => ({
        userId: loc.userId,
        lat: loc.lat,
        lon: loc.lon,
        profile: profilesByUserId.get(loc.userId)!,
      }));
  }, [friendLocations, profilesByUserId, statuses]);

  if (activeFriends.length === 0) return null;

  return (
    <View style={styles.stack} pointerEvents="box-none">
      {activeFriends.map((friend) => (
        <Animated.View
          key={friend.userId}
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(140)}
          layout={LinearTransition.duration(220)}
        >
          <Pressable
            style={styles.avatarButton}
            onPress={() => onSelectFriend(friend)}
            accessibilityRole="button"
            accessibilityLabel={`Focus map on ${friend.profile.display_name ?? friend.profile.email}`}
          >
            <FriendAvatarThumb profile={friend.profile} styles={styles} />
          </Pressable>
        </Animated.View>
      ))}
    </View>
  );
}

/** Falls back to initials if the URL is missing or fails to load, instead of
 * leaving a blank circle for a broken/invalid avatar_url. */
function FriendAvatarThumb({ profile, styles }: { profile: Profile; styles: ReturnType<typeof createStyles> }) {
  const [hasError, setHasError] = useState(false);
  useEffect(() => setHasError(false), [profile.avatar_url]);

  if (profile.avatar_url && !hasError) {
    return (
      <Image
        source={{ uri: profile.avatar_url }}
        style={styles.avatarImage}
        onError={() => setHasError(true)}
      />
    );
  }

  return (
    <View style={[styles.avatarImage, styles.avatarFallback]}>
      <Text style={styles.avatarInitials}>{initialsOf(profile)}</Text>
    </View>
  );
}

const AVATAR_SIZE = 44;

function createStyles(colors: ColorTokens) {
  return StyleSheet.create({
    // Anchored by its bottom edge just above the broadcast button (bottom 84 +
    // its 48px height), growing upward as more friends become active.
    stack: {
      position: 'absolute',
      right: 16,
      bottom: 140,
      alignItems: 'center',
      gap: 10,
    },
    avatarButton: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: AVATAR_SIZE / 2,
      borderWidth: 2,
      borderColor: colors.success,
      backgroundColor: colors.surfaceElevated,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    },
    avatarImage: {
      width: '100%',
      height: '100%',
    },
    avatarFallback: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    avatarInitials: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '700',
    },
  });
}
