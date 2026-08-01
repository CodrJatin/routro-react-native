import { Ionicons } from '@expo/vector-icons';
import { Marker } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { Profile } from '../auth/AuthProvider';
import { useAuth } from '../auth/AuthProvider';
import { friendColorFor } from '../friends/friendColor';
import { useFriendJourneys } from '../friends/friendJourney';
import { useFriendshipsContext } from '../friends/FriendshipsProvider';
import { otherParty } from '../friends/useFriendships';
import { useFriendStatuses, useLocationStore } from '../realtime/locationStore';
import { useTheme } from '../theme/ThemeProvider';
import { useInterpolatedPositions } from './useInterpolatedPositions';

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
        // 'offline' covers both "presence says they stopped" and "past the
        // hard TTL" -- either way the pin goes, rather than lingering dimmed
        // at a last known position forever.
        .filter((loc) => statuses[loc.userId] !== 'offline' && profilesByUserId.has(loc.userId))
        .map((loc) => ({
          location: loc,
          profile: profilesByUserId.get(loc.userId)!,
          isStale: statuses[loc.userId] === 'stale',
        })),
    [friendLocations, statuses, profilesByUserId],
  );

  const positions = useInterpolatedPositions(pins.map((pin) => pin.location));

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
        <Marker
          key={location.userId}
          id={`friend-${location.userId}`}
          lngLat={positions[location.userId] ?? [location.lon, location.lat]}
        >
          <View
            style={[
              styles.pin,
              {
                borderColor: friendColorFor(location.userId),
                backgroundColor: colors.surface,
              },
              // Faded rather than removed: a friend whose last fix is going
              // cold still reads as "was here a moment ago" until the hard
              // TTL drops them entirely.
              isStale && styles.stale,
            ]}
          >
            <FriendPinAvatar profile={profile} textColor={colors.textPrimary} />
          </View>
        </Marker>
      ))}
    </>
  );
}

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
