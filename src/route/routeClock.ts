import type { RouteStationMark } from './routeProgress';

/**
 * What the journey's station offsets are pinned to on the wall clock.
 *
 * Two modes, and the difference matters:
 *
 * - Not live: the offsets hang off the trip origin, so the itinerary reads
 *   "if you left now". The only honest answer when we don't know where the
 *   user is, or they're nowhere near this route (planning it from home).
 * - Live: the offsets hang off the station the user is actually nearest to,
 *   re-pinned to *now* on every tick. A train sitting on a platform, or
 *   someone waiting there for a friend, therefore pushes every remaining
 *   arrival out in real time instead of quietly going stale.
 *
 * The cost of the live mode is mid-hop pessimism: between two stations the
 * anchor is still the one behind you, so the next arrival reads a full hop
 * away right up until you get there. It corrects itself on arrival, and it
 * beats quoting times measured from a departure that already happened.
 *
 * `useRouteClock` is what produces one of these.
 */
export interface RouteClock {
  /** Wall clock, in ms, that `anchorOffsetSeconds` corresponds to. */
  anchorMs: number;
  /** The journey offset (seconds from the trip origin) that `anchorMs` is. */
  anchorOffsetSeconds: number;
  /** Anchored to where the user actually is rather than to "leaving now". */
  isLive: boolean;
}

/** When the journey reaches a station at `offsetSeconds`, as a timestamp. */
export function routeClockMs(clock: RouteClock, offsetSeconds: number): number {
  return clock.anchorMs + (offsetSeconds - clock.anchorOffsetSeconds) * 1000;
}

export function formatRouteClock(clock: RouteClock, offsetSeconds: number): string {
  const d = new Date(routeClockMs(clock, offsetSeconds));
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * The arrival time as a station row should show it.
 *
 * A station already behind you has no arrival left to quote -- the time it
 * would print is in the past, and a past clock time next to a live journey
 * reads as a delay rather than as history. Where you are now says "Now" for
 * the same reason: it's the one station whose arrival isn't a prediction.
 *
 * Marks only exist when progress does, which is also the only time the clock
 * is live -- so a planned journey still shows a clock time on every row.
 */
export function formatStationArrival(
  clock: RouteClock,
  offsetSeconds: number,
  mark: RouteStationMark | undefined,
): string {
  if (mark === 'passed') return 'Passed';
  if (mark === 'current') return 'Now';
  return formatRouteClock(clock, offsetSeconds);
}
