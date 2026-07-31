import { getCompiledGraph } from '../engine/graph';
import type { RouteResult } from '../engine/types';
import type { RouteProgress, RouteStation } from '../route/routeProgress';

export type JourneyAlertKind =
  | 'approaching-interchange'
  | 'interchange-now'
  | 'approaching-destination'
  | 'arrived';

/**
 * How close counts as being *at* a station rather than still heading for it.
 *
 * `getRouteProgress` reports the nearest station on the route, and "nearest"
 * flips to the next one at the midpoint of the hop -- so it marks you as being
 * at a station while the train is still half a hop short of it. Alerts phrased
 * as "the next stop" have to tell those two apart, or they fire a station and
 * a half early and the sentence is simply untrue when it arrives.
 */
export const AT_STATION_METERS = 300;

export interface JourneyAlert {
  kind: JourneyAlertKind;
  /**
   * Unique within one journey. Latched on, so a fix that jitters back and
   * forth across a station boundary can't buzz the user twice for the same
   * event. Keyed by sequence index rather than station id because a route may
   * legitimately call at the same station twice.
   */
  key: string;
  title: string;
  body: string;
  /** The line this is about, for tinting. */
  color?: string;
  /**
   * The key of an earlier alert that already said everything this one would.
   *
   * "Arrived at Hauz Khas" lands about 25 seconds after "Get off at the next
   * stop", and tells someone already standing at the doors nothing they don't
   * know. Two buzzes half a minute apart is how an app gets muted, so the
   * caller drops this one when that key has already fired -- and keeps it when
   * it hasn't, which is the case where the user got no warning at all (no fix
   * until late, or they started the journey mid-ride).
   */
  redundantAfter?: string;
}

/**
 * What, if anything, the user should be told right now.
 *
 * Pure and stateless, like `getRouteProgress` beneath it -- it answers "what
 * is true at this position", not "what is new". Deciding what has already been
 * said is the caller's job (see `journeyController`), which keeps the rules
 * here testable without simulating a journey's history.
 *
 * Returns at most one alert. Two things buzzing at once is how a user learns
 * to silence an app, and the cases are ordered so the more urgent one wins:
 * being told to get off beats being told what is coming up.
 */
export function journeyAlertFor(
  route: RouteResult,
  progress: RouteProgress | null,
): JourneyAlert | null {
  if (!progress) return null;

  const { sequence, nearestIndex: current, distanceMeters } = progress;
  const lastIndex = sequence.length - 1;

  // The whole timing model, in one line. Being *nearest* to a station means
  // the one before it is behind you; being *at* it means you have arrived.
  // "The next stop" is only a true statement in the first case.
  const isAtStation = distanceMeters <= AT_STATION_METERS;

  if (current === lastIndex) {
    const approachingKey = `approaching-destination:${lastIndex}`;
    if (!isAtStation) {
      return {
        kind: 'approaching-destination',
        key: approachingKey,
        title: 'Get off at the next stop',
        body: `${sequence[lastIndex].stationName} is next.`,
        color: lineColor(route, sequence[lastIndex].legIndex),
      };
    }
    return {
      kind: 'arrived',
      key: `arrived:${lastIndex}`,
      title: `Arrived at ${sequence[lastIndex].stationName}`,
      body: 'Journey complete.',
      color: lineColor(route, sequence[lastIndex].legIndex),
      redundantAfter: approachingKey,
    };
  }

  const interchange = nextInterchangeIndex(sequence, current);
  if (interchange !== current) return null;

  const toLegIndex = sequence[current].legIndex + 1;
  const approachingKey = `approaching-interchange:${current}`;

  if (!isAtStation) {
    return {
      kind: 'approaching-interchange',
      key: approachingKey,
      title: 'Change at the next stop',
      body: `Change at ${sequence[current].stationName} for the ${lineName(route, toLegIndex)}.`,
      color: lineColor(route, toLegIndex),
    };
  }

  return {
    kind: 'interchange-now',
    key: `interchange-now:${current}`,
    title: `Change at ${sequence[current].stationName}`,
    body: `Take the ${lineName(route, toLegIndex)} from here.`,
    color: lineColor(route, toLegIndex),
    redundantAfter: approachingKey,
  };
}

/**
 * Where the journey next changes lines, at or after `fromIndex`, or -1.
 *
 * Same rule `notificationContent` uses: a change shows up as a leg boundary
 * between adjacent stations, which covers both a cross-platform change (one
 * deduplicated station) and a walking transfer (two genuine ones).
 */
function nextInterchangeIndex(sequence: RouteStation[], fromIndex: number): number {
  for (let i = fromIndex; i < sequence.length - 1; i++) {
    if (sequence[i].legIndex < sequence[i + 1].legIndex) return i;
  }
  return -1;
}

function lineName(route: RouteResult, legIndex: number): string {
  const leg = route.legs[legIndex];
  if (!leg) return 'next line';
  return getCompiledGraph().lines[leg.line]?.name ?? 'next line';
}

function lineColor(route: RouteResult, legIndex: number): string | undefined {
  const leg = route.legs[legIndex];
  if (!leg) return undefined;
  return getCompiledGraph().lines[leg.line]?.color;
}
