import { listStations } from '../engine/graph';
import { haversineMeters } from '../engine/geo';
import type { CompiledStation, LineId } from '../engine/types';

export interface NearestStation {
  name: string;
  distanceMeters: number;
  lines: LineId[];
  stationId: string;
  lat: number;
  lon: number;
}

/** ~1.1 km of latitude, ~0.98 km of longitude at Delhi's latitude. Small
 * enough that a typical query inspects only a handful of stations, large
 * enough that the grid stays sparse. */
const CELL_DEGREES = 0.01;
/** Conservative lower bound on one cell's span in metres, used to decide
 * when expanding another ring can no longer beat the best match found so
 * far. Understating it only costs an extra ring, never correctness. */
const MIN_CELL_METERS = 900;
/** ~2 degrees. Past this the caller is nowhere near the network at all; fall
 * back to a full scan rather than spiralling outward indefinitely. */
const MAX_RINGS = 200;

let grid: Map<string, CompiledStation[]> | null = null;

function cellKey(latCell: number, lonCell: number): string {
  return `${latCell}:${lonCell}`;
}

/** Built once on first use. The station set is compiled at build time and
 * never changes at runtime, so there is nothing to invalidate. */
function getGrid(): Map<string, CompiledStation[]> {
  if (grid) return grid;
  const next = new Map<string, CompiledStation[]>();
  for (const station of listStations()) {
    const key = cellKey(
      Math.floor(station.lat / CELL_DEGREES),
      Math.floor(station.lon / CELL_DEGREES),
    );
    const bucket = next.get(key);
    if (bucket) bucket.push(station);
    else next.set(key, [station]);
  }
  grid = next;
  return next;
}

function toResult(station: CompiledStation, distanceMeters: number): NearestStation {
  return {
    name: station.name,
    distanceMeters,
    lines: station.lines,
    stationId: station.id,
    lat: station.lat,
    lon: station.lon,
  };
}

function scanAll(lat: number, lon: number): NearestStation | null {
  let best: NearestStation | null = null;
  for (const station of listStations()) {
    const distanceMeters = haversineMeters(lat, lon, station.lat, station.lon);
    if (!best || distanceMeters < best.distanceMeters) best = toResult(station, distanceMeters);
  }
  return best;
}

/**
 * Nearest routable station to a coordinate.
 *
 * Backed by a lat/lon grid rather than a scan of every station: this runs
 * per friend per location update (and again for the line/ETA derivations
 * built on top of it), so the linear version was doing a few hundred
 * haversines several times a second once more than a couple of friends were
 * broadcasting.
 *
 * Rings expand outward from the query cell and stop only once another ring
 * could not possibly contain anything closer than the best match so far --
 * so the result is identical to the exhaustive scan, not an approximation.
 */
export function findNearestStation(lat: number, lon: number): NearestStation | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const cells = getGrid();
  const centreLat = Math.floor(lat / CELL_DEGREES);
  const centreLon = Math.floor(lon / CELL_DEGREES);

  let best: NearestStation | null = null;

  for (let ring = 0; ring <= MAX_RINGS; ring++) {
    // Everything in ring N is at least (N-1) cells away from the query
    // point, so once that floor exceeds the current best there is nothing
    // left to find.
    if (best && (ring - 1) * MIN_CELL_METERS > best.distanceMeters) return best;

    for (let dLat = -ring; dLat <= ring; dLat++) {
      for (let dLon = -ring; dLon <= ring; dLon++) {
        // Perimeter only -- inner cells were covered by earlier rings.
        if (ring > 0 && Math.abs(dLat) !== ring && Math.abs(dLon) !== ring) continue;

        const bucket = cells.get(cellKey(centreLat + dLat, centreLon + dLon));
        if (!bucket) continue;

        for (const station of bucket) {
          const distanceMeters = haversineMeters(lat, lon, station.lat, station.lon);
          if (!best || distanceMeters < best.distanceMeters) {
            best = toResult(station, distanceMeters);
          }
        }
      }
    }
  }

  // Nothing within MAX_RINGS -- caller is far outside the network's extent.
  return best ?? scanAll(lat, lon);
}
