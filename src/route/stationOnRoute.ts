import type { ItineraryLeg, LineId, RouteResult, StationId } from '../engine/types';

/**
 * Arrival offsets for a leg's intermediate stations, given when the leg was
 * boarded.
 *
 * Legs carry one total ride time, not per-hop times, so the stops in between
 * are placed by even division across the leg's hops -- boarding and alighting
 * are the only exact ones. Everything that times a station goes through here,
 * so the itinerary's expanded stops, the flattened journey sequence and the
 * map's station card can't drift apart.
 */
export function legStopOffsets(leg: ItineraryLeg, boardingOffsetSeconds: number): number[] {
  const hops = leg.intermediateStations.length + 1;
  return leg.intermediateStations.map(
    (_, i) => boardingOffsetSeconds + (leg.legTimeSeconds * (i + 1)) / hops,
  );
}

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

    const stopOffsets = legStopOffsets(leg, offset);
    for (let i = 0; i < leg.intermediateStations.length; i++) {
      if (leg.intermediateStations[i].stationId === stationId) {
        return position(stopOffsets[i], stops + i + 1, leg.line, route, stationId);
      }
    }

    offset += leg.legTimeSeconds;
    stops += leg.intermediateStations.length + 1;

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
