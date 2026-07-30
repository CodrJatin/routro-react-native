import { Marker } from '@maplibre/maplibre-react-native';
import { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { selectLabelledStations, type LabelViewport } from './stationLabelSelection';

/**
 * Station names, drawn once the camera is close enough for them to be
 * readable. Which stations those are lives in stationLabelSelection.ts.
 *
 * These are `Marker`s (real React Native views) rather than the symbol layer
 * this would normally be. A symbol layer's `text-field` needs glyph PBFs, and
 * the app's default style is the bundled offline one -- it has no `glyphs`
 * endpoint, and adding one would mean the map silently stops labelling the
 * moment it's actually offline, which is the case this app is built for. A
 * view renders from the device's own fonts and works either way.
 *
 * The cost of that choice is per-label view overhead, which is why nothing is
 * drawn until the zoom thresholds are met and only stations inside the current
 * viewport are considered -- the same bounded-count argument FriendsLayer
 * makes.
 *
 * `viewport` is null until the map reports its first region, so labels are
 * simply absent on the first frames; the initial camera sits well below the
 * threshold anyway.
 */
export function StationLabels({ viewport }: { viewport: LabelViewport | null }) {
  const { colors } = useTheme();

  const stations = useMemo(
    () => (viewport ? selectLabelledStations(viewport) : []),
    [viewport],
  );

  if (stations.length === 0) return null;

  return (
    <>
      {stations.map((station) => (
        <Marker
          key={station.id}
          id={`station-label-${station.id}`}
          lngLat={[station.lon, station.lat]}
          // Hung below the dot rather than centred on it, so the label never
          // covers the marker it names.
          anchor="top"
          offset={[0, 8]}
          // Labels must not eat taps: the station circle underneath is what
          // opens the detail card, and a name sitting over a neighbouring
          // station would otherwise swallow that tap.
          pointerEvents="none"
        >
          <Text
            numberOfLines={1}
            pointerEvents="none"
            style={[
              styles.label,
              {
                color: colors.textPrimary,
                // Stands in for a text outline (React Native has no stroke):
                // a halo in the canvas colour keeps the name legible over
                // track lines and basemap tiles alike, in both themes.
                textShadowColor: colors.canvas,
              },
              station.lines.length > 1 && styles.interchangeLabel,
            ]}
          >
            {station.name}
          </Text>
        </Marker>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    lineHeight: 13,
    // Wide enough for the long names ("Jawaharlal Nehru Stadium") without a
    // single label spanning the screen.
    maxWidth: 132,
    textAlign: 'center',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },
  interchangeLabel: {
    fontFamily: 'SpaceMono_700Bold',
    fontSize: 11,
  },
});
