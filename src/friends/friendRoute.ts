import { findRoute } from '../engine/graph';
import type { RouteResult } from '../engine/types';
import type { SharedJourney } from '../realtime/sharedJourney';

/**
 * How many computed friend routes to keep.
 *
 * Comfortably more than the number of friends who could plausibly be
 * travelling at once, so in practice nothing is ever evicted mid-journey. The
 * cap exists to stop a long session from accumulating every route every friend
 * has taken all day.
 */
const MAX_CACHED_ROUTES = 24;

/** Keyed by what actually determines the route, so two friends travelling the
 * same trip share one entry. `startedAt` is deliberately excluded: it
 * identifies the journey, not the path, and including it would recompute the
 * identical route for a friend who restarted the same trip. */
const cache = new Map<string, RouteResult | null>();

function keyFor(journey: SharedJourney): string {
  return `${journey.originId}|${journey.destinationId}|${journey.mode}`;
}

/**
 * The route a friend is travelling, computed with the same engine as the user's
 * own journey.
 *
 * Friends' positions arrive every few seconds and several surfaces derive from
 * this one (their progress, their line, their per-station arrivals, the
 * polyline, the meeting-point list), so an uncached `findRoute` would run a
 * Dijkstra search per friend per surface per tick. The inputs only change when
 * the friend starts a different journey, which is exactly what the key
 * captures.
 *
 * Nulls are cached too: an unroutable pair stays unroutable, and re-running the
 * search to rediscover that on every tick is the more expensive half of the
 * problem, not the cheaper one.
 */
export function getFriendRoute(journey: SharedJourney | null | undefined): RouteResult | null {
  if (!journey) return null;

  const key = keyFor(journey);
  const cached = cache.get(key);
  // `has` rather than a truthy check -- a cached null is a real answer.
  if (cached !== undefined || cache.has(key)) return cached ?? null;

  const route = findRoute(journey.originId, journey.destinationId, journey.mode);

  if (cache.size >= MAX_CACHED_ROUTES) {
    // Oldest insertion first. Map preserves insertion order, so this is the
    // entry least recently *added* -- not a true LRU, which would need a
    // reorder on every read for a cache this size to gain nothing.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, route);
  return route;
}

/** Test seam. Nothing in the app clears this -- the compiled graph is static,
 * so a cached route can never go out of date within a session. */
export function clearFriendRouteCache(): void {
  cache.clear();
}
