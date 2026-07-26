import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import type { RouteResult } from '../engine/types';
import type { RouteClock } from './routeClock';
import type { RouteProgress } from './routeProgress';

/**
 * How often a live clock re-anchors itself. Times render to the minute, so
 * this only has to be fine enough that a minute never turns over late.
 */
const LIVE_TICK_MS = 20_000;

/**
 * The clock the itinerary and the map's station card both read from, so the
 * two can never quote different arrival times for the same station.
 *
 * `progress` being non-null is the whole gate on going live: it already means
 * we have a fix and it's within MAX_ON_ROUTE_DISTANCE_METERS of this route.
 * See RouteClock for what each mode is and what it costs.
 */
export function useRouteClock(
  route: RouteResult | null,
  progress: RouteProgress | null,
): RouteClock {
  const isLive = progress !== null;
  const anchorOffsetSeconds = progress
    ? progress.sequence[progress.nearestIndex].offsetSeconds
    : 0;

  const [anchorMs, setAnchorMs] = useState(() => Date.now());

  // Re-pinned whenever what the offsets are measured *from* changes: a new
  // route, a new station reached along it, or gaining/losing the fix that
  // decides between the two modes.
  useEffect(() => {
    setAnchorMs(Date.now());
  }, [route, anchorOffsetSeconds, isLive]);

  // Live only. Frozen, the offsets are a snapshot of one departure, and
  // re-timing them every 20s would march the whole itinerary forward for
  // nothing.
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setAnchorMs(Date.now()), LIVE_TICK_MS);
    return () => clearInterval(id);
  }, [isLive]);

  // A screen left open for an hour must not still be quoting hour-old times.
  useFocusEffect(
    useCallback(() => {
      setAnchorMs(Date.now());
    }, []),
  );

  return { anchorMs, anchorOffsetSeconds, isLive };
}
