import { bearingDegrees, bearingDifference, haversineMeters } from '../engine/geo';
import { getCompiledGraph, getStation } from '../engine/graph';
import type { LineId } from '../engine/types';
import type { NearestStation } from './nearestStation';

/** Below this the friend is effectively stationary (GPS jitter, standing on
 * a platform), and any bearing derived from the two fixes is noise. */
const MIN_MOVEMENT_METERS = 40;
/** A candidate line has to point roughly where the friend is heading. Past
 * this the "match" is meaningless and it's more honest to fall back. */
const MAX_BEARING_DIFFERENCE_DEGREES = 75;

export interface Movement {
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
}

/** Every station directly reachable from `stationId` on `lineId`, as
 * coordinates. Walks the compiled adjacency out of each of the station's
 * platform nodes -- an interchange is several nodes, and only some of them
 * carry the line in question. */
function neighboursOnLine(stationId: string, lineId: LineId): { lat: number; lon: number }[] {
  const graph = getCompiledGraph();
  const station = graph.stations[stationId];
  if (!station) return [];

  const result: { lat: number; lon: number }[] = [];
  for (const platformId of station.platformIds) {
    for (const edge of graph.nodes[platformId] ?? []) {
      if (edge.isTransfer || edge.line !== lineId) continue;
      const neighbour = getStation(graph.nodeToStation[edge.to]);
      if (neighbour && neighbour.id !== stationId) {
        result.push({ lat: neighbour.lat, lon: neighbour.lon });
      }
    }
  }
  return result;
}

/**
 * Which line a friend is most likely riding.
 *
 * Picking `nearest.lines[0]` is a coin flip at an interchange -- at Kashmere
 * Gate that's one of three, chosen by array order. Instead, compare the
 * friend's actual direction of travel against the direction each candidate
 * line leaves the station in, and take the best match.
 *
 * Returns null when there is nothing meaningful to say: not moving, or
 * moving in a direction no line at this station heads. The caller should
 * treat null as "don't show a line badge" rather than substituting a guess.
 */
export function inferCurrentLine(
  nearest: Pick<NearestStation, 'stationId' | 'lines'>,
  movement: Movement | null,
): LineId | null {
  if (nearest.lines.length === 0) return null;
  // Only one line runs through here -- no ambiguity to resolve.
  if (nearest.lines.length === 1) return nearest.lines[0];
  if (!movement) return null;

  const travelled = haversineMeters(
    movement.fromLat,
    movement.fromLon,
    movement.toLat,
    movement.toLon,
  );
  if (travelled < MIN_MOVEMENT_METERS) return null;

  const heading = bearingDegrees(
    movement.fromLat,
    movement.fromLon,
    movement.toLat,
    movement.toLon,
  );

  let bestLine: LineId | null = null;
  let bestDifference = Number.POSITIVE_INFINITY;

  for (const lineId of nearest.lines) {
    for (const neighbour of neighboursOnLine(nearest.stationId, lineId)) {
      const lineBearing = bearingDegrees(
        movement.toLat,
        movement.toLon,
        neighbour.lat,
        neighbour.lon,
      );
      const difference = bearingDifference(heading, lineBearing);
      if (difference < bestDifference) {
        bestDifference = difference;
        bestLine = lineId;
      }
    }
  }

  return bestDifference <= MAX_BEARING_DIFFERENCE_DEGREES ? bestLine : null;
}
