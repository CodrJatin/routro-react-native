import tracksGeoJSON from '../../assets/data/tracks.json';

interface TrackFeature {
  properties: { startStationId: string; endStationId: string; lineId: string; hop?: boolean };
  geometry: { coordinates: [number, number][] };
}

const segmentsByKey = new Map<string, [number, number][]>();

function key(a: string, b: string, line: string): string {
  return `${a}|${b}|${line}`;
}

const tracks = tracksGeoJSON as unknown as { features: TrackFeature[] };
for (const feature of tracks.features) {
  // `hop` features span exactly one station-to-station hop; everything else in
  // the asset is a head/tail stub or an unsplit way, whose endpoint ids are
  // *not* adjacent stations. Indexing those was the bug: a way labelled
  // A -> Z covers a dozen stations, so it neither answered the hops in between
  // nor was a legitimate answer for A -> Z. See scripts/compile-tracks.ts.
  if (!feature.properties.hop) continue;
  const { startStationId, endStationId, lineId } = feature.properties;
  const coords = feature.geometry.coordinates;
  segmentsByKey.set(key(startStationId, endStationId, lineId), coords);
  segmentsByKey.set(key(endStationId, startStationId, lineId), [...coords].reverse());
}

/** Real track polyline for a ride edge, in the direction traveled. Every ride
 * edge in the compiled graph has one -- both come from the same projection of
 * stations onto the OSM ways, and __tests__/trackIndex.test.ts holds them to
 * it. The straight-line fallback in routePolyline.ts is kept for data that
 * regresses, not for the network as it stands. */
export function findTrackSegment(
  from: string,
  to: string,
  line: string,
): [number, number][] | undefined {
  return segmentsByKey.get(key(from, to, line));
}
