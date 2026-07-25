import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';

export const DELHI_CENTER: [number, number] = [77.209, 28.6139];
export const DEFAULT_ZOOM = 10.5;

/** No basemap tiles are bundled (none were part of the provided /data), so
 * the "map" is just our own metro sources/layers over a flat background --
 * this is what makes the map screen work fully offline. A real basemap
 * (bundled MBTiles or self-hosted vector tiles) is a follow-up, not
 * something to fake with a network dependency here.
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
