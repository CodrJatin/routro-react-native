import { findRoute } from '../engine/graph';
import type { RouteResult, StationId } from '../engine/types';
import { routeClockMs, type RouteClock } from '../route/routeClock';
import { MAX_ON_ROUTE_DISTANCE_METERS } from '../route/routeProgress';
import { findStationOnRoute } from '../route/stationOnRoute';
import type { FriendJourneyView } from './friendJourney';
import { findNearestStation } from './nearestStation';

/** Below this the two arrivals are close enough that quoting a wait is noise
 * -- a minute of difference on a metro is inside the error bars of the
 * estimate itself. Matches what the old crossings list used. */
export const NEGLIGIBLE_WAIT_MS = 90_000;

/** Where a party's arrival estimate came from, so the UI can be honest about
 * how much to trust it. */
export type MeetArrivalSource =
  /** Derived from their live journey and last position -- recomputed as they
   * move, and as good as anything the app knows. */
  | 'live'
  /** The figure they quoted when they asked, anchored to when it landed here.
   * Fixed at that moment: it counts down but never corrects itself. */
  | 'quoted'
  | 'unknown';

export interface MeetArrival {
  /** Absolute ms on THIS device's clock, or null when it can't be said. */
  atMs: number | null;
  source: MeetArrivalSource;
}

/**
 * When the other person gets to the meeting station.
 *
 * Prefers their live journey, which keeps improving as they move, and falls
 * back to the duration they quoted when they asked -- anchored to the local
 * clock reading at the moment it arrived, never to a timestamp of theirs.
 * That fallback is the whole reason a request carries `etaSeconds`: it is
 * what lets someone who is not sharing their location still be timed.
 */
export function resolveOtherArrival(input: {
  /** Their journey as presence knows it, when they are sharing one. */
  liveJourney: FriendJourneyView | null;
  stationId: StationId;
  /** Seconds-to-station they quoted. */
  quotedEtaSeconds: number | null;
  /** This device's clock when that quote arrived (or when the meet was
   * agreed) -- what the quote is measured from. */
  quotedAnchorMs: number;
}): MeetArrival {
  const { liveJourney, stationId, quotedEtaSeconds, quotedAnchorMs } = input;

  if (liveJourney?.clock) {
    const onRoute = findStationOnRoute(liveJourney.route, stationId);
    if (onRoute) {
      return { atMs: routeClockMs(liveJourney.clock, onRoute.offsetSeconds), source: 'live' };
    }
  }

  if (quotedEtaSeconds !== null) {
    return { atMs: quotedAnchorMs + quotedEtaSeconds * 1000, source: 'quoted' };
  }

  return { atMs: null, source: 'unknown' };
}

export interface MeetTiming {
  /** When I reach the meeting station, or null if my route doesn't call there
   * (or I have no route at all). */
  myArrivalMs: number | null;
  theirArrivalMs: number | null;
  /** When both of us are actually there -- the later of the two. */
  meetAtMs: number | null;
  /** How long I stand there waiting for them. Zero when I'm the late one. */
  myWaitMs: number | null;
  /** How long they stand there waiting for me. */
  theirWaitMs: number | null;
  /** When I reach MY destination if I honour this meet: my ordinary arrival
   * pushed back by however long I have to wait. Null without a route. */
  destinationMs: number | null;
  /** How much later that is than not meeting at all. */
  delayMs: number | null;
  /** True when the meeting station is where my journey ends anyway, so
   * waiting costs me nothing -- I'm already where I was going. */
  isAtMyDestination: boolean;
}

const EMPTY: MeetTiming = {
  myArrivalMs: null,
  theirArrivalMs: null,
  meetAtMs: null,
  myWaitMs: null,
  theirWaitMs: null,
  destinationMs: null,
  delayMs: null,
  isAtMyDestination: false,
};

/**
 * What accepting this meet actually costs me.
 *
 * The number the request card is built around: not "when do they get here"
 * but "when do *I* get where I was going, if I wait for them". Waiting is
 * paid once, at the meeting station, and every remaining minute of the
 * journey simply happens that much later -- so the delay is the wait, and the
 * new destination time is the old one plus it.
 *
 * The wait itself is decided by whoever arrives *later*: that is when the two
 * of them are in the same place, and it is the only time either can leave
 * again together.
 */
export function computeMeetTiming(input: {
  myRoute: RouteResult | null;
  myClock: RouteClock | null;
  stationId: StationId;
  theirArrivalMs: number | null;
}): MeetTiming {
  const { myRoute, myClock, stationId, theirArrivalMs } = input;

  if (!myRoute || !myClock) {
    return { ...EMPTY, theirArrivalMs, meetAtMs: theirArrivalMs };
  }

  const onRoute = findStationOnRoute(myRoute, stationId);
  if (!onRoute) {
    return { ...EMPTY, theirArrivalMs, meetAtMs: theirArrivalMs };
  }

  const myArrivalMs = routeClockMs(myClock, onRoute.offsetSeconds);
  const baseDestinationMs = routeClockMs(myClock, myRoute.totalTimeSeconds);
  // The last station of the journey is also somewhere the journey "calls at",
  // so meeting there is legitimate -- it just doesn't delay anything, because
  // there is no journey left to delay.
  const isAtMyDestination = onRoute.isDestination || onRoute.offsetSeconds >= myRoute.totalTimeSeconds;

  if (theirArrivalMs === null) {
    return {
      myArrivalMs,
      theirArrivalMs: null,
      meetAtMs: null,
      myWaitMs: null,
      theirWaitMs: null,
      destinationMs: baseDestinationMs,
      delayMs: null,
      isAtMyDestination,
    };
  }

  const myWaitMs = Math.max(0, theirArrivalMs - myArrivalMs);
  const theirWaitMs = Math.max(0, myArrivalMs - theirArrivalMs);
  const delayMs = isAtMyDestination ? 0 : myWaitMs;

  return {
    myArrivalMs,
    theirArrivalMs,
    meetAtMs: Math.max(myArrivalMs, theirArrivalMs),
    myWaitMs,
    theirWaitMs,
    destinationMs: baseDestinationMs + delayMs,
    delayMs,
    isAtMyDestination,
  };
}

/** My own seconds-to-station along a route, for quoting to the other side.
 * Null when the route doesn't call there. */
export function secondsToStation(
  route: RouteResult | null,
  clock: RouteClock | null,
  stationId: StationId,
  nowMs: number,
): number | null {
  if (!route || !clock) return null;
  const onRoute = findStationOnRoute(route, stationId);
  if (!onRoute) return null;
  // Never negative: a station already behind you is quoted as "now" rather
  // than as a time in the past, which the receiving side has no way to read.
  return Math.max(0, (routeClockMs(clock, onRoute.offsetSeconds) - nowMs) / 1000);
}

/**
 * Seconds to a station for someone with no route at all -- routed from
 * whichever station they are standing nearest to.
 *
 * The fallback behind `secondsToStation`, and the reason someone who isn't
 * following or even planning a journey can still ask a friend to meet: their
 * position alone is enough to say roughly when they could be there. Null when
 * they are too far from the network for that to mean anything, which is the
 * same threshold everything else here uses.
 */
export function secondsToStationFromPosition(
  position: { lat: number; lon: number } | null,
  stationId: StationId,
): number | null {
  if (!position) return null;
  const from = findNearestStation(position.lat, position.lon);
  if (!from || from.distanceMeters > MAX_ON_ROUTE_DISTANCE_METERS) return null;
  if (from.stationId === stationId) return 0;
  const route = findRoute(from.stationId, stationId, 'fastest');
  return route ? route.totalTimeSeconds : null;
}
