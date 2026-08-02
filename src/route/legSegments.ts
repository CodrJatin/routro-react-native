import type { ItineraryStep, StationId } from '../engine/types';
import type { RouteStationMark } from './routeProgress';

/**
 * A meeting agreed with a friend, as the itinerary needs to know it.
 *
 * Deliberately just a station and a sentence, rather than the meet record
 * itself: the itinerary's job is to draw the journey, and everything about who
 * is meeting whom and how long the wait is has already been decided by
 * `useMeetMarkers`. Keeping it to two fields is also what keeps the route
 * layer from importing the friends layer.
 */
export interface ItineraryMeet {
  stationId: StationId;
  /** e.g. "Wait 11 min for Aditi". */
  label: string;
}

/** One collapsible group of ordinary stops, and the pinned stop that closes
 * it. The last segment of a leg has no pinned stop -- it is whatever is left
 * between the final pinned one and the end of the leg. */
export interface LegSegment {
  /** Indices into the leg's `intermediateStations`. */
  stops: number[];
  pinnedIndex: number | null;
}

/**
 * Splits a leg's in-between stops around the ones that must always be visible.
 *
 * A stop is pinned when the user is standing at it or has agreed to meet
 * someone there -- both are stops they need to see without going looking, and
 * both are ordinary in-between stops on all but the few hops that start or end
 * a leg. Everything else folds into the group before or after them, and each
 * group gets its own "show N in between".
 *
 * That is the whole point of splitting rather than listing: with one group per
 * leg, a pinned stop could only be drawn after all the collapsed ones, which
 * put it directly above the interchange and made it read as the last station
 * before it.
 *
 * With nothing pinned this returns a single group holding the whole leg, which
 * is the ordinary case.
 */
export function buildLegSegments(
  stations: ItineraryStep[],
  marks: Map<StationId, RouteStationMark>,
  meets: Map<StationId, ItineraryMeet>,
): LegSegment[] {
  const segments: LegSegment[] = [];
  let stops: number[] = [];

  stations.forEach((station, index) => {
    const isPinned = marks.get(station.stationId) === 'current' || meets.has(station.stationId);
    if (isPinned) {
      segments.push({ stops, pinnedIndex: index });
      stops = [];
      return;
    }
    stops.push(index);
  });

  segments.push({ stops, pinnedIndex: null });
  return segments;
}
