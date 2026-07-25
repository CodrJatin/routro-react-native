import { GeoJSONSource, Layer, type GeolocationPosition } from '@maplibre/maplibre-react-native';
import { useMemo } from 'react';
import { useTheme } from '../theme/ThemeProvider';

/** The signed-in user's own position, drawn as real map circle layers.
 *
 * MapLibre's built-in <UserLocation> renders its children inside a
 * GeoJSONSource, so a custom child only shows if it is itself a GL layer --
 * handing it a plain React Native view (an animated pulsing dot) renders
 * nothing, which is why the pin was invisible. Driving our own CircleLayers
 * off a position fix guarantees the pin is always visible whenever one is
 * available, the same mechanism the friend pins use.
 *
 * The fix arrives as a prop rather than from this component's own
 * useCurrentPosition() call: that hook starts a *native* GPS watcher, and
 * calling it here as well as on the map screen registered two of them. The
 * map screen owns the single call and passes the result down. */
export function UserLocationPin({ position }: { position: GeolocationPosition | undefined }) {
  const { colors } = useTheme();
  const currentPosition = position;

  const geojson = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point> | null>(() => {
    if (!currentPosition?.coords) return null;
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: [currentPosition.coords.longitude, currentPosition.coords.latitude],
          },
        },
      ],
    };
  }, [currentPosition?.coords]);

  if (!geojson) return null;

  return (
    <GeoJSONSource id="user-location" data={geojson}>
      {/* Soft halo so the dot reads against tracks and station markers. */}
      <Layer
        id="user-location-halo"
        type="circle"
        paint={{
          'circle-radius': 16,
          'circle-color': colors.accent,
          'circle-opacity': 0.18,
        }}
      />
      <Layer
        id="user-location-dot"
        type="circle"
        paint={{
          'circle-radius': 7,
          'circle-color': colors.accent,
          'circle-stroke-width': 3,
          'circle-stroke-color': '#FFFFFF',
        }}
      />
    </GeoJSONSource>
  );
}
