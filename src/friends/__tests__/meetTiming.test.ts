import { describe, expect, it } from 'vitest';
import { findRoute } from '../../engine/graph';
import type { RouteResult } from '../../engine/types';
import type { RouteClock } from '../../route/routeClock';
import { buildRouteStationSequence } from '../../route/routeProgress';
import {
  computeMeetTiming,
  resolveOtherArrival,
  secondsToStation,
  secondsToStationFromPosition,
} from '../meetTiming';

/** A long cross-city journey with an interchange, so there are plenty of
 * stations between the ends to meet at. */
function crossCityRoute(): RouteResult {
  const route = findRoute('rithala', 'botanical-garden', 'fastest');
  if (!route) throw new Error('fixture route no longer exists in the compiled graph');
  return route;
}

const NOW = 1_700_000_000_000;

/** A clock pinned to `NOW` at the trip origin -- the "leaving now" mode. */
const clock: RouteClock = { anchorMs: NOW, anchorOffsetSeconds: 0, isLive: false };

const route = crossCityRoute();
const sequence = buildRouteStationSequence(route);
/** Somewhere in the middle, so it is neither origin nor destination. */
const midway = sequence[Math.floor(sequence.length / 2)];

describe('computeMeetTiming', () => {
  it('puts my arrival at the station where the route clock does', () => {
    const timing = computeMeetTiming({
      myRoute: route,
      myClock: clock,
      stationId: midway.stationId,
      theirArrivalMs: null,
    });
    expect(timing.myArrivalMs).toBe(NOW + midway.offsetSeconds * 1000);
  });

  it('waits for the later of the two and delays the rest of the journey by it', () => {
    const myArrival = NOW + midway.offsetSeconds * 1000;
    const theyAreLateBy = 7 * 60_000;

    const timing = computeMeetTiming({
      myRoute: route,
      myClock: clock,
      stationId: midway.stationId,
      theirArrivalMs: myArrival + theyAreLateBy,
    });

    expect(timing.myWaitMs).toBe(theyAreLateBy);
    expect(timing.theirWaitMs).toBe(0);
    expect(timing.meetAtMs).toBe(myArrival + theyAreLateBy);
    expect(timing.delayMs).toBe(theyAreLateBy);
    expect(timing.destinationMs).toBe(NOW + route.totalTimeSeconds * 1000 + theyAreLateBy);
  });

  it('costs me nothing when I am the one arriving later', () => {
    const myArrival = NOW + midway.offsetSeconds * 1000;

    const timing = computeMeetTiming({
      myRoute: route,
      myClock: clock,
      stationId: midway.stationId,
      theirArrivalMs: myArrival - 5 * 60_000,
    });

    expect(timing.myWaitMs).toBe(0);
    expect(timing.theirWaitMs).toBe(5 * 60_000);
    expect(timing.delayMs).toBe(0);
    // They are standing there when I get there, so the rest of my journey is
    // untouched.
    expect(timing.destinationMs).toBe(NOW + route.totalTimeSeconds * 1000);
  });

  it('does not delay a journey that ends where the meeting is', () => {
    const destination = sequence[sequence.length - 1];
    const timing = computeMeetTiming({
      myRoute: route,
      myClock: clock,
      stationId: destination.stationId,
      theirArrivalMs: NOW + destination.offsetSeconds * 1000 + 20 * 60_000,
    });

    expect(timing.isAtMyDestination).toBe(true);
    expect(timing.myWaitMs).toBe(20 * 60_000);
    // Waiting at the far end is not a delay: the journey is already over.
    expect(timing.delayMs).toBe(0);
    expect(timing.destinationMs).toBe(NOW + route.totalTimeSeconds * 1000);
  });

  it('quotes no wait when the other side cannot be timed', () => {
    const timing = computeMeetTiming({
      myRoute: route,
      myClock: clock,
      stationId: midway.stationId,
      theirArrivalMs: null,
    });
    expect(timing.myWaitMs).toBeNull();
    expect(timing.delayMs).toBeNull();
    // My own arrival is still knowable, and still worth showing.
    expect(timing.destinationMs).toBe(NOW + route.totalTimeSeconds * 1000);
  });

  it('says nothing about a station this route does not call at', () => {
    const timing = computeMeetTiming({
      myRoute: route,
      myClock: clock,
      // On the network, deliberately not on this journey.
      stationId: 'dwarka-mor',
      theirArrivalMs: NOW,
    });
    expect(timing.myArrivalMs).toBeNull();
    expect(timing.destinationMs).toBeNull();
    // What the other side is doing is still known -- it is only the cost to me
    // that can't be worked out.
    expect(timing.theirArrivalMs).toBe(NOW);
  });

  it('handles having no route of my own at all', () => {
    const timing = computeMeetTiming({
      myRoute: null,
      myClock: null,
      stationId: midway.stationId,
      theirArrivalMs: NOW,
    });
    expect(timing.myArrivalMs).toBeNull();
    expect(timing.meetAtMs).toBe(NOW);
  });
});

describe('resolveOtherArrival', () => {
  it('anchors a quoted duration to this device s clock, never to theirs', () => {
    const arrival = resolveOtherArrival({
      liveJourney: null,
      stationId: midway.stationId,
      quotedEtaSeconds: 600,
      quotedAnchorMs: NOW,
    });
    expect(arrival).toEqual({ atMs: NOW + 600_000, source: 'quoted' });
  });

  it('gives up rather than guessing when there is no quote and no journey', () => {
    expect(
      resolveOtherArrival({
        liveJourney: null,
        stationId: midway.stationId,
        quotedEtaSeconds: null,
        quotedAnchorMs: NOW,
      }),
    ).toEqual({ atMs: null, source: 'unknown' });
  });
});

describe('secondsToStation', () => {
  it('measures from where the clock is anchored', () => {
    expect(secondsToStation(route, clock, midway.stationId, NOW)).toBe(midway.offsetSeconds);
  });

  it('never quotes a negative duration for a station already behind', () => {
    const passedAnchor: RouteClock = {
      anchorMs: NOW,
      anchorOffsetSeconds: sequence[sequence.length - 1].offsetSeconds,
      isLive: true,
    };
    expect(secondsToStation(route, passedAnchor, midway.stationId, NOW)).toBe(0);
  });

  it('is null for a station off the route', () => {
    expect(secondsToStation(route, clock, 'dwarka-mor', NOW)).toBeNull();
  });
});

describe('secondsToStationFromPosition', () => {
  it('routes from the nearest station for someone with no journey', () => {
    const origin = sequence[0];
    const seconds = secondsToStationFromPosition(
      { lat: origin.lat, lon: origin.lon },
      midway.stationId,
    );
    expect(seconds).not.toBeNull();
    expect(seconds!).toBeGreaterThan(0);
  });

  it('is zero when they are already at the station', () => {
    expect(
      secondsToStationFromPosition({ lat: midway.lat, lon: midway.lon }, midway.stationId),
    ).toBe(0);
  });

  it('is null for someone nowhere near the network', () => {
    expect(secondsToStationFromPosition({ lat: 0, lon: 0 }, midway.stationId)).toBeNull();
    expect(secondsToStationFromPosition(null, midway.stationId)).toBeNull();
  });
});
