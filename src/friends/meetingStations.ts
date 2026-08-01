import type { RouteResult, StationId } from '../engine/types';
import { routeClockMs, type RouteClock } from '../route/routeClock';
import {
  buildRouteStationSequence,
  type RouteProgress,
  type RouteStation,
} from '../route/routeProgress';

/** A station both journeys still call at, offered as somewhere the two could
 * meet. Times are absolute ms on THIS device's clock, or null when the
 * corresponding side has no live clock to quote from. */
export interface MeetingStation {
  stationId: StationId;
  stationName: string;
  /** Position in the viewer's own journey -- what the list is ordered by. */
  selfIndex: number;
  /** How many stops the viewer still has to go to reach it. */
  selfStopsAway: number;
  friendStopsAway: number;
  selfArrivalMs: number | null;
  friendArrivalMs: number | null;
  /**
   * How long the first to arrive waits, in ms, or null if either time is
   * unknown. Always positive -- who does the waiting is `whoWaits`.
   */
  waitMs: number | null;
  whoWaits: 'self' | 'friend' | null;
}

export interface MeetingSide {
  route: RouteResult;
  /** Where that person is along it. Null means "we don't know", which is
   * treated as nothing being behind them yet -- see `eligibleStations`. */
  progress: RouteProgress | null;
  clock: RouteClock | null;
}

/**
 * The stations where two journeys still cross.
 *
 * Deliberately every option rather than a recommendation. Which one is *best*
 * depends on things the app cannot see -- who is in more of a hurry, which end
 * of the city they actually want to end up at, whether one of them is carrying
 * something heavy -- so the honest move is to lay out the crossings with the
 * facts attached (how far each person is, when each arrives, who waits) and let
 * the two people decide.
 *
 * Ordered by the viewer's own travel order, which is the order they will
 * physically reach them, not by any notion of quality.
 */
export function findMeetingStations(self: MeetingSide, friend: MeetingSide): MeetingStation[] {
  const selfSequence = self.progress?.sequence ?? buildRouteStationSequence(self.route);
  const friendSequence = friend.progress?.sequence ?? buildRouteStationSequence(friend.route);

  const friendAhead = eligibleStations(friendSequence, friend.progress);
  const selfAhead = eligibleStations(selfSequence, self.progress);

  const selfNearestIndex = self.progress?.nearestIndex ?? 0;
  const friendNearestIndex = friend.progress?.nearestIndex ?? 0;

  const result: MeetingStation[] = [];

  for (const station of selfAhead.values()) {
    const friendStation = friendAhead.get(station.stationId);
    if (!friendStation) continue;

    const selfArrivalMs = self.clock ? routeClockMs(self.clock, station.offsetSeconds) : null;
    const friendArrivalMs = friend.clock
      ? routeClockMs(friend.clock, friendStation.offsetSeconds)
      : null;

    const hasBoth = selfArrivalMs !== null && friendArrivalMs !== null;
    const waitMs = hasBoth ? Math.abs(selfArrivalMs - friendArrivalMs) : null;

    result.push({
      stationId: station.stationId,
      stationName: station.stationName,
      selfIndex: station.index,
      selfStopsAway: Math.max(0, station.index - selfNearestIndex),
      friendStopsAway: Math.max(0, friendStation.index - friendNearestIndex),
      selfArrivalMs,
      friendArrivalMs,
      waitMs,
      // The one who gets there first is the one who waits.
      whoWaits: hasBoth
        ? selfArrivalMs === friendArrivalMs
          ? null
          : selfArrivalMs < friendArrivalMs
            ? 'self'
            : 'friend'
        : null,
    });
  }

  // Already in the viewer's travel order: `eligibleStations` iterates the
  // sequence in order and Map preserves insertion order.
  return result;
}

/**
 * The stations a person can still get to, keyed by station id.
 *
 * `>=` rather than `>`: the station someone is standing at right now is a
 * perfectly good place to be met, and excluding it would drop the most obvious
 * option in the case where one person has already arrived somewhere the other
 * is heading.
 *
 * The first eligible occurrence wins, so a route that doubles back through a
 * station is offered at the next time it calls there, not the last.
 */
function eligibleStations(
  sequence: RouteStation[],
  progress: RouteProgress | null,
): Map<StationId, RouteStation> {
  const from = progress?.nearestIndex ?? 0;
  const map = new Map<StationId, RouteStation>();
  for (const station of sequence) {
    if (station.index < from) continue;
    if (!map.has(station.stationId)) map.set(station.stationId, station);
  }
  return map;
}
