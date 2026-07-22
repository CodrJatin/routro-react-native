import { findShortestPath } from '../engine/dijkstra';
import { getCompiledGraph, getStation } from '../engine/graph';
import type { RouteMode } from '../engine/types';
import { findTrackSegment } from './trackIndex';

export interface RouteSegmentProperties {
  isTransfer: boolean;
  color: string;
}

/** Builds the actual track-shaped polyline for a route (not a straight line
 * between stations), for highlighting on the map after "Go to map". Reuses
 * the same Dijkstra search as the itinerary engine and matches each ride
 * edge back to its track feature by station-pair + line. */
export function buildRoutePolylineGeoJSON(
  originStationId: string,
  destinationStationId: string,
  mode: RouteMode,
): GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties> | null {
  const graph = getCompiledGraph();
  const path = findShortestPath(graph, originStationId, destinationStationId, mode);
  if (!path) return null;

  const features: GeoJSON.Feature<GeoJSON.LineString, RouteSegmentProperties>[] = [];

  for (let i = 0; i < path.edgePath.length; i++) {
    const edge = path.edgePath[i];
    const from = path.nodePath[i];
    const to = edge.to;
    const fromStation = getStation(graph.nodeToStation[from]);
    const toStation = getStation(graph.nodeToStation[to]);
    if (!fromStation || !toStation) continue;

    if (edge.isTransfer) {
      features.push({
        type: 'Feature',
        properties: { isTransfer: true, color: '#9AA5B1' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [fromStation.lon, fromStation.lat],
            [toStation.lon, toStation.lat],
          ],
        },
      });
      continue;
    }

    const color = graph.lines[edge.line!]?.highlightColor ?? '#FFFFFF';
    const segment = findTrackSegment(from, to, edge.line!);
    features.push({
      type: 'Feature',
      properties: { isTransfer: false, color },
      geometry: {
        type: 'LineString',
        coordinates: segment ?? [
          [fromStation.lon, fromStation.lat],
          [toStation.lon, toStation.lat],
        ],
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

/** [west, south, east, north] -- matches MapLibre's LngLatBounds tuple order. */
export function computeBounds(
  geojson: GeoJSON.FeatureCollection<GeoJSON.LineString>,
): [number, number, number, number] | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (const feature of geojson.features) {
    for (const [lon, lat] of feature.geometry.coordinates) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }

  if (!isFinite(minLon)) return null;
  return [minLon, minLat, maxLon, maxLat];
}
