import { useMemo } from 'react';
import { findRoute } from '../engine/graph';
import type { RouteResult } from '../engine/types';
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
