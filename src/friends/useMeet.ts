import { useEffect, useMemo } from 'react';
import { getStation } from '../engine/graph';
import type { RouteResult, StationId } from '../engine/types';
import { useLocationStore } from '../realtime/locationStore';
import type { RouteClock } from '../route/routeClock';
import { buildStationMarks, type RouteProgress } from '../route/routeProgress';
import { useSelfRoute } from '../route/useSelfRoute';
import { deriveFriendJourney, useFriendJourney, type FriendJourneyView } from './friendJourney';
import {
  useMeetStore,
  type AcceptedMeet,
  type IncomingMeetRequest,
  type OutgoingMeetRequest,
} from './meetStore';
import {
  computeMeetTiming,
  NEGLIGIBLE_WAIT_MS,
  resolveOtherArrival,
  type MeetArrivalSource,
  type MeetTiming,
} from './meetTiming';

/** Requests waiting on an answer, soonest to expire first -- the one running
 * out is the one to put in front of the user. */
export function useIncomingMeetRequests(): IncomingMeetRequest[] {
  const incoming = useMeetStore((state) => state.incoming);
  return useMemo(
    () => Object.values(incoming).sort((a, b) => a.expiresAt - b.expiresAt),
    [incoming],
  );
}

/** Everything this app knows about meeting one particular friend. */
export function useMeetWith(friendUserId: string): {
  incoming: IncomingMeetRequest | null;
  outgoing: OutgoingMeetRequest | null;
  meet: AcceptedMeet | null;
} {
  const incomingAll = useMeetStore((state) => state.incoming);
  const outgoing = useMeetStore((state) => state.outgoing[friendUserId] ?? null);
  const meet = useMeetStore((state) => state.meets[friendUserId] ?? null);

  const incoming = useMemo(
    () => Object.values(incomingAll).find((request) => request.fromUserId === friendUserId) ?? null,
    [incomingAll, friendUserId],
  );

  return { incoming, outgoing, meet };
}

export interface MeetRequestView {
  friendName: string;
  stationName: string;
  /** Where the asker is headed, when they told us. */
  senderDestinationName: string | null;
  timing: MeetTiming;
  arrivalSource: MeetArrivalSource;
  /** Where the answering user is headed. Null when they have no route, in
   * which case there is no "and then you arrive at" to quote. */
  myDestinationName: string | null;
}

/**
 * The card's whole model: who is asking, where, and what saying yes costs.
 *
 * Recomputed as either side moves -- the asker's arrival comes from their live
 * journey where there is one, and the answering user's from their own route
 * clock, which re-pins itself as they travel.
 */
export function useMeetRequestView(request: IncomingMeetRequest): MeetRequestView {
  const friendName = useFriendName(request.fromUserId);
  const liveJourney = useFriendJourney(request.fromUserId);

  // What they told us when they asked, used only when they are not sharing a
  // live journey. Derived rather than read: it has to go through the same
  // route/progress machinery as a live one or the two would place them
  // differently.
  const quotedJourney = useMemo(
    () => journeyFromQuote(request.fromUserId, request),
    [request],
  );

  const selfRoute = useSelfRoute();

  const arrival = useMemo(
    () =>
      resolveOtherArrival({
        liveJourney: liveJourney ?? quotedJourney,
        stationId: request.stationId,
        quotedEtaSeconds: request.etaSeconds,
        quotedAnchorMs: request.receivedAt,
      }),
    [liveJourney, quotedJourney, request],
  );

  const timing = useMemo(
    () =>
      computeMeetTiming({
        myRoute: selfRoute?.route ?? null,
        myClock: selfRoute?.clock ?? null,
        stationId: request.stationId,
        theirArrivalMs: arrival.atMs,
      }),
    [selfRoute, request.stationId, arrival.atMs],
  );

  return {
    friendName,
    stationName: getStation(request.stationId)?.name ?? 'that station',
    senderDestinationName:
      (liveJourney ?? quotedJourney)?.destination.name ??
      (request.journey ? (getStation(request.journey.destinationId)?.name ?? null) : null),
    timing,
    arrivalSource: arrival.source,
    myDestinationName: selfRoute
      ? (getStation(selfRoute.route.destinationStationId)?.name ?? null)
      : null,
  };
}

export interface AgreedMeetView {
  stationName: string;
  /** The same sentence the itinerary node uses, so the Friends tab and the
   * route screen can never describe one meet two ways. */
  label: string;
  timing: MeetTiming;
  friendName: string;
}

/** A meet both sides agreed to, as one line of text. */
export function useAgreedMeetView(meet: AcceptedMeet): AgreedMeetView {
  const friendName = useFriendName(meet.friendUserId);
  const liveJourney = useFriendJourney(meet.friendUserId);
  const selfRoute = useSelfRoute();

  return useMemo(() => {
    const arrival = resolveOtherArrival({
      liveJourney,
      stationId: meet.stationId,
      quotedEtaSeconds: meet.theirEtaSeconds,
      quotedAnchorMs: meet.agreedAt,
    });
    const timing = computeMeetTiming({
      myRoute: selfRoute?.route ?? null,
      myClock: selfRoute?.clock ?? null,
      stationId: meet.stationId,
      theirArrivalMs: arrival.atMs,
    });
    return {
      friendName,
      stationName: getStation(meet.stationId)?.name ?? 'that station',
      label: meetMarkerLabel(friendName, timing),
      timing,
    };
  }, [friendName, liveJourney, selfRoute, meet]);
}

export interface MeetMarker {
  stationId: StationId;
  friendUserId: string;
  friendName: string;
  /** One line for the itinerary: "Wait 11 min for Aditi". */
  label: string;
  timing: MeetTiming;
}

/**
 * Agreed meets that fall on this route, as itinerary markers.
 *
 * Also where a meet ends: once the station is behind the user they have either
 * met or missed each other, and either way the itinerary should stop telling
 * them to wait there.
 */
export function useMeetMarkers(
  route: RouteResult | null,
  clock: RouteClock,
  progress: RouteProgress | null,
): MeetMarker[] {
  const meets = useMeetStore((state) => state.meets);
  const clearMeet = useMeetStore((state) => state.clearMeet);
  const friendNames = useLocationStore((state) => state.friendNames);
  const friendJourneys = useLocationStore((state) => state.friendJourneys);
  const friendLocations = useLocationStore((state) => state.friendLocations);

  const marks = useMemo(() => buildStationMarks(progress), [progress]);

  // Passed the meeting point: the meet is over, however it went.
  const passed = useMemo(
    () =>
      Object.values(meets)
        .filter((meet) => marks.get(meet.stationId) === 'passed')
        .map((meet) => meet.friendUserId),
    [meets, marks],
  );
  useEffect(() => {
    for (const friendUserId of passed) clearMeet(friendUserId);
  }, [passed, clearMeet]);

  return useMemo(() => {
    if (!route) return [];

    const markers: MeetMarker[] = [];
    for (const meet of Object.values(meets)) {
      if (marks.get(meet.stationId) === 'passed') continue;

      const friendName = friendNames[meet.friendUserId] ?? 'your friend';
      const liveJourney = deriveFriendJourney(
        friendJourneys[meet.friendUserId],
        friendLocations[meet.friendUserId],
      );
      const arrival = resolveOtherArrival({
        liveJourney,
        stationId: meet.stationId,
        quotedEtaSeconds: meet.theirEtaSeconds,
        quotedAnchorMs: meet.agreedAt,
      });
      const timing = computeMeetTiming({
        myRoute: route,
        myClock: clock,
        stationId: meet.stationId,
        theirArrivalMs: arrival.atMs,
      });

      // Not on this route at all -- the user has since planned something else.
      if (timing.myArrivalMs === null) continue;

      markers.push({
        stationId: meet.stationId,
        friendUserId: meet.friendUserId,
        friendName,
        label: meetMarkerLabel(friendName, timing),
        timing,
      });
    }
    return markers;
  }, [route, clock, marks, meets, friendNames, friendJourneys, friendLocations]);
}

/** The one sentence the itinerary node says. */
export function meetMarkerLabel(friendName: string, timing: MeetTiming): string {
  if (timing.myWaitMs === null) return `Meeting ${friendName} here`;
  if (timing.myWaitMs >= NEGLIGIBLE_WAIT_MS) {
    return `Wait ${Math.round(timing.myWaitMs / 60_000)} min for ${friendName}`;
  }
  if ((timing.theirWaitMs ?? 0) >= NEGLIGIBLE_WAIT_MS) {
    return `${friendName} waits ${Math.round((timing.theirWaitMs ?? 0) / 60_000)} min for you`;
  }
  return `Meet ${friendName} here — you arrive together`;
}

function useFriendName(userId: string): string {
  return useLocationStore((state) => state.friendNames[userId] ?? 'A friend');
}

/**
 * The asker's journey as of the moment they asked.
 *
 * Point of the whole `journey` + `position` pair on the wire: a friend who
 * isn't sharing their location has no presence entry to read, so this is the
 * only way to place them on a route and time them at all. Anchored to when the
 * request landed here, so it ages honestly rather than pretending to be live.
 */
function journeyFromQuote(
  userId: string,
  request: IncomingMeetRequest,
): FriendJourneyView | null {
  if (!request.journey || !request.position) return null;
  return deriveFriendJourney(request.journey, {
    userId,
    lat: request.position.lat,
    lon: request.position.lon,
    ts: request.receivedAt,
    receivedAt: request.receivedAt,
    movedAt: request.receivedAt,
    previous: null,
  });
}
