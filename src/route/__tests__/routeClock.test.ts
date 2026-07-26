import { describe, expect, it } from 'vitest';
import { findRoute, getStation } from '../../engine/graph';
import type { RouteResult } from '../../engine/types';
import {
  formatRouteClock,
  formatStationArrival,
  routeClockMs,
  type RouteClock,
} from '../routeClock';
import { buildRouteStationSequence, buildStationMarks, getRouteProgress } from '../routeProgress';

function crossCityRoute(): RouteResult {
  const route = findRoute('rithala', 'botanical-garden', 'fastest');
  if (!route) throw new Error('fixture route no longer exists in the compiled graph');
  return route;
}

/** 10:00:00 local, so the formatted clock is readable in assertions. */
const TEN_AM = new Date(2026, 0, 1, 10, 0, 0).getTime();

describe('routeClockMs', () => {
  it('reads offsets straight off the origin when the clock is not live', () => {
    const clock: RouteClock = { anchorMs: TEN_AM, anchorOffsetSeconds: 0, isLive: false };

    expect(routeClockMs(clock, 0)).toBe(TEN_AM);
    expect(formatRouteClock(clock, 25 * 60)).toBe('10:25');
  });

  it('measures from the anchor station once live, not from the origin', () => {
    // Anchored 30 min into the journey: a station 40 min in is 10 min away,
    // not 40 -- which is the whole point of anchoring to where the user is.
    const clock: RouteClock = {
      anchorMs: TEN_AM,
      anchorOffsetSeconds: 30 * 60,
      isLive: true,
    };

    expect(formatRouteClock(clock, 30 * 60)).toBe('10:00');
    expect(formatRouteClock(clock, 40 * 60)).toBe('10:10');
  });

  it('leaves the remaining journey unchanged when the anchor slips', () => {
    // Waiting on a platform: the anchor stays on this station and moves with
    // the wall clock, so everything ahead pushes out by the same amount.
    const arrived: RouteClock = { anchorMs: TEN_AM, anchorOffsetSeconds: 600, isLive: true };
    const waitedFive: RouteClock = { ...arrived, anchorMs: TEN_AM + 5 * 60_000 };

    expect(formatRouteClock(arrived, 900)).toBe('10:05');
    expect(formatRouteClock(waitedFive, 900)).toBe('10:10');
  });
});

describe('formatStationArrival', () => {
  const clock: RouteClock = { anchorMs: TEN_AM, anchorOffsetSeconds: 600, isLive: true };

  it('quotes no clock time for a station already behind you', () => {
    expect(formatStationArrival(clock, 0, 'passed')).toBe('Passed');
  });

  it('says where you are rather than predicting an arrival you have made', () => {
    expect(formatStationArrival(clock, 600, 'current')).toBe('Now');
  });

  it('gives an upcoming station a clock time', () => {
    expect(formatStationArrival(clock, 1200, 'upcoming')).toBe('10:10');
  });

  it('gives every station a clock time when there are no marks to go on', () => {
    // No progress -> no marks -> a plain planned itinerary, all times shown.
    expect(formatStationArrival(clock, 1200, undefined)).toBe('10:10');
  });
});

describe('the clock and the journey together', () => {
  const route = crossCityRoute();
  const sequence = buildRouteStationSequence(route);
  const midpoint = sequence[Math.floor(sequence.length / 2)];

  it('counts down the real remaining time from where the user stands', () => {
    const station = getStation(midpoint.stationId)!;
    const progress = getRouteProgress(route, { lat: station.lat, lon: station.lon })!;
    const marks = buildStationMarks(progress);
    const clock: RouteClock = {
      anchorMs: TEN_AM,
      anchorOffsetSeconds: sequence[progress.nearestIndex].offsetSeconds,
      isLive: true,
    };

    // The destination is now the journey's *remaining* time away, not its
    // total -- the bug this whole anchor exists to fix.
    const destination = sequence[sequence.length - 1];
    const remainingMs = routeClockMs(clock, destination.offsetSeconds) - TEN_AM;
    expect(remainingMs).toBeGreaterThan(0);
    expect(remainingMs).toBeLessThan(route.totalTimeSeconds * 1000);
    expect(remainingMs).toBeCloseTo(
      (route.totalTimeSeconds - midpoint.offsetSeconds) * 1000,
      -1,
    );

    expect(formatStationArrival(clock, 0, marks.get(sequence[0].stationId))).toBe('Passed');
    expect(formatStationArrival(clock, midpoint.offsetSeconds, marks.get(midpoint.stationId))).toBe(
      'Now',
    );
  });
});
