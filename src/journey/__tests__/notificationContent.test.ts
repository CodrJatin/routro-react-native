import { describe, expect, it } from 'vitest';
import { findRoute, getCompiledGraph, getStation } from '../../engine/graph';
import type { RouteResult } from '../../engine/types';
import type { RouteClock } from '../../route/routeClock';
import { buildRouteStationSequence, getRouteProgress } from '../../route/routeProgress';
import { buildJourneyNotification } from '../notificationContent';

/** Same fixture the routeProgress tests use: long enough to have interchanges,
 * so the leg-boundary cases are real rather than constructed. */
function crossCityRoute(): RouteResult {
  const route = findRoute('rithala', 'botanical-garden', 'fastest');
  if (!route) throw new Error('fixture route no longer exists in the compiled graph');
  return route;
}

const route = crossCityRoute();
const sequence = buildRouteStationSequence(route);

/** Progress as if the user were standing at the station at `index`. */
function progressAt(index: number) {
  const station = sequence[index];
  const progress = getRouteProgress(route, { lat: station.lat, lon: station.lon });
  if (!progress) throw new Error(`no progress at ${station.stationName}`);
  return progress;
}

function clock(isLive: boolean): RouteClock {
  return { anchorMs: Date.UTC(2026, 0, 1, 9, 0, 0), anchorOffsetSeconds: 0, isLive };
}

/** The first station the journey changes lines at, found the same way the
 * itinerary would read it: a leg boundary between adjacent stations. */
function firstInterchangeIndex(): number {
  for (let i = 0; i < sequence.length - 1; i++) {
    if (sequence[i].legIndex < sequence[i + 1].legIndex) return i;
  }
  throw new Error('fixture route no longer has an interchange');
}

describe('buildJourneyNotification', () => {
  it('names the destination and its arrival time in the title', () => {
    const content = buildJourneyNotification(route, progressAt(0), clock(true));
    const destination = getStation(route.destinationStationId);
    expect(content.title).toContain(destination!.name);
    expect(content.title).toMatch(/\d{2}:\d{2}/);
  });

  it('withholds the stop count when there is no fix', () => {
    const content = buildJourneyNotification(route, null, clock(false));
    // Quoting stops from the origin would tell someone halfway through their
    // journey that they had not started it.
    expect(content.body).toBe('Waiting for your location');
    expect(content.progress).toBeUndefined();
  });

  it('counts stops remaining from where the user actually is', () => {
    const index = 2;
    const content = buildJourneyNotification(route, progressAt(index), clock(true));
    const remaining = sequence.length - 1 - index;
    expect(content.body).toContain(`${remaining} stops`);
    expect(content.progress).toEqual({ current: index, max: sequence.length - 1 });
  });

  it('names the next station', () => {
    const content = buildJourneyNotification(route, progressAt(1), clock(true));
    expect(content.body).toContain(sequence[2].stationName);
  });

  it('says to change lines when standing at an interchange', () => {
    const index = firstInterchangeIndex();
    const content = buildJourneyNotification(route, progressAt(index), clock(true));
    const nextLine = getCompiledGraph().lines[route.legs[sequence[index].legIndex + 1].line];
    expect(content.body).toBe(`Change here for the ${nextLine.name}`);
  });

  it('tints itself with the line being changed to, not the one arrived on', () => {
    const index = firstInterchangeIndex();
    const content = buildJourneyNotification(route, progressAt(index), clock(true));
    const graph = getCompiledGraph();
    const arrivedOn = graph.lines[route.legs[sequence[index].legIndex].line];
    const changingTo = graph.lines[route.legs[sequence[index].legIndex + 1].line];
    expect(content.color).toBe(changingTo.color);
    expect(content.color).not.toBe(arrivedOn.color);
  });

  it('warns about the change one station ahead of it', () => {
    const index = firstInterchangeIndex();
    // Only meaningful if there is a station before the interchange to stand at.
    expect(index).toBeGreaterThan(0);
    const content = buildJourneyNotification(route, progressAt(index - 1), clock(true));
    expect(content.body).toContain(`change at ${sequence[index].stationName}`);
  });

  it('tells the user to get off when the destination is next', () => {
    const content = buildJourneyNotification(route, progressAt(sequence.length - 2), clock(true));
    const destination = getStation(route.destinationStationId);
    expect(content.body).toBe(`Get off at ${destination!.name} next`);
    // Singular, not "1 stops".
    expect(content.body).not.toContain('stops');
  });

  it('reports arrival at the destination with a full progress bar', () => {
    const last = sequence.length - 1;
    const content = buildJourneyNotification(route, progressAt(last), clock(true));
    const destination = getStation(route.destinationStationId);
    expect(content.title).toBe(`Arrived at ${destination!.name}`);
    expect(content.progress).toEqual({ current: last, max: last });
  });

  it('always offers a way to stop', () => {
    // A notification that can only be dismissed by finding the app again is
    // how a background feature earns its reputation.
    for (const progress of [null, progressAt(0), progressAt(sequence.length - 1)]) {
      expect(buildJourneyNotification(route, progress, clock(true)).showStopAction).toBe(true);
    }
  });
});
