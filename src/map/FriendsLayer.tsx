import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { useMemo } from 'react';
import { useFriendStatuses, useLocationStore, type FriendLocation, type FriendStatus } from '../realtime/locationStore';
import { useTheme } from '../theme/ThemeProvider';

interface FriendPointProperties {
  userId: string;
  isStale: boolean;
}

function buildGeoJSON(
  friendLocations: Record<string, FriendLocation>,
  statuses: Record<string, FriendStatus>,
): GeoJSON.FeatureCollection<GeoJSON.Point, FriendPointProperties> {
  return {
    type: 'FeatureCollection',
    // 'offline' covers both "presence says not broadcasting" (already
    // cleared out of friendLocations by the store) and "past the hard TTL"
    // (a friend who died without ever sending a presence event) -- either
    // way the pin is dropped rather than dimmed forever.
    features: Object.values(friendLocations)
      .filter((loc) => statuses[loc.userId] !== 'offline')
      .map((loc) => ({
        type: 'Feature',
        properties: { userId: loc.userId, isStale: statuses[loc.userId] === 'stale' },
        geometry: { type: 'Point', coordinates: [loc.lon, loc.lat] },
      })),
  };
}

/** Renders live friend positions as a single GeoJSON source driven by the
 * Zustand location store, subscribed via a selector so a location tick only
 * re-renders this leaf component -- not the map canvas, tracks, or stations
 * layers above it. Markers jump discretely between broadcast intervals
 * rather than gliding: smooth interpolation would mean per-friend Reanimated
 * views, which reintroduces the RN-view-marker cost this design avoids.
 *
 * Staleness/offline-dropping comes from the single shared `useFriendStatuses`
 * selector (see locationStore.ts) rather than a local staleness constant and
 * `setInterval` -- this is what keeps the map and the Friends tab from ever
 * disagreeing about the same person again. */
export function FriendsLayer() {
  const { colors } = useTheme();
  const friendLocations = useLocationStore((state) => state.friendLocations);
  const statuses = useFriendStatuses();

  const geojson = useMemo(() => buildGeoJSON(friendLocations, statuses), [friendLocations, statuses]);

  return (
    <GeoJSONSource id="friends" data={geojson}>
      <Layer
        id="friends-circle"
        type="circle"
        paint={{
          'circle-radius': 10,
          'circle-color': colors.success,
          'circle-opacity': ['case', ['get', 'isStale'], 0.35, 1],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#FFFFFF',
        }}
      />
    </GeoJSONSource>
  );
}
