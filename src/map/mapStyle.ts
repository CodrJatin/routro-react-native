import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { ThemeMode } from '../theme/tokens';

export const DELHI_CENTER: [number, number] = [77.209, 28.6139];
export const DEFAULT_ZOOM = 10.5;

/** CARTO's OSM-derived vector styles, one per theme so an enabled basemap
 * follows the app's light/dark setting instead of fighting it. Dark Matter and
 * Positron are the same family, so the two modes stay visually consistent.
 *
 * The `nolabels` variants are the same styles with every symbol layer removed
 * upstream. Preferred over fetching the style and filtering the layers here:
 * that would mean parsing it in JS and handing MapLibre an object, giving up
 * the native download/parse/cache path below for a result CARTO already
 * publishes.
 *
 * Passed to MapLibre as plain URLs rather than fetched and parsed here: the
 * native side then owns downloading, parsing and caching the style, including
 * the glyph/sprite endpoints the style points at. */
const BASEMAP_STYLE_URLS: Record<ThemeMode, Record<'labelled' | 'plain', string>> = {
  dark: {
    labelled: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    plain: 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json',
  },
  light: {
    labelled: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    plain: 'https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json',
  },
};

/** Required whenever CARTO's tiles are on screen. Rendered through MapLibre's
 * own attribution control -- see the `attribution` prop on the map. */
export const BASEMAP_ATTRIBUTION = '© OpenStreetMap, © CARTO';

/** No basemap tiles are bundled (none were part of the provided /data), so with
 * the basemap setting off the "map" is just our own metro sources/layers over a
 * flat background -- this is what makes the map screen work fully offline, and
 * it stays the default.
 *
 * Takes the current theme's background color so the offline canvas matches
 * light/dark mode instead of being hardcoded. */
export function getEmptyOfflineStyle(backgroundColor: string): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': backgroundColor },
      },
    ],
  };
}

export interface MapStyleOptions {
  /** The user's Settings choice. False keeps the map fully offline. */
  basemapEnabled: boolean;
  /** Whether the basemap draws its own place names. Off leaves the streets and
   * water in place but hands the naming of anything on the map to the app's
   * own station labels, which is the point -- the two sets of text land on top
   * of each other around exactly the interchanges that are hardest to read.
   * Ignored when the basemap is off; that style has no labels to begin with. */
  placeLabelsEnabled: boolean;
  /** Resolved theme mode -- picks which CARTO style to use. */
  mode: ThemeMode;
  /** Canvas color for the offline style. */
  backgroundColor: string;
}

/** The style the map screen renders. A string (a CARTO style URL) when the
 * basemap is on, the bundled offline style object when it's off -- MapLibre's
 * `mapStyle` prop accepts either, so callers don't need to branch.
 *
 * The metro sources/layers are added as children of the map, which puts them
 * above every layer the basemap style brings with it. */
export function getMapStyle({
  basemapEnabled,
  placeLabelsEnabled,
  mode,
  backgroundColor,
}: MapStyleOptions): string | StyleSpecification {
  if (!basemapEnabled) return getEmptyOfflineStyle(backgroundColor);
  return BASEMAP_STYLE_URLS[mode][placeLabelsEnabled ? 'labelled' : 'plain'];
}
