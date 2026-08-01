import { describe, expect, it } from 'vitest';
import { findRoute } from '../../engine/graph';
import type { RouteMode, RouteResult } from '../../engine/types';
import type { RouteClock } from '../../route/routeClock';
import { buildRouteStationSequence, type RouteProgress } from '../../route/routeProgress';
import { findMeetingStations, type MeetingSide } from '../meetingStations';

function route(originId: string, destinationId: string, mode: RouteMode = 'fastest'): RouteResult {
  const result = findRoute(originId, destinationId, mode);
  if (!result) throw new Error(`no route ${originId} -> ${destinationId}`);
  return result;
}

/** Places someone at the Nth station of their own route, the way
 * `getRouteProgress` would if they were standing there. */
function progressAt(result: RouteResult, index: number): RouteProgress {
  const sequence = buildRouteStationSequence(result);
  const passedStationIds = new Set(
    sequence.filter((s) => s.index < index).map((s) => s.stationId),
  );
  for (const station of sequence) {
    if (station.index >= index) passedStationIds.delete(station.stationId);
  }
  return {
    sequence,
    nearestIndex: index,
    nearestStationId: sequence[index].stationId,
    distanceMeters: 20,
    passedStationIds,
  };
}

/** A live clock anchored at `anchorMs` on the station they are standing at --
 * the same construction `deriveFriendJourney` and `useRouteClock` produce. */
function clockAt(result: RouteResult, index: number, anchorMs: number): RouteClock {
  return {
    anchorMs,
    anchorOffsetSeconds: buildRouteStationSequence(result)[index].offsetSeconds,
    isLive: true,
  };
}

function side(result: RouteResult, index: number | null, anchorMs?: number): MeetingSide {
  return {
    route: result,
    progress: index === null ? null : progressAt(result, index),
    clock: index === null || anchorMs === undefined ? null : clockAt(result, index, anchorMs),
  };
}

describe('findMeetingStations', () => {
  it('finds nothing when the two routes never touch', () => {
    // A short Blue Line hop in west-central Delhi against a short Red Line hop
    // out in Rohini -- different lines, different corners, no shared stop.
    const self = route('ramesh-nagar', 'patel-nagar');
    const friend = route('rithala', 'kohat-enclave');
    expect(findMeetingStations(side(self, 0), side(friend, 0))).toEqual([]);
  });

  it('lists every station two overlapping routes share, in the viewer travel order', () => {
    // Both travel the same stretch of the Blue Line, the friend starting one
    // stop further along.
    const self = route('ramesh-nagar', 'patel-nagar');
    const friend = route('moti-nagar', 'patel-nagar');

    const options = findMeetingStations(side(self, 0), side(friend, 0));

    expect(options.length).toBeGreaterThan(1);
    // Ordered the way the viewer will physically reach them.
    const indices = options.map((o) => o.selfIndex);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    // Every option really is on both routes.
    const friendIds = new Set(buildRouteStationSequence(friend).map((s) => s.stationId));
    for (const option of options) {
      expect(friendIds.has(option.stationId)).toBe(true);
    }
    expect(options.map((o) => o.stationId)).toContain('patel-nagar');
  });

  it('excludes stations either person has already gone past', () => {
    const self = route('ramesh-nagar', 'patel-nagar');
    const friend = route('moti-nagar', 'patel-nagar');

    const sequence = buildRouteStationSequence(self);
    const all = findMeetingStations(side(self, 0), side(friend, 0));
    // Move the viewer to their second-to-last station: everything behind them
    // must drop out, since they are not going back for it.
    const late = findMeetingStations(side(self, sequence.length - 2), side(friend, 0));

    expect(late.length).toBeLessThan(all.length);
    for (const option of late) {
      expect(option.selfIndex).toBeGreaterThanOrEqual(sequence.length - 2);
    }
  });

  it('counts stops away from where each person currently is', () => {
    const self = route('ramesh-nagar', 'patel-nagar');
    const friend = route('moti-nagar', 'patel-nagar');

    const options = findMeetingStations(side(self, 0), side(friend, 0));
    const destination = options.find((o) => o.stationId === 'patel-nagar');
    expect(destination).toBeDefined();

    // The viewer boards one station earlier, so they always have at least as
    // far to go as the friend does.
    expect(destination!.selfStopsAway).toBeGreaterThan(0);
    expect(destination!.friendStopsAway).toBeGreaterThan(0);
    expect(destination!.selfStopsAway).toBeGreaterThanOrEqual(destination!.friendStopsAway);
  });

  it('offers the station someone is standing at right now', () => {
    // One person already at a station the other is still heading to is the most
    // obvious meeting point there is, so `>=` rather than `>` is deliberate.
    const self = route('ramesh-nagar', 'patel-nagar');
    const friend = route('moti-nagar', 'patel-nagar');
    const friendSequence = buildRouteStationSequence(friend);
    const lastIndex = friendSequence.length - 1;

    const options = findMeetingStations(side(self, 0), side(friend, lastIndex));

    const arrived = options.find((o) => o.stationId === 'patel-nagar');
    expect(arrived).toBeDefined();
    expect(arrived!.friendStopsAway).toBe(0);
  });

  it('reports who waits and for how long, from both clocks', () => {
    const self = route('ramesh-nagar', 'patel-nagar');
    const friend = route('moti-nagar', 'patel-nagar');

    const anchor = 1_700_000_000_000;
    // The friend's clock is anchored ten minutes later, so on identical
    // remaining track they arrive later and the viewer is the one waiting.
    const options = findMeetingStations(
      side(self, 0, anchor),
      side(friend, 0, anchor + 10 * 60_000),
    );

    const destination = options.find((o) => o.stationId === 'patel-nagar');
    expect(destination).toBeDefined();
    expect(destination!.selfArrivalMs).not.toBeNull();
    expect(destination!.friendArrivalMs).not.toBeNull();
    expect(destination!.friendArrivalMs!).toBeGreaterThan(destination!.selfArrivalMs!);
    expect(destination!.whoWaits).toBe('self');
    expect(destination!.waitMs).toBeGreaterThan(0);
    // Wait is always the absolute gap, never signed.
    expect(destination!.waitMs).toBe(
      Math.abs(destination!.friendArrivalMs! - destination!.selfArrivalMs!),
    );
  });

  it('still lists crossings when neither side has a clock', () => {
    // No fix from one of them is a reason to omit times, not to omit the
    // station -- "your routes cross at Patel Nagar" stands on its own.
    const self = route('ramesh-nagar', 'patel-nagar');
    const friend = route('moti-nagar', 'patel-nagar');

    const options = findMeetingStations(side(self, null), side(friend, null));

    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.selfArrivalMs).toBeNull();
      expect(option.friendArrivalMs).toBeNull();
      expect(option.waitMs).toBeNull();
      expect(option.whoWaits).toBeNull();
    }
  });

  it('lists a shared station once even when a route calls there twice', () => {
    const self = route('ramesh-nagar', 'patel-nagar');
    const friend = route('moti-nagar', 'patel-nagar');
    const options = findMeetingStations(side(self, 0), side(friend, 0));
    const ids = options.map((o) => o.stationId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
