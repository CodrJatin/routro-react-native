import { describe, expect, it } from 'vitest';
import type { ItineraryStep, StationId } from '../../engine/types';
import { buildLegSegments, type ItineraryMeet } from '../legSegments';
import type { RouteStationMark } from '../routeProgress';

function stops(count: number): ItineraryStep[] {
  return Array.from({ length: count }, (_, i) => ({
    stationId: `s${i}`,
    stationName: `Station ${i}`,
    lat: 0,
    lon: 0,
  }));
}

function marksAt(stationId: StationId, mark: RouteStationMark): Map<StationId, RouteStationMark> {
  return new Map([[stationId, mark]]);
}

function meetsAt(...stationIds: StationId[]): Map<StationId, ItineraryMeet> {
  return new Map(stationIds.map((id) => [id, { stationId: id, label: 'Wait for them' }]));
}

describe('buildLegSegments', () => {
  it('folds a leg with nothing pinned into one group', () => {
    const segments = buildLegSegments(stops(6), new Map(), new Map());
    expect(segments).toEqual([{ stops: [0, 1, 2, 3, 4, 5], pinnedIndex: null }]);
  });

  it('puts a group either side of the stop you are standing at', () => {
    // The bug this exists for: with one group only, the pinned stop landed
    // after every collapsed stop and read as the last station before the
    // interchange.
    const segments = buildLegSegments(stops(6), marksAt('s3', 'current'), new Map());
    expect(segments).toEqual([
      { stops: [0, 1, 2], pinnedIndex: 3 },
      { stops: [4, 5], pinnedIndex: null },
    ]);
  });

  it('splits around several pinned stops at once', () => {
    const segments = buildLegSegments(stops(8), marksAt('s1', 'current'), meetsAt('s5'));
    expect(segments).toEqual([
      { stops: [0], pinnedIndex: 1 },
      { stops: [2, 3, 4], pinnedIndex: 5 },
      { stops: [6, 7], pinnedIndex: null },
    ]);
  });

  it('gives a stop that is both current and a meeting point one row, not two', () => {
    const segments = buildLegSegments(stops(4), marksAt('s2', 'current'), meetsAt('s2'));
    expect(segments).toEqual([
      { stops: [0, 1], pinnedIndex: 2 },
      { stops: [3], pinnedIndex: null },
    ]);
  });

  it('leaves no empty group to render when a pinned stop is at either end', () => {
    const first = buildLegSegments(stops(3), marksAt('s0', 'current'), new Map());
    expect(first[0]).toEqual({ stops: [], pinnedIndex: 0 });
    expect(first[1]).toEqual({ stops: [1, 2], pinnedIndex: null });

    const last = buildLegSegments(stops(3), marksAt('s2', 'current'), new Map());
    expect(last[0]).toEqual({ stops: [0, 1], pinnedIndex: 2 });
    expect(last[1]).toEqual({ stops: [], pinnedIndex: null });
  });

  it('ignores a passed mark -- only where you are now is pinned', () => {
    const segments = buildLegSegments(stops(4), marksAt('s1', 'passed'), new Map());
    expect(segments).toEqual([{ stops: [0, 1, 2, 3], pinnedIndex: null }]);
  });
});
