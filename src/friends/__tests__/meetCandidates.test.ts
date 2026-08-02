import { describe, expect, it } from 'vitest';
import { findRoute } from '../../engine/graph';
import type { RouteResult } from '../../engine/types';
import type { RouteClock } from '../../route/routeClock';
import { buildRouteStationSequence, getRouteProgress } from '../../route/routeProgress';
import { buildMeetCandidates } from '../meetCandidates';
import type { MeetingSide } from '../meetingStations';

function route(from: string, to: string): RouteResult {
  const result = findRoute(from, to, 'fastest');
  if (!result) throw new Error(`fixture route ${from} -> ${to} no longer exists`);
  return result;
}

const clock: RouteClock = { anchorMs: 1_700_000_000_000, anchorOffsetSeconds: 0, isLive: false };

function side(result: RouteResult, atIndex: number | null = null): MeetingSide {
  const sequence = buildRouteStationSequence(result);
  const at = atIndex === null ? null : sequence[atIndex];
  return {
    route: result,
    progress: at ? getRouteProgress(result, { lat: at.lat, lon: at.lon }) : null,
    clock,
  };
}

const mine = route('rithala', 'botanical-garden');
/** The same corridor the other way, so the two genuinely cross. */
const theirs = route('botanical-garden', 'rithala');

describe('buildMeetCandidates', () => {
  it('offers the stations both journeys call at', () => {
    const candidates = buildMeetCandidates({
      self: side(mine),
      friend: side(theirs),
      friendName: 'Aditi',
    });

    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates.every((candidate) => candidate.source === 'shared')).toBe(true);
    // In the user's own travel order, which is the order they will reach them.
    const sequence = buildRouteStationSequence(mine).map((station) => station.stationId);
    const positions = candidates.map((candidate) => sequence.indexOf(candidate.stationId));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('says how far each of you is and who waits', () => {
    const candidates = buildMeetCandidates({
      self: side(mine),
      friend: side(theirs),
      friendName: 'Aditi',
    });
    // Not the first one: that is the station the user is standing at, which
    // reads "you're there" rather than counting stops.
    const ahead = candidates[candidates.length - 1];
    expect(ahead.detail).toMatch(/for you/);
    expect(ahead.detail).toMatch(/Aditi/);
  });

  it('falls back to their route when only they are travelling', () => {
    const candidates = buildMeetCandidates({
      self: null,
      friend: side(theirs),
      friendName: 'Aditi',
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => candidate.source === 'theirs')).toBe(true);
    expect(candidates[0].detail).toMatch(/Aditi gets there/);
  });

  it('falls back to my route when only I am travelling', () => {
    const candidates = buildMeetCandidates({ self: side(mine), friend: null, friendName: 'Aditi' });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => candidate.source === 'yours')).toBe(true);
    expect(candidates[0].detail).toMatch(/You get there/);
  });

  it('offers nothing when neither of us has a route', () => {
    expect(buildMeetCandidates({ self: null, friend: null, friendName: 'Aditi' })).toEqual([]);
  });

  it('drops stations either of us has already gone past', () => {
    const sequence = buildRouteStationSequence(mine);
    const nearTheEnd = sequence.length - 2;
    const candidates = buildMeetCandidates({
      self: side(mine, nearTheEnd),
      friend: side(theirs),
      friendName: 'Aditi',
    });
    const remaining = new Set(
      sequence.slice(nearTheEnd).map((station) => station.stationId),
    );
    expect(candidates.every((candidate) => remaining.has(candidate.stationId))).toBe(true);
  });

  it('falls back to their stops when two routes never cross', () => {
    // Nowhere in common, so an empty intersection would leave the picker with
    // nothing -- going to where they already are is still a real answer.
    const candidates = buildMeetCandidates({
      // A Blue Line branch run and an Aqua Line run: no station in common.
      self: side(route('dwarka-mor', 'dwarka-sector-21')),
      friend: side(route('noida-sector-143', 'noida-sector-148')),
      friendName: 'Aditi',
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => candidate.source === 'theirs')).toBe(true);
  });
});
