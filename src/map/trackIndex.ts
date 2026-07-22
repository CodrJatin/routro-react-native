import tracksGeoJSON from '../../assets/data/tracks.json';

interface TrackFeature {
  properties: { startStationId: string; endStationId: string; lineId: string };
  geometry: { coordinates: [number, number][] };
}

const segmentsByKey = new Map<string, [number, number][]>();

function key(a: string, b: string, line: string): string {
  return `${a}|${b}|${line}`;
}

const tracks = tracksGeoJSON as unknown as { features: TrackFeature[] };
for (const feature of tracks.features) {
  const { startStationId, endStationId, lineId } = feature.properties;
  const coords = feature.geometry.coordinates;
  segmentsByKey.set(key(startStationId, endStationId, lineId), coords);
  segmentsByKey.set(key(endStationId, startStationId, lineId), [...coords].reverse());
}

/** Real track polyline for a ride edge, in the direction traveled -- falls
 * back to a straight line (in routePolyline.ts) when a pair has no matching
 * track feature (only expected for the small number of long/gap edges
 * flagged in the graph compiler's lint report). */
export function findTrackSegment(
  from: string,
  to: string,
  line: string,
): [number, number][] | undefined {
  return segmentsByKey.get(key(from, to, line));
}
