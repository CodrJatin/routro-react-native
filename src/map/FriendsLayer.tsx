import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Marker } from '@maplibre/maplibre-react-native';
import { memo, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Profile } from '../auth/AuthProvider';
import { useAuth } from '../auth/AuthProvider';
import { friendColorFor } from '../friends/friendColor';
import { useFriendJourneys } from '../friends/friendJourney';
import { useFriendshipsContext } from '../friends/FriendshipsProvider';
import { otherParty } from '../friends/useFriendships';
import {
  useFriendStatuses,
  useLocationStore,
  type FriendLocation,
} from '../realtime/locationStore';
import { useTheme } from '../theme/ThemeProvider';
import { useInterpolatedPosition } from './useInterpolatedPosition';

const PIN_SIZE = 34;
/** Deliberately smaller than the friend pin. A destination is context for the
 * pin, not a second thing of equal weight competing with it. */
const FLAG_SIZE = 22;

/** Same derivation as the focus stack's thumbnails, so a friend's fallback
 * initials are identical wherever they appear. */
function initialsOf(profile: Profile): string {
  const source = profile.display_name?.trim() || profile.email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[1]?.[0] ?? '') : '');
  return letters.toUpperCase() || '?';
}

/**
 * Live friend positions, drawn as avatar pins ringed in that friend's own
 * colour (see friendColor.ts) so two people broadcasting at once can be told
 * apart -- previously every friend was the same anonymous green dot.
 *
 * These are `Marker`s (real RN views) rather than a GeoJSON circle layer.
 * That trades some per-marker cost for the ability to show an actual avatar
 * with a coloured ring, which a circle layer cannot do. The trade is only
 * sound because the marker count is bounded by a person's accepted-friends
 * list, and only friends actively broadcasting are drawn at all.
 *
 * Staleness and removal come from the shared `useFriendStatuses` selector in
 * locationStore.ts, so this and the Friends tab can never disagree about who
 * is live.
 *
 * Note what this component deliberately does *not* do: animate. Each pin owns
 * its own frame loop (see `FriendPin`), so this renders only when the store
 * changes, and a friend moving across the map costs their marker rather than
 * the whole layer. The destination flags below are static for the same
 * reason -- they used to be redrawn sixty times a second alongside pins that
 * had nothing to do with them.
 */
export function FriendsLayer() {
  const { colors } = useTheme();
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

  const pins = useMemo(
    () =>
      Object.values(friendLocations)
        // Only the two statuses that mean "there is a position worth drawing".
        // Deliberately not `!== 'offline'`: a friend who stops sharing now
        // keeps their last location in the store until it ages out (see
        // `setFriendPresence`), so 'online' has to be excluded here or their
        // pin would sit on the map after they had visibly stopped. 'stale'
        // stays -- it draws dimmed, which is the honest rendering of a friend
        // in a tunnel.
        .filter(
          (loc) =>
            (statuses[loc.userId] === 'live' || statuses[loc.userId] === 'stale') &&
            profilesByUserId.has(loc.userId),
        )
        .map((loc) => ({
          location: loc,
          profile: profilesByUserId.get(loc.userId)!,
          isStale: statuses[loc.userId] === 'stale',
        })),
    [friendLocations, statuses, profilesByUserId],
  );

  const friendJourneys = useFriendJourneys();

  // Where each visible friend is headed. Gated on the same pin list rather
  // than on the journey map alone, so a destination flag can never outlive the
  // friend it belongs to -- a stale presence entry with no live pin under it
  // would otherwise leave an unexplained flag on the map.
  const destinations = useMemo(
    () =>
      pins
        .map(({ location }) => ({
          userId: location.userId,
          journey: friendJourneys[location.userId],
        }))
        .filter((entry) => entry.journey !== undefined),
    [pins, friendJourneys],
  );

  return (
    <>
      {destinations.map(({ userId, journey }) => (
        <Marker
          key={`destination-${userId}`}
          id={`friend-destination-${userId}`}
          lngLat={[journey.destination.lon, journey.destination.lat]}
        >
          <View style={[styles.flag, { borderColor: friendColorFor(userId), backgroundColor: colors.surface }]}>
            <Ionicons name="flag" size={11} color={friendColorFor(userId)} />
          </View>
        </Marker>
      ))}

      {pins.map(({ location, profile, isStale }) => (
        <FriendPin
          key={location.userId}
          location={location}
          profile={profile}
          isStale={isStale}
          surfaceColor={colors.surface}
          textColor={colors.textPrimary}
        />
      ))}
    </>
  );
}

/**
 * One friend's pin, and the only thing that re-renders while it is moving.
 *
 * The frame loop lives here rather than in `FriendsLayer` for exactly that
 * reason. Driven from the layer, a single friend crossing the map re-rendered
 * every other pin, every avatar and every destination flag sixty times a
 * second, all to move one marker. Here a frame costs this subtree and nothing
 * else.
 *
 * Memoised so the other half of the problem is covered too: when the layer
 * *does* re-render -- a fix arriving for someone else, a presence change --
 * only the pin whose data actually changed goes with it. `location` is a fresh
 * object per fix for that friend alone, and `profile` comes from a memoised
 * map, so the comparison is as cheap as it looks.
 */
const FriendPin = memo(function FriendPin({
  location,
  profile,
  isStale,
  surfaceColor,
  textColor,
}: {
  location: FriendLocation;
  profile: Profile;
  isStale: boolean;
  surfaceColor: string;
  textColor: string;
}) {
  const position = useInterpolatedPosition(location);

  return (
    <Marker id={`friend-${location.userId}`} lngLat={position}>
      <View
        style={[
          styles.pin,
          { borderColor: friendColorFor(location.userId), backgroundColor: surfaceColor },
          // Faded rather than removed: a friend whose last fix is going cold
          // still reads as "was here a moment ago" until the hard TTL drops
          // them entirely.
          isStale && styles.stale,
        ]}
      >
        <FriendPinAvatar profile={profile} textColor={textColor} />
      </View>
    </Marker>
  );
});

/** Avatar image when there is one, initials when there isn't -- or when it
 * fails to load, so a broken avatar_url never leaves a blank pin. */
function FriendPinAvatar({ profile, textColor }: { profile: Profile; textColor: string }) {
  const [hasError, setHasError] = useState(false);
  useEffect(() => setHasError(false), [profile.avatar_url]);

  if (profile.avatar_url && !hasError) {
    return (
      <Image
        source={{ uri: profile.avatar_url }}
        style={styles.avatar}
        cachePolicy="memory-disk"
        contentFit="cover"
        onError={() => setHasError(true)}
      />
    );
  }
  return <Text style={[styles.initials, { color: textColor }]}>{initialsOf(profile)}</Text>;
}

const styles = StyleSheet.create({
  pin: {
    width: PIN_SIZE,
    height: PIN_SIZE,
    borderRadius: PIN_SIZE / 2,
    borderWidth: 3,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  stale: {
    opacity: 0.45,
  },
  flag: {
    width: FLAG_SIZE,
    height: FLAG_SIZE,
    borderRadius: FLAG_SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    // No elevation, unlike the friend pin. The flag sits behind its owner in
    // the visual hierarchy and a shadow would argue otherwise.
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  initials: {
    fontSize: 13,
    fontWeight: '700',
  },
});
