import { describe, expect, it } from 'vitest';
import { findRoute, getCompiledGraph, getStation } from '../../engine/graph';
import type { RouteResult } from '../../engine/types';
import { buildRouteStationSequence, type RouteProgress } from '../../route/routeProgress';
import { AT_STATION_METERS, journeyAlertFor } from '../alerts';

function crossCityRoute(): RouteResult {
  const route = findRoute('rithala', 'botanical-garden', 'fastest');
  if (!route) throw new Error('fixture route no longer exists in the compiled graph');
  return route;
}

const route = crossCityRoute();
const sequence = buildRouteStationSequence(route);
const lastIndex = sequence.length - 1;

/**
 * Progress built by hand rather than from a coordinate.
 *
 * The rules turn on the *distance* to the nearest station, and deriving that
 * from a real position would mean placing a fake user at a computed fraction
 * of a hop whose length varies station to station. Constructing it directly
 * says what each case is actually testing.
 */
function progressAt(index: number, distanceMeters: number): RouteProgress {
  return {
    sequence,
    nearestIndex: index,
    nearestStationId: sequence[index].stationId,
    distanceMeters,
    passedStationIds: new Set(
      sequence.filter((station) => station.index < index).map((station) => station.stationId),
    ),
  };
}

/** Standing on the platform. */
const AT = 20;
/** Between two stations, past the midpoint so this one is nearest. */
const APPROACHING = AT_STATION_METERS + 200;

function firstInterchangeIndex(): number {
  for (let i = 0; i < sequence.length - 1; i++) {
    if (sequence[i].legIndex < sequence[i + 1].legIndex) return i;
  }
  throw new Error('fixture route no longer has an interchange');
}

const interchange = firstInterchangeIndex();

describe('journeyAlertFor', () => {
  it('says nothing without a position', () => {
    expect(journeyAlertFor(route, null)).toBeNull();
  });

  it('says nothing in the middle of a leg', () => {
    // Most of a journey is uneventful, and an app that buzzes anyway gets
    // silenced before it ever reaches the stop that matters.
    const quiet = Math.floor(interchange / 2);
    expect(quiet).toBeGreaterThan(0);
    expect(quiet).toBeLessThan(interchange);
    expect(journeyAlertFor(route, progressAt(quiet, AT))).toBeNull();
    expect(journeyAlertFor(route, progressAt(quiet, APPROACHING))).toBeNull();
  });

  it('does not warn about the destination while the second-last stop is still ahead', () => {
    // The bug this replaces: "nearest" flips at the midpoint of a hop, so
    // firing on nearest alone announced "get off at the next stop" a station
    // and a half early, while two stops still remained.
    expect(journeyAlertFor(route, progressAt(lastIndex - 1, APPROACHING))).toBeNull();
    expect(journeyAlertFor(route, progressAt(lastIndex - 1, AT))).toBeNull();
  });

  it('warns to get off once the second-last stop is behind you', () => {
    const alert = journeyAlertFor(route, progressAt(lastIndex, APPROACHING));
    const destination = getStation(route.destinationStationId);
    expect(alert?.kind).toBe('approaching-destination');
    expect(alert?.body).toContain(destination!.name);
  });

  it('reports arrival only once actually at the destination', () => {
    expect(journeyAlertFor(route, progressAt(lastIndex, AT))?.kind).toBe('arrived');
  });

  it('treats arrival as redundant once the user has been told to get off', () => {
    const warning = journeyAlertFor(route, progressAt(lastIndex, APPROACHING));
    const arrival = journeyAlertFor(route, progressAt(lastIndex, AT));
    expect(arrival?.redundantAfter).toBe(warning?.key);
  });

  it('does not warn about an interchange while the stop before it is still ahead', () => {
    expect(journeyAlertFor(route, progressAt(interchange - 1, APPROACHING))).toBeNull();
  });

  it('warns to change lines once the stop before the interchange is behind you', () => {
    const alert = journeyAlertFor(route, progressAt(interchange, APPROACHING));
    const toLine = getCompiledGraph().lines[route.legs[sequence[interchange].legIndex + 1].line];
    expect(alert?.kind).toBe('approaching-interchange');
    expect(alert?.body).toContain(sequence[interchange].stationName);
    expect(alert?.body).toContain(toLine.name);
  });

  it('tells the user to change once they are at the interchange', () => {
    const alert = journeyAlertFor(route, progressAt(interchange, AT));
    expect(alert?.kind).toBe('interchange-now');
    expect(alert?.title).toContain(sequence[interchange].stationName);
    expect(alert?.redundantAfter).toBe(`approaching-interchange:${interchange}`);
  });

  it('gives every alert a key unique to its point in the journey', () => {
    // The key is what stops a jittery fix buzzing twice for one event, so a
    // collision between two different moments would silence a real alert.
    const keys = sequence.flatMap((_, index) =>
      [AT, APPROACHING]
        .map((distance) => journeyAlertFor(route, progressAt(index, distance))?.key)
        .filter((key): key is string => key !== undefined),
    );
    // Two alerts per interchange (warn, then change) plus two for the
    // destination (warn, then arrive). Derived from the route rather than
    // hardcoded, so it keeps checking the right thing if the graph is
    // recompiled and the fixture gains or loses a change of line.
    expect(keys.length).toBe(route.interchanges * 2 + 2);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is stable for a given position', () => {
    // Latching depends on the same position producing the same key, or the
    // user would be alerted repeatedly while standing still.
    const first = journeyAlertFor(route, progressAt(interchange, AT));
    const second = journeyAlertFor(route, progressAt(interchange, AT));
    expect(first?.key).toBe(second?.key);
  });
});
