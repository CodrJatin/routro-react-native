import { useEffect, useReducer, useRef } from 'react';
import type { FriendLocation } from '../realtime/locationStore';

/** Clamps on the animation duration. The gap between two fixes is the honest
 * duration to glide over, but a first fix after a long silence would
 * otherwise crawl across the screen for a minute, and a burst of fixes would
 * flicker. */
const MIN_DURATION_MS = 600;
const MAX_DURATION_MS = 6000;

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Where a friend's pin should be drawn right now: somewhere along the line
 * from their previous fix to their current one, rather than snapped to the
 * latest. */
function positionAt(location: FriendLocation, now: number): [number, number] {
  const previous = location.previous;
  if (!previous) return [location.lon, location.lat];

  const gap = location.receivedAt - previous.receivedAt;
  if (!Number.isFinite(gap) || gap <= 0) return [location.lon, location.lat];

  const duration = Math.min(Math.max(gap, MIN_DURATION_MS), MAX_DURATION_MS);
  const t = (now - location.receivedAt) / duration;
  if (t >= 1) return [location.lon, location.lat];
  if (t <= 0) return [previous.lon, previous.lat];

  const eased = easeOutCubic(t);
  return [lerp(previous.lon, location.lon, eased), lerp(previous.lat, location.lat, eased)];
}

function isAnimating(location: FriendLocation, now: number): boolean {
  const previous = location.previous;
  if (!previous) return false;
  const gap = location.receivedAt - previous.receivedAt;
  if (!Number.isFinite(gap) || gap <= 0) return false;
  const duration = Math.min(Math.max(gap, MIN_DURATION_MS), MAX_DURATION_MS);
  return now - location.receivedAt < duration;
}

/**
 * Glides friend pins between broadcasts instead of teleporting them every
 * few seconds.
 *
 * The original design rejected smooth movement because it assumed the only
 * option was a Reanimated view per friend. This is the cheaper third way:
 * interpolate the *coordinates* on a frame loop and let the existing markers
 * follow, so there are no extra views and no extra animated nodes.
 *
 * The loop only runs while at least one pin is actually mid-glide, and stops
 * itself the moment they have all arrived -- an idle map costs nothing. The
 * pins trail roughly one broadcast interval behind the true position, which
 * is the standard trade for not extrapolating into positions a friend never
 * actually occupied.
 */
export function useInterpolatedPositions(
  locations: FriendLocation[],
): Record<string, [number, number]> {
  const [, tick] = useReducer((count: number) => count + 1, 0);
  const frameRef = useRef<number | null>(null);

  // Re-keyed on the fixes themselves: a new broadcast replaces the array, which
  // restarts the loop for the fresh animation window.
  const signature = locations.map((l) => `${l.userId}:${l.receivedAt}`).join('|');

  useEffect(() => {
    let cancelled = false;

    const step = () => {
      if (cancelled) return;
      const now = Date.now();
      if (!locations.some((location) => isAnimating(location, now))) {
        frameRef.current = null;
        return; // everything has arrived -- stop until the next fix
      }
      tick();
      frameRef.current = requestAnimationFrame(step);
    };

    if (locations.some((location) => isAnimating(location, Date.now()))) {
      frameRef.current = requestAnimationFrame(step);
    }

    return () => {
      cancelled = true;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature`
    // stands in for the fix set; depending on the array itself would restart
    // the loop on every unrelated re-render.
  }, [signature]);

  const now = Date.now();
  const positions: Record<string, [number, number]> = {};
  for (const location of locations) {
    positions[location.userId] = positionAt(location, now);
  }
  return positions;
}
