import { useMemo } from 'react';
import { findRoute } from '../engine/graph';
import type { RouteResult, StationId } from '../engine/types';
import { useJourneyStore } from '../journey/journeyStore';
import { useSelfPositionStore } from '../location/selfPosition';
import { useActiveRouteStore } from './activeRouteStore';
import { getRouteProgress, type RouteProgress } from './routeProgress';
import type { RouteClock } from './routeClock';
import { useRouteClock } from './useRouteClock';

export interface SelfRouteView {
  route: RouteResult;
  progress: RouteProgress | null;
  clock: RouteClock;
  /** Which of the two the route came from. 'journey' is a trip actually being
   * tracked; 'planner' is one the user has merely got on screen. */
  source: 'journey' | 'planner';
}

/**
 * The user's own journey, from whichever of the two places currently has one.
 *
 * A tracked journey wins over whatever the planner is showing: it is the trip
 * the user committed to, and it survives them idly typing another pair of
 * stations into the route screen afterwards.
 *
 * Exists so that everything comparing the user's route against a friend's --
 * the meeting stations, chiefly -- resolves "your route" the same way. Two
 * screens picking different answers is precisely the class of disagreement
 * `useFriendStatuses` and `selfPosition` were each introduced to end.
 */
/**
 * Where the user is headed, by the same precedence `readSelfRoute` uses but
 * without computing the route.
 *
 * For background code that only needs the destination and runs often enough
 * that a Dijkstra pass per call would be silly -- the friend alerts, which ask
 * this question every time a friend's fix lands near a station. Kept here
 * rather than inlined at the call site so that "a tracked journey outranks
 * whatever the planner is showing" stays decided in exactly one place.
 */
export function readSelfDestinationId(): StationId | null {
  const session = useJourneyStore.getState().session;
  if (session) return session.destinationId;
  const planner = useActiveRouteStore.getState();
  return planner.originId && planner.destinationId ? planner.destinationId : null;
}

/**
 * The same answer as `useSelfRoute`, read once without a component.
 *
 * For the code that has to resolve "your route" with nothing mounted -- the
 * meet controller quoting an arrival time at the moment a request is sent or
 * answered. Deliberately shares this file with the hook rather than living
 * next to its caller: two implementations of "which route is the user's" is
 * exactly the disagreement this module exists to prevent.
 *
 * The clock it returns is pinned to now, which is correct for a one-shot
 * question. The hook's clock re-pins itself over time; this one is read and
 * discarded in the same breath.
 */
export function readSelfRoute(): SelfRouteView | null {
  const session = useJourneyStore.getState().session;
  const planner = useActiveRouteStore.getState();

  const resolved = session
    ? { route: findRoute(session.originId, session.destinationId, session.mode), source: 'journey' as const }
    : planner.originId && planner.destinationId
      ? {
          route: findRoute(planner.originId, planner.destinationId, planner.mode),
          source: 'planner' as const,
        }
      : null;

  if (!resolved?.route) return null;

  const progress = getRouteProgress(resolved.route, useSelfPositionStore.getState().position);
  return {
    route: resolved.route,
    progress,
    clock: {
      anchorMs: Date.now(),
      anchorOffsetSeconds: progress ? progress.sequence[progress.nearestIndex].offsetSeconds : 0,
      isLive: progress !== null,
    },
    source: resolved.source,
  };
}

export function useSelfRoute(): SelfRouteView | null {
  const session = useJourneyStore((state) => state.session);
  const plannerOriginId = useActiveRouteStore((state) => state.originId);
  const plannerDestinationId = useActiveRouteStore((state) => state.destinationId);
  const plannerMode = useActiveRouteStore((state) => state.mode);
  const position = useSelfPositionStore((state) => state.position);

  const resolved = useMemo(() => {
    if (session) {
      const route = findRoute(session.originId, session.destinationId, session.mode);
      return route ? { route, source: 'journey' as const } : null;
    }
    if (!plannerOriginId || !plannerDestinationId) return null;
    const route = findRoute(plannerOriginId, plannerDestinationId, plannerMode);
    return route ? { route, source: 'planner' as const } : null;
  }, [session, plannerOriginId, plannerDestinationId, plannerMode]);

  const progress = useMemo(
    () => getRouteProgress(resolved?.route ?? null, position),
    [resolved, position],
  );

  // Called unconditionally -- hooks cannot be skipped, and it handles a null
  // route by simply never going live.
  const clock = useRouteClock(resolved?.route ?? null, progress);

  return useMemo(
    () => (resolved ? { route: resolved.route, progress, clock, source: resolved.source } : null),
    [resolved, progress, clock],
  );
}
