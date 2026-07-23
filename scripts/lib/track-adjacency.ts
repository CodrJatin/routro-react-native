/**
 * Derives the raw station-to-station adjacency from the OSM track geometry.
 *
 * Why this exists: the pre-generated data/osm-graph.json connected each OSM
 * track "way" using only its two endpoint stations. But a single OSM way spans
 * many stations, so every station lying *between* a way's endpoints was
 * dropped -- producing false multi-kilometre "skip" edges (e.g. Moti Nagar ->
 * Dwarka Sector 11, 12 km apart) and scrambling the network into something
 * Dijkstra can only route over nonsensically.
 *
 * Fix: project every station onto the real polyline geometry of each track
 * feature, order the ones it actually passes through by arc-length, and connect
 * consecutive stations. This reconstructs the true fine-grained adjacency.
 * Per-hop travel time is the source way's time distributed proportionally by
 * arc-length, so reported trip times stay faithful to the scraped data.
 */
import { haversineMeters } from '../../src/engine/geo';
import type { RawGraph, RawStations } from '../../src/engine/types';

/** Station kept within STATION_ON_TRACK_METERS of the polyline is treated as
 * lying on that track. Measured worst legitimate case is ~58 m (Janakpuri West,
 * a wide interchange); way endpoints project at ~2 m. 150 m leaves margin
 * without risking attaching an unrelated station -- and the line-membership
 * filter below already excludes stations that don't serve this line. */
const STATION_ON_TRACK_METERS = 150;

/** Fallback cruising speed used only if a way has no source time (~32 km/h). */
const FALLBACK_SPEED_M_PER_S = 9.0;

export interface TrackFeature {
  type: 'Feature';
  properties: {
    id: string;
    startStationId: string;
    endStationId: string;
    lineId: string;
    color: string;
  };
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}

export interface TrackCollection {
  type: 'FeatureCollection';
  features: TrackFeature[];
}

/** Source per-way travel times, keyed "startId|endId" (both directions). */
export type WayTimes = Map<string, number>;

/** Perpendicular distance (m) from point P to segment AB, plus how far along AB
 * (0..1) the closest point falls. Uses a local equirectangular projection
 * centred on P -- accurate at metro-segment scale. */
function projectPointToSegment(
  pLat: number,
  pLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): { dist: number; t: number } {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const cosLat = Math.cos(toRad(pLat));
  const x = (lon: number) => R * toRad(lon) * cosLat;
  const y = (lat: number) => R * toRad(lat);
  const px = x(pLon);
  const py = y(pLat);
  const ax = x(aLon);
  const ay = y(aLat);
  const bx = x(bLon);
  const by = y(bLat);
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return { dist: Math.hypot(px - cx, py - cy), t };
}

/** Cumulative arc-length (m) at each vertex of the polyline. */
function cumulativeArcLength(coords: [number, number][]): number[] {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    const seg = haversineMeters(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
    cum.push(cum[i - 1] + seg);
  }
  return cum;
}

/** Arc-length position (m from start) of a station's closest point on the
 * polyline, plus its perpendicular distance. */
function projectStationOntoPolyline(
  sLat: number,
  sLon: number,
  coords: [number, number][],
  cumLen: number[],
): { arc: number; dist: number } {
  let best = { arc: 0, dist: Infinity };
  for (let i = 1; i < coords.length; i++) {
    const { dist, t } = projectPointToSegment(
      sLat,
      sLon,
      coords[i - 1][1],
      coords[i - 1][0],
      coords[i][1],
      coords[i][0],
    );
    if (dist < best.dist) {
      const segLen = cumLen[i] - cumLen[i - 1];
      best = { arc: cumLen[i - 1] + t * segLen, dist };
    }
  }
  return best;
}

/**
 * Build the corrected raw adjacency from track geometry + stations.
 *
 * @param tracks   parsed data/osm-tracks.geojson
 * @param stations parsed data/osm-stations.json
 * @param wayTimes source per-way travel times (from data/osm-graph.json)
 */
export function buildRawGraphFromTracks(
  tracks: TrackCollection,
  stations: RawStations,
  wayTimes: WayTimes,
): RawGraph {
  const stationIds = Object.keys(stations);

  // Keep the shortest edge found for each unordered same-line pair. A physical
  // adjacency can be covered by more than one overlapping way; the tightest fit
  // wins.
  interface Cand {
    from: string;
    to: string;
    line: string;
    time: number;
    dist: number;
  }
  const bestByPair = new Map<string, Cand>();

  for (const feature of tracks.features) {
    const { lineId, startStationId, endStationId } = feature.properties;
    const coords = feature.geometry.coordinates;
    if (coords.length < 2) continue;

    const cumLen = cumulativeArcLength(coords);
    const wayLen = cumLen[cumLen.length - 1];
    if (wayLen === 0) continue;

    // Stations that (a) serve this line and (b) actually lie on this polyline.
    const onTrack: { id: string; arc: number }[] = [];
    for (const id of stationIds) {
      const s = stations[id];
      if (!s.lines.includes(lineId)) continue;
      const { arc, dist } = projectStationOntoPolyline(s.lat, s.lon, coords, cumLen);
      if (dist <= STATION_ON_TRACK_METERS) onTrack.push({ id, arc });
    }
    if (onTrack.length < 2) continue;

    onTrack.sort((a, b) => a.arc - b.arc);

    // Total time for this whole way, distributed proportionally by arc-length.
    const wayTime =
      wayTimes.get(`${startStationId}|${endStationId}`) ??
      wayTimes.get(`${endStationId}|${startStationId}`);

    for (let i = 1; i < onTrack.length; i++) {
      const a = onTrack[i - 1];
      const b = onTrack[i];
      if (a.id === b.id) continue;
      const hopLen = b.arc - a.arc;
      if (hopLen <= 0) continue;
      const time =
        wayTime !== undefined
          ? Math.max(1, Math.round(wayTime * (hopLen / wayLen)))
          : Math.max(1, Math.round(hopLen / FALLBACK_SPEED_M_PER_S));

      const pairKey = [a.id, b.id].sort().join('|') + '|' + lineId;
      const existing = bestByPair.get(pairKey);
      if (!existing || hopLen < existing.dist) {
        bestByPair.set(pairKey, { from: a.id, to: b.id, line: lineId, time, dist: hopLen });
      }
    }
  }

  // Emit a symmetric directed adjacency, matching the shape of osm-graph.json.
  const graph: RawGraph = {};
  for (const id of stationIds) graph[id] = [];
  for (const c of bestByPair.values()) {
    graph[c.from].push({ to: c.to, time_seconds: c.time, line: c.line });
    graph[c.to].push({ to: c.from, time_seconds: c.time, line: c.line });
  }
  return graph;
}
