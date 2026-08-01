import { describe, expect, it } from 'vitest';
import { findRoute, getCompiledGraph, getStation } from '../../engine/graph';
import type { RouteResult } from '../../engine/types';
import { formatRouteClock, type RouteClock } from '../../route/routeClock';
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
  it('puts the instruction in the title, not the destination alone', () => {
    const index = 2;
    const content = buildJourneyNotification(route, progressAt(index), clock(true));
    const destination = getStation(route.destinationStationId);
    const remaining = sequence.length - 1 - index;
    expect(content.title).toBe(`${remaining} stops to ${destination!.name}`);
  });

  it('withholds the stop count when there is no fix', () => {
    const content = buildJourneyNotification(route, null, clock(false));
    // Quoting stops from the origin would tell someone halfway through their
    // journey that they had not started it.
    expect(content.body).toBe('Waiting for your location');
    expect(content.progress).toBeUndefined();
  });

  it('withholds the tracker when there is no fix', () => {
    const content = buildJourneyNotification(route, null, clock(false));
    // It would draw a confident picture of a position we do not have.
    expect(content.segments).toBeUndefined();
  });

  it('counts stops remaining from where the user actually is', () => {
    const index = 2;
    const content = buildJourneyNotification(route, progressAt(index), clock(true));
    const remaining = sequence.length - 1 - index;
    expect(content.title).toContain(`${remaining} stops`);
    expect(content.progress).toEqual({ current: index, max: sequence.length - 1 });
  });

  it('names the next station', () => {
    const content = buildJourneyNotification(route, progressAt(1), clock(true));
    expect(content.body).toContain(sequence[2].stationName);
  });

  it('gives the arrival time in the body rather than as a live countdown', () => {
    const content = buildJourneyNotification(route, progressAt(2), clock(true));
    expect(content.body).toContain(
      formatRouteClock(clock(true), sequence[sequence.length - 1].offsetSeconds),
    );
  });

  it('says to change lines when standing at an interchange', () => {
    const index = firstInterchangeIndex();
    const content = buildJourneyNotification(route, progressAt(index), clock(true));
    const nextLine = getCompiledGraph().lines[route.legs[sequence[index].legIndex + 1].line];
    expect(content.title).toBe(`Change here for the ${nextLine.name}`);
  });

  it('tints itself with the line being changed to, not the one arrived on', () => {
    const index = firstInterchangeIndex();
    const content = buildJourneyNotification(route, progressAt(index), clock(true));
    const graph = getCompiledGraph();
    const arrivedOn = graph.lines[route.legs[sequence[index].legIndex].line];
    const changingTo = graph.lines[route.legs[sequence[index].legIndex + 1].line];
    expect(content.color).toBe(changingTo.color);
    expect(content.color).not.toBe(arrivedOn.color);
    // The header carries the same line, so the notification names the line it
    // is painted in rather than leaving the colour unexplained.
    expect(content.subText).toBe(changingTo.name);
  });

  it('warns about the change one station ahead of it', () => {
    const index = firstInterchangeIndex();
    // Only meaningful if there is a station before the interchange to stand at.
    expect(index).toBeGreaterThan(0);
    const content = buildJourneyNotification(route, progressAt(index - 1), clock(true));
    expect(content.body).toContain(sequence[index].stationName);
    expect(content.body).toContain('change for the');
  });

  it('tells the user to get off when the destination is next', () => {
    const content = buildJourneyNotification(route, progressAt(sequence.length - 2), clock(true));
    const destination = getStation(route.destinationStationId);
    expect(content.title).toBe(`Get off at ${destination!.name} next`);
    // Singular, not "1 stops".
    expect(content.title).not.toContain('stops');
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

  describe('the tracker', () => {
    it('spans the whole journey exactly, or is not drawn at all', () => {
      const content = buildJourneyNotification(route, progressAt(2), clock(true));
      const total = content.segments!.reduce((sum, segment) => sum + segment.length, 0);
      // Android derives the bar's maximum from the segments. A total that
      // disagrees with `progress.max` would misplace the marker for the whole
      // journey, so this is the one invariant the tracker actually has.
      expect(total).toBe(content.progress!.max);
    });

    it('gives every leg its own line colour, in travel order', () => {
      const content = buildJourneyNotification(route, progressAt(2), clock(true));
      const graph = getCompiledGraph();
      expect(content.segments).toHaveLength(route.legs.length);
      content.segments!.forEach((segment, index) => {
        expect(segment.color).toBe(graph.lines[route.legs[index].line].color);
      });
    });

    it('changes colour exactly where it marks the interchange', () => {
      const content = buildJourneyNotification(route, progressAt(2), clock(true));
      // The boundary between two legs and the marker for the change between
      // them are the same event, so they have to land on the same station.
      // They were once counted separately and drew a station apart, which on
      // the bar reads as the line changing before the interchange it changes
      // at.
      const boundaries: number[] = [];
      let station = 0;
      for (const segment of content.segments!.slice(0, -1)) {
        station += segment.length;
        boundaries.push(station);
      }
      expect(boundaries).toEqual(content.points!.map((point) => point.position));
    });

    it('marks each interchange with the line being changed to', () => {
      const content = buildJourneyNotification(route, progressAt(2), clock(true));
      const index = firstInterchangeIndex();
      const changingTo = getCompiledGraph().lines[route.legs[sequence[index].legIndex + 1].line];
      expect(content.points).toContainEqual({ position: index, color: changingTo.color });
      // One point per change, no more.
      expect(content.points).toHaveLength(route.legs.length - 1);
    });
  });
});
