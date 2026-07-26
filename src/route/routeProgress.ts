import { haversineMeters } from '../engine/geo';
import type { RouteResult, StationId } from '../engine/types';

/**
 * Past this from every station on the journey, the user isn't travelling it --
 * they're planning it from home, or looking at someone else's city. Marking
 * half a route "passed" on that basis would be a confident lie, so progress
 * is simply withheld. Matches the threshold friendEta.ts uses to decide
 * someone is "at" a station at all.
 */
export const MAX_ON_ROUTE_DISTANCE_METERS = 1500;

export interface RouteStation {
  stationId: StationId;
  stationName: string;
  lat: number;
  lon: number;
  /** Which leg this station belongs to. */
  legIndex: number;
  /** Position in travel order; 0 is the trip origin. */
  index: number;
  /** Seconds from the start of the journey to arriving here. Offsets are only
   * meaningful relative to each other -- what wall clock they're pinned to is
   * decided by `useRouteClock`. */
  offsetSeconds: number;
}

export type RouteStationMark = 'passed' | 'current' | 'upcoming';

export interface RouteProgress {
  /** Every station the journey calls at, in travel order. */
  sequence: RouteStation[];
  /** Index into `sequence` of the station the user is nearest to. */
  nearestIndex: number;
  nearestStationId: StationId;
  distanceMeters: number;
  /** Stations strictly before the nearest one -- the ones already behind you. */
  passedStationIds: Set<StationId>;
}

/**
 * The journey's stations flattened into one ordered list.
 *
 * Legs overlap at interchanges: leg N alights where leg N+1 boards. When
 * that's the same station (a cross-platform change) it must appear once, or
 * every index after it is off by one and the walking transfers -- where the
 * two really are different stations -- would be indistinguishable. The one
 * copy that survives keeps its *arrival* offset, so the transfer that follows
 * is paid by the stations after it, exactly as the itinerary's clock reads it.
 */
export function buildRouteStationSequence(route: RouteResult): RouteStation[] {
  const sequence: RouteStation[] = [];

  const push = (
    step: { stationId: StationId; stationName: string; lat: number; lon: number },
    legIndex: number,
    offsetSeconds: number,
  ) => {
    const last = sequence[sequence.length - 1];
    if (last && last.stationId === step.stationId) return;
    sequence.push({
      stationId: step.stationId,
      stationName: step.stationName,
      lat: step.lat,
      lon: step.lon,
      legIndex,
      index: sequence.length,
      offsetSeconds,
    });
  };

  let offsetSeconds = 0;

  route.legs.forEach((leg, legIndex) => {
    offsetSeconds += leg.transferSecondsBefore;
    push(leg.boardingStation, legIndex, offsetSeconds);

    // Legs carry one total ride time, not per-hop times, so a station in the
    // middle of a leg is placed by even division across that leg's hops.
    // Boarding and alighting stations are exact. Same rule findStationOnRoute
    // uses, so the map card and the itinerary can't disagree.
    const hops = leg.intermediateStations.length + 1;
    leg.intermediateStations.forEach((station, i) => {
      push(station, legIndex, offsetSeconds + (leg.legTimeSeconds * (i + 1)) / hops);
    });

    offsetSeconds += leg.legTimeSeconds;
    push(leg.alightingStation, legIndex, offsetSeconds);
  });

  return sequence;
}

/** Nearest station *on this journey* -- deliberately not the nearest station
 * on the network, which for someone mid-route is frequently a station on a
 * different line they happen to be passing under. */
export function findNearestRouteStation(
  sequence: RouteStation[],
  lat: number,
  lon: number,
): { index: number; distanceMeters: number } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  let bestIndex = -1;
  let bestDistance = Infinity;
  for (const station of sequence) {
    const distance = haversineMeters(lat, lon, station.lat, station.lon);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = station.index;
    }
  }

  if (bestIndex < 0) return null;
  return { index: bestIndex, distanceMeters: bestDistance };
}

/**
 * Where the user is along the active journey, or null when that can't be
 * answered honestly (no fix, or nowhere near the route).
 *
 * Stateless by design: the answer is recomputed from the current fix rather
 * than latched to the furthest station ever reached, so travelling back the
 * way you came, or being handed a different route, is just the next answer
 * rather than a stuck one. The cost is that standing exactly between two
 * stations can flip the boundary by one as fixes jitter.
 */
export function getRouteProgress(
  route: RouteResult | null,
  position: { lat: number; lon: number } | null,
): RouteProgress | null {
  if (!route || !position) return null;

  const sequence = buildRouteStationSequence(route);
  const nearest = findNearestRouteStation(sequence, position.lat, position.lon);
  if (!nearest || nearest.distanceMeters > MAX_ON_ROUTE_DISTANCE_METERS) return null;

  const passedStationIds = new Set<StationId>();
  for (const station of sequence) {
    if (station.index < nearest.index) passedStationIds.add(station.stationId);
  }
  // A route that calls at the same station twice (a backtrack, or a loop)
  // would otherwise show it as passed while you're still standing at it.
  // Anything still ahead outranks its earlier appearance.
  for (const station of sequence) {
    if (station.index >= nearest.index) passedStationIds.delete(station.stationId);
  }

  return {
    sequence,
    nearestIndex: nearest.index,
    nearestStationId: sequence[nearest.index].stationId,
    distanceMeters: nearest.distanceMeters,
    passedStationIds,
  };
}

/** Per-station lookup for the itinerary, which renders by station rather than
 * by index. */
export function buildStationMarks(progress: RouteProgress | null): Map<StationId, RouteStationMark> {
  const marks = new Map<StationId, RouteStationMark>();
  if (!progress) return marks;

  // Precedence matters only for a station the route calls at twice: being
  // there now beats both, and still having to come back beats having been.
  const rank: Record<RouteStationMark, number> = { passed: 0, upcoming: 1, current: 2 };

  for (const station of progress.sequence) {
    const mark: RouteStationMark =
      station.index < progress.nearestIndex
        ? 'passed'
        : station.index === progress.nearestIndex
          ? 'current'
          : 'upcoming';
    const existing = marks.get(station.stationId);
    if (!existing || rank[mark] > rank[existing]) marks.set(station.stationId, mark);
  }

  return marks;
}
