import { describe, expect, it } from 'vitest';
import { haversineMeters } from '../../engine/geo';
import { findRoute, getStation, listStations } from '../../engine/graph';
import type { RouteResult } from '../../engine/types';
import { findStationOnRoute } from '../stationOnRoute';
import {
  buildRouteStationSequence,
  buildStationMarks,
  getRouteProgress,
  MAX_ON_ROUTE_DISTANCE_METERS,
} from '../routeProgress';

/** A long cross-city journey with at least one interchange, so the sequence
 * has legs to join up rather than being one straight ride. */
function crossCityRoute(): RouteResult {
  const route = findRoute('rithala', 'botanical-garden', 'fastest');
  if (!route) throw new Error('fixture route no longer exists in the compiled graph');
  return route;
}

function positionOf(stationId: string) {
  const station = getStation(stationId);
  if (!station) throw new Error(`unknown station ${stationId}`);
  return { lat: station.lat, lon: station.lon };
}

describe('buildRouteStationSequence', () => {
  const route = crossCityRoute();
  const sequence = buildRouteStationSequence(route);

  it('starts at the origin and ends at the destination', () => {
    expect(sequence[0].stationId).toBe(route.originStationId);
    expect(sequence[sequence.length - 1].stationId).toBe(route.destinationStationId);
  });

  it('never repeats a station back to back across an interchange', () => {
    // Leg N alights where leg N+1 boards. Listing that station twice would
    // push every later index out by one.
    const repeats = sequence.filter((s, i) => i > 0 && sequence[i - 1].stationId === s.stationId);
    expect(repeats).toEqual([]);
  });

  it('numbers stations in travel order with no gaps', () => {
    expect(sequence.map((s) => s.index)).toEqual(sequence.map((_, i) => i));
  });

  it('times the origin at zero and the destination at the journey total', () => {
    expect(sequence[0].offsetSeconds).toBe(0);
    expect(sequence[sequence.length - 1].offsetSeconds).toBeCloseTo(route.totalTimeSeconds, 6);
  });

  it('never travels backwards in time', () => {
    for (let i = 1; i < sequence.length; i++) {
      expect(sequence[i].offsetSeconds).toBeGreaterThanOrEqual(sequence[i - 1].offsetSeconds);
    }
  });

  it('agrees with findStationOnRoute, which the map card times stations by', () => {
    // Two accumulations of the same thing; if they ever drift, the itinerary
    // and the station card quote different arrival times for one station.
    for (const station of sequence) {
      const onRoute = findStationOnRoute(route, station.stationId);
      expect(onRoute).not.toBeNull();
      expect(onRoute!.offsetSeconds).toBeCloseTo(station.offsetSeconds, 6);
    }
  });

  it('accounts for every station the legs call at', () => {
    const legStations = new Set<string>();
    for (const leg of route.legs) {
      legStations.add(leg.boardingStation.stationId);
      for (const s of leg.intermediateStations) legStations.add(s.stationId);
      legStations.add(leg.alightingStation.stationId);
    }
    expect(new Set(sequence.map((s) => s.stationId))).toEqual(legStations);
  });
});

describe('getRouteProgress', () => {
  const route = crossCityRoute();
  const sequence = buildRouteStationSequence(route);
  const midpoint = sequence[Math.floor(sequence.length / 2)];

  it('marks everything before the nearest station as passed, and nothing after', () => {
    const progress = getRouteProgress(route, positionOf(midpoint.stationId))!;

    expect(progress.nearestStationId).toBe(midpoint.stationId);
    expect(progress.passedStationIds.size).toBe(midpoint.index);
    // The station you're at is current, not passed.
    expect(progress.passedStationIds.has(midpoint.stationId)).toBe(false);
    for (const station of sequence.slice(midpoint.index + 1)) {
      expect(progress.passedStationIds.has(station.stationId)).toBe(false);
    }
  });

  it('reports nothing passed while still at the origin', () => {
    const progress = getRouteProgress(route, positionOf(route.originStationId))!;

    expect(progress.nearestIndex).toBe(0);
    expect(progress.passedStationIds.size).toBe(0);
  });

  it('reports the whole journey behind you at the destination', () => {
    const progress = getRouteProgress(route, positionOf(route.destinationStationId))!;

    expect(progress.nearestIndex).toBe(sequence.length - 1);
    expect(progress.passedStationIds.size).toBe(sequence.length - 1);
  });

  it('answers with a station on the route even while standing at one that is not', () => {
    // The whole point of not reusing findNearestStation(): mid-journey, the
    // nearest station on the *network* is often one on a line you're passing
    // under, which says nothing about your progress.
    const onRoute = new Set(sequence.map((s) => s.stationId));
    const offRouteNeighbour = listStations().find(
      (station) =>
        !onRoute.has(station.id) &&
        sequence.some(
          (s) => haversineMeters(station.lat, station.lon, s.lat, s.lon) < 1200,
        ),
    );
    expect(offRouteNeighbour).toBeDefined();

    const progress = getRouteProgress(route, {
      lat: offRouteNeighbour!.lat,
      lon: offRouteNeighbour!.lon,
    })!;

    expect(progress.nearestStationId).not.toBe(offRouteNeighbour!.id);
    expect(onRoute).toContain(progress.nearestStationId);
  });

  it('gives up rather than guessing when the user is nowhere near the route', () => {
    // Mumbai.
    expect(getRouteProgress(route, { lat: 19.076, lon: 72.8777 })).toBeNull();
  });

  it('gives up when there is no position at all', () => {
    expect(getRouteProgress(route, null)).toBeNull();
    expect(getRouteProgress(null, positionOf(route.originStationId))).toBeNull();
  });

  it('holds on right up to the distance cut-off', () => {
    const origin = positionOf(route.originStationId);
    // ~1.1 km north: inside the gate, so progress still resolves.
    const near = { lat: origin.lat + 0.01, lon: origin.lon };
    const progress = getRouteProgress(route, near);

    expect(progress).not.toBeNull();
    expect(progress!.distanceMeters).toBeLessThan(MAX_ON_ROUTE_DISTANCE_METERS);
  });
});

describe('buildStationMarks', () => {
  const route = crossCityRoute();
  const sequence = buildRouteStationSequence(route);
  const midpoint = sequence[Math.floor(sequence.length / 2)];

  it('labels each station passed, current or upcoming', () => {
    const progress = getRouteProgress(route, positionOf(midpoint.stationId))!;
    const marks = buildStationMarks(progress);

    expect(marks.get(sequence[0].stationId)).toBe('passed');
    expect(marks.get(midpoint.stationId)).toBe('current');
    expect(marks.get(sequence[sequence.length - 1].stationId)).toBe('upcoming');
  });

  it('is empty when progress is unknown, so nothing renders as passed', () => {
    expect(buildStationMarks(null).size).toBe(0);
  });
});
