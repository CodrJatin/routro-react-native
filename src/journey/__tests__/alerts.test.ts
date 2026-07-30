import { describe, expect, it } from 'vitest';
import { findRoute, getCompiledGraph, getStation } from '../../engine/graph';
import type { RouteResult } from '../../engine/types';
import { buildRouteStationSequence, getRouteProgress } from '../../route/routeProgress';
import { journeyAlertFor } from '../alerts';

function crossCityRoute(): RouteResult {
  const route = findRoute('rithala', 'botanical-garden', 'fastest');
  if (!route) throw new Error('fixture route no longer exists in the compiled graph');
  return route;
}

const route = crossCityRoute();
const sequence = buildRouteStationSequence(route);

function progressAt(index: number) {
  const station = sequence[index];
  const progress = getRouteProgress(route, { lat: station.lat, lon: station.lon });
  if (!progress) throw new Error(`no progress at ${station.stationName}`);
  return progress;
}

function firstInterchangeIndex(): number {
  for (let i = 0; i < sequence.length - 1; i++) {
    if (sequence[i].legIndex < sequence[i + 1].legIndex) return i;
  }
  throw new Error('fixture route no longer has an interchange');
}

describe('journeyAlertFor', () => {
  it('says nothing without a position', () => {
    expect(journeyAlertFor(route, null)).toBeNull();
  });

  it('says nothing in the middle of a leg', () => {
    // Most of a journey is uneventful, and an app that buzzes anyway gets
    // silenced before it ever reaches the stop that matters.
    const interchange = firstInterchangeIndex();
    const quiet = Math.floor(interchange / 2);
    expect(quiet).toBeGreaterThan(0);
    expect(quiet).toBeLessThan(interchange - 1);
    expect(journeyAlertFor(route, progressAt(quiet))).toBeNull();
  });

  it('warns one stop before an interchange, naming the line to change to', () => {
    const index = firstInterchangeIndex();
    const alert = journeyAlertFor(route, progressAt(index - 1));
    const toLine = getCompiledGraph().lines[route.legs[sequence[index].legIndex + 1].line];
    expect(alert?.kind).toBe('approaching-interchange');
    expect(alert?.body).toContain(sequence[index].stationName);
    expect(alert?.body).toContain(toLine.name);
  });

  it('tells the user to change once they are at the interchange', () => {
    const index = firstInterchangeIndex();
    const alert = journeyAlertFor(route, progressAt(index));
    expect(alert?.kind).toBe('interchange-now');
    expect(alert?.title).toContain(sequence[index].stationName);
  });

  it('warns one stop before the destination', () => {
    const alert = journeyAlertFor(route, progressAt(sequence.length - 2));
    const destination = getStation(route.destinationStationId);
    expect(alert?.kind).toBe('approaching-destination');
    expect(alert?.body).toContain(destination!.name);
  });

  it('reports arrival', () => {
    const alert = journeyAlertFor(route, progressAt(sequence.length - 1));
    expect(alert?.kind).toBe('arrived');
  });

  it('gives every alert a key unique to its point in the journey', () => {
    // The key is what stops a jittery fix buzzing twice for one event, so a
    // collision between two different moments would silence a real alert.
    const keys = sequence
      .map((_, index) => journeyAlertFor(route, progressAt(index))?.key)
      .filter((key): key is string => key !== undefined);
    expect(keys.length).toBeGreaterThan(3);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is stable for a given position', () => {
    // Latching depends on the same position producing the same key, or the
    // user would be alerted repeatedly while standing still.
    const index = firstInterchangeIndex();
    const first = journeyAlertFor(route, progressAt(index));
    const second = journeyAlertFor(route, progressAt(index));
    expect(first?.key).toBe(second?.key);
  });
});
