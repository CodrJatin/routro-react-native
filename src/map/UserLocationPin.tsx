import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useReducer } from 'react';
import { SELF_POSITION_STALE_AFTER_MS, type SelfPosition } from '../location/selfPosition';
import { useTheme } from '../theme/ThemeProvider';
import { glideAt, type Glide } from './glide';
import { useGlideFrames } from './useGlideFrames';

/** How often the pin re-checks whether its fix has gone stale. Only matters
 * while nothing is moving -- a gliding pin is already re-rendering per frame. */
const STALENESS_TICK_MS = 5000;

/** The signed-in user's own position, drawn as real map circle layers.
 *
 * MapLibre's built-in <UserLocation> renders its children inside a
 * GeoJSONSource, so a custom child only shows if it is itself a GL layer --
 * handing it a plain React Native view (an animated pulsing dot) renders
 * nothing, which is why the pin was invisible. Driving our own CircleLayers
 * off a position fix guarantees the pin is always visible whenever one is
 * available, the same mechanism the friend pins use.
 *
 * The fix comes from `useSelfPositionStore` via the map screen, not from
 * MapLibre's `useCurrentPosition()`. That hook runs MapLibre's own native
 * location engine, which is a second GPS consumer alongside the ones this app
 * already runs, reports nothing when it fails, and is not the engine that
 * demonstrably keeps working underground. Everything else on this screen was
 * already reading the shared store; now the pin does too, so the dot and the
 * stations it has passed can no longer disagree.
 *
 * `afterId` on both layers is not cosmetic. MapLibre RN re-adds every source
 * in hash-map order after a style reload (a basemap or theme switch), so a
 * layer with no anchor lands at an arbitrary depth -- which is how the pin
 * ended up underneath the track lines. Anchoring it to the topmost of our own
 * layers pins the order down in every case.
 */
export function UserLocationPin({ position }: { position: SelfPosition | null }) {
  const { colors } = useTheme();

  const glide = useMemo<Glide | null>(() => {
    if (!position) return null;
    return {
      from: position.previous,
      to: { lat: position.lat, lon: position.lon },
      fromAt: position.previous?.movedAt ?? position.movedAt,
      toAt: position.movedAt,
    };
  }, [position]);

  const glides = useMemo(() => (glide ? [glide] : []), [glide]);
  useGlideFrames(glides);

  const isStale = useIsStale(position);

  if (!glide) return null;

  // Deliberately not memoised: `useGlideFrames` re-renders this component once
  // per frame while the pin is moving, and the render *is* the clock -- a memo
  // would have to be keyed on the time it was trying to read.
  const geojson: GeoJSON.FeatureCollection<GeoJSON.Point> = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: glideAt(glide, Date.now()) },
      },
    ],
  };

  return (
    <GeoJSONSource id="user-location" data={geojson}>
      {/* Soft halo so the dot reads against tracks and station markers. */}
      <Layer
        id="user-location-halo"
        type="circle"
        afterId="route-passed-circle"
        paint={{
          'circle-radius': 16,
          'circle-color': colors.accent,
          'circle-opacity': isStale ? 0.08 : 0.18,
        }}
      />
      {/* Faded rather than hidden when the fix has gone cold -- the same
          treatment a friend's pin gets. A frozen dot at full strength is the
          map claiming to know where you are when it has not heard from GPS
          in half a minute, which in a tunnel is most of the journey. */}
      <Layer
        id="user-location-dot"
        type="circle"
        afterId="user-location-halo"
        paint={{
          'circle-radius': 7,
          'circle-color': colors.accent,
          'circle-opacity': isStale ? 0.45 : 1,
          'circle-stroke-width': 3,
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-opacity': isStale ? 0.45 : 1,
        }}
      />
    </GeoJSONSource>
  );
}

/** Whether the fix on screen has gone quiet. Measured against `at` (when the
 * fix was taken), so a last-known position seeded from the OS cache reads as
 * stale immediately rather than posing as a live one. */
function useIsStale(position: SelfPosition | null): boolean {
  const [, tick] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    const handle = setInterval(tick, STALENESS_TICK_MS);
    return () => clearInterval(handle);
  }, []);

  if (!position) return false;
  return Date.now() - position.at > SELF_POSITION_STALE_AFTER_MS;
}
