import type { LineId, RouteResult, StationId } from '../engine/types';

export interface StationRoutePosition {
  /** Seconds from the start of the journey to arriving here. */
  offsetSeconds: number;
  /** How many stops in from the origin, origin itself being 0. */
  stopsFromOrigin: number;
  line: LineId;
  isOrigin: boolean;
  isDestination: boolean;
}

/**
 * Where a station falls on a journey, or null if the journey doesn't call
 * there. Times accumulate the same way buildRouteStationSequence does --
 * transfer time first, then the ride -- so the map card and the itinerary
 * can't disagree about when you arrive somewhere.
 *
 * Legs only carry a total ride time, not per-hop times, so a station in the
 * middle of a leg is placed by even division across that leg's hops. Boarding
 * and alighting stations are exact.
 */
export function findStationOnRoute(
  route: RouteResult,
  stationId: StationId,
): StationRoutePosition | null {
  let offset = 0;
  let stops = 0;

  for (const leg of route.legs) {
    offset += leg.transferSecondsBefore;

    if (leg.boardingStation.stationId === stationId) {
      return position(offset, stops, leg.line, route, stationId);
    }

    const hops = leg.intermediateStations.length + 1;
    for (let i = 0; i < leg.intermediateStations.length; i++) {
      if (leg.intermediateStations[i].stationId === stationId) {
        return position(
          offset + (leg.legTimeSeconds * (i + 1)) / hops,
          stops + i + 1,
          leg.line,
          route,
          stationId,
        );
      }
    }

    offset += leg.legTimeSeconds;
    stops += hops;

    if (leg.alightingStation.stationId === stationId) {
      return position(offset, stops, leg.line, route, stationId);
    }
  }

  return null;
}

function position(
  offsetSeconds: number,
  stopsFromOrigin: number,
  line: LineId,
  route: RouteResult,
  stationId: StationId,
): StationRoutePosition {
  return {
    offsetSeconds,
    stopsFromOrigin,
    line,
    isOrigin: stationId === route.originStationId,
    isDestination: stationId === route.destinationStationId,
  };
}
