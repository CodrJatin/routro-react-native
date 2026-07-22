import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useLocationStore, type FriendLocation } from '../realtime/locationStore';
import { colors } from '../theme/colors';

const STALE_AFTER_MS = 30_000;
const STALE_CHECK_INTERVAL_MS = 10_000;

interface FriendPointProperties {
  userId: string;
  isStale: boolean;
}

function buildGeoJSON(
  friendLocations: Record<string, FriendLocation>,
  now: number,
): GeoJSON.FeatureCollection<GeoJSON.Point, FriendPointProperties> {
  return {
    type: 'FeatureCollection',
    features: Object.values(friendLocations).map((loc) => ({
      type: 'Feature',
      properties: { userId: loc.userId, isStale: now - loc.ts > STALE_AFTER_MS },
      geometry: { type: 'Point', coordinates: [loc.lon, loc.lat] },
    })),
  };
}

/** Renders live friend positions as a single GeoJSON source driven by the
 * Zustand location store, subscribed via a selector so a location tick only
 * re-renders this leaf component -- not the map canvas, tracks, or stations
 * layers above it. Markers jump discretely between broadcast intervals
 * rather than gliding: smooth interpolation would mean per-friend Reanimated
 * views, which reintroduces the RN-view-marker cost this design avoids. */
export function FriendsLayer() {
  const friendLocations = useLocationStore((state) => state.friendLocations);
  const hasFriendLocations = Object.keys(friendLocations).length > 0;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!hasFriendLocations) return;
    const interval = setInterval(() => setNow(Date.now()), STALE_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [hasFriendLocations]);

  const geojson = useMemo(() => buildGeoJSON(friendLocations, now), [friendLocations, now]);

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
