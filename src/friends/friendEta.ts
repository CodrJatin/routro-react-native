import { findRoute } from '../engine/graph';
import { findNearestStation } from './nearestStation';

/** Past this the person isn't meaningfully "at" a station, so a station-to-
 * station ride estimate would be quoting a journey they aren't taking. */
const MAX_STATION_DISTANCE_METERS = 1500;

export interface FriendEta {
  stops: number;
  minutes: number;
}

/**
 * Roughly how far a friend is from you *in metro terms* -- stops and
 * minutes, not straight-line kilometres.
 *
 * This is the question the app is actually for: both positions are known,
 * the routing engine is already bundled, and "4 stops away, ~11 min" is far
 * more useful than a dot on a map. Returns null whenever either party is too
 * far from the network for the answer to mean anything.
 */
export function estimateFriendEta(
  selfLat: number,
  selfLon: number,
  friendLat: number,
  friendLon: number,
): FriendEta | null {
  const from = findNearestStation(selfLat, selfLon);
  const to = findNearestStation(friendLat, friendLon);
  if (!from || !to) return null;
  if (
    from.distanceMeters > MAX_STATION_DISTANCE_METERS ||
    to.distanceMeters > MAX_STATION_DISTANCE_METERS
  ) {
    return null;
  }
  if (from.stationId === to.stationId) return { stops: 0, minutes: 0 };

  const route = findRoute(from.stationId, to.stationId, 'fastest');
  if (!route) return null;

  return {
    // stationsPassed counts both endpoints; the number of hops between them
    // is one fewer.
    stops: Math.max(1, route.stationsPassed - 1),
    minutes: Math.max(1, Math.round(route.totalTimeSeconds / 60)),
  };
}
