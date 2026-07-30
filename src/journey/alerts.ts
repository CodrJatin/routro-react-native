import { getCompiledGraph } from '../engine/graph';
import type { RouteResult } from '../engine/types';
import type { RouteProgress, RouteStation } from '../route/routeProgress';

export type JourneyAlertKind =
  | 'approaching-interchange'
  | 'interchange-now'
  | 'approaching-destination'
  | 'arrived';

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

  const { sequence, nearestIndex: current } = progress;
  const lastIndex = sequence.length - 1;

  if (current === lastIndex) {
    return {
      kind: 'arrived',
      key: `arrived:${current}`,
      title: `Arrived at ${sequence[current].stationName}`,
      body: 'Journey complete.',
      color: lineColor(route, sequence[current].legIndex),
    };
  }

  const interchange = nextInterchangeIndex(sequence, current);

  if (interchange === current) {
    const toLegIndex = sequence[current].legIndex + 1;
    return {
      kind: 'interchange-now',
      key: `interchange-now:${current}`,
      title: `Change at ${sequence[current].stationName}`,
      body: `Take the ${lineName(route, toLegIndex)} from here.`,
      color: lineColor(route, toLegIndex),
    };
  }

  // Destination before interchange: if both are one stop away, the interchange
  // is the destination's own station and "get off" is the more useful sentence.
  if (current === lastIndex - 1) {
    return {
      kind: 'approaching-destination',
      key: `approaching-destination:${current}`,
      title: 'Get off at the next stop',
      body: `${sequence[lastIndex].stationName} is next.`,
      color: lineColor(route, sequence[current].legIndex),
    };
  }

  if (interchange === current + 1) {
    const toLegIndex = sequence[interchange].legIndex + 1;
    return {
      kind: 'approaching-interchange',
      key: `approaching-interchange:${interchange}`,
      title: 'Change at the next stop',
      body: `Change at ${sequence[interchange].stationName} for the ${lineName(route, toLegIndex)}.`,
      color: lineColor(route, toLegIndex),
    };
  }

  return null;
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
