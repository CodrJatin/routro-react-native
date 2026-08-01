import { useMemo } from 'react';
import { getStation } from '../engine/graph';
import type { CompiledStation, LineId, RouteResult } from '../engine/types';
import { useLocationStore, type FriendLocation } from '../realtime/locationStore';
import type { SharedJourney } from '../realtime/sharedJourney';
import type { RouteClock } from '../route/routeClock';
import { getRouteProgress, type RouteProgress } from '../route/routeProgress';
import { getFriendRoute } from './friendRoute';

/** Everything derivable about a friend who is sharing a journey. */
export interface FriendJourneyView {
  journey: SharedJourney;
  route: RouteResult;
  destination: CompiledStation;
  /** Where they are along it, or null when we can't say honestly -- no fix
   * from them yet, or a fix nowhere near the route they claim to be on. */
  progress: RouteProgress | null;
  /**
   * What their remaining arrival times are pinned to, or null when there is no
   * honest way to pin them.
   *
   * Anchored to `receivedAt` -- THIS device's clock at the moment their fix
   * landed -- and to the station they were nearest to then. Two consequences,
   * both wanted:
   *
   * - It never touches the sender's clock, so a friend whose phone is set ten
   *   minutes fast doesn't shift every time we quote for them.
   * - It is not re-pinned to now, so a friend whose last fix is 40s old reads
   *   40s behind rather than being silently marched forward. Their staleness
   *   shows up in the times instead of being hidden by them.
   *
   * Null rather than a "leaving now" fallback, which is what the user's own
   * clock does when it can't go live. That fallback is honest for a journey
   * you are planning; for someone else's journey in progress it would invent
   * a departure that never happened.
   */
  clock: RouteClock | null;
  /** The line they are riding right now, read off the leg they are on rather
   * than inferred from their direction of travel. Null without progress. */
  currentLineId: LineId | null;
  /** Stations left to their destination, or null without progress. */
  remainingStops: number | null;
}

/**
 * Combines what a friend broadcasts (a position) with what they advertise on
 * presence (a journey) into one answer.
 *
 * Deliberately reuses the self-journey machinery end to end -- `findRoute` via
 * the friend route cache, `getRouteProgress`, `RouteClock` -- rather than
 * growing a parallel set of "where is this person" rules that could disagree
 * with the ones the user's own journey is drawn from.
 */
export function deriveFriendJourney(
  journey: SharedJourney | null | undefined,
  location: FriendLocation | null | undefined,
): FriendJourneyView | null {
  if (!journey) return null;

  const route = getFriendRoute(journey);
  if (!route) return null;

  const destination = getStation(journey.destinationId);
  if (!destination) return null;

  const progress = location
    ? getRouteProgress(route, { lat: location.lat, lon: location.lon })
    : null;

  // `location` is necessarily non-null wherever progress is -- progress is
  // derived from it -- but TypeScript can't see that, and re-deriving the
  // anchor is cheaper than convincing it.
  const clock: RouteClock | null =
    progress && location
      ? {
          anchorMs: location.receivedAt,
          anchorOffsetSeconds: progress.sequence[progress.nearestIndex].offsetSeconds,
          isLive: true,
        }
      : null;

  const currentLineId = progress
    ? (route.legs[progress.sequence[progress.nearestIndex].legIndex]?.line ?? null)
    : null;

  return {
    journey,
    route,
    destination,
    progress,
    clock,
    currentLineId,
    remainingStops: progress ? progress.sequence.length - 1 - progress.nearestIndex : null,
  };
}

/** One friend's journey, or null if they aren't sharing one. */
export function useFriendJourney(userId: string | null | undefined): FriendJourneyView | null {
  const journey = useLocationStore((state) =>
    userId ? state.friendJourneys[userId] : undefined,
  );
  const location = useLocationStore((state) => (userId ? state.friendLocations[userId] : undefined));

  return useMemo(() => deriveFriendJourney(journey, location), [journey, location]);
}

/** Every friend currently sharing a journey, keyed by user id. For the surfaces
 * that ask "who is on a journey through here" rather than "where is this one
 * person" -- the map's station card and the destination markers. */
export function useFriendJourneys(): Record<string, FriendJourneyView> {
  const friendJourneys = useLocationStore((state) => state.friendJourneys);
  const friendLocations = useLocationStore((state) => state.friendLocations);

  return useMemo(() => {
    const result: Record<string, FriendJourneyView> = {};
    for (const [userId, journey] of Object.entries(friendJourneys)) {
      const view = deriveFriendJourney(journey, friendLocations[userId]);
      if (view) result[userId] = view;
    }
    return result;
  }, [friendJourneys, friendLocations]);
}
