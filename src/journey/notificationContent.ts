import type { JourneyNotificationContent } from '../../modules/journey-service';
import { getCompiledGraph } from '../engine/graph';
import type { RouteResult } from '../engine/types';
import { formatRouteClock, type RouteClock } from '../route/routeClock';
import {
  buildRouteStationSequence,
  type RouteProgress,
  type RouteStation,
} from '../route/routeProgress';

/**
 * What the ongoing notification says, as one pure function.
 *
 * Pure and separate from the controller on purpose: this is the only part of
 * background tracking that can be tested without a device, and it is also the
 * part most likely to be wrong in a way nobody notices -- an off-by-one in the
 * stop count reads as perfectly plausible right up until someone misses their
 * station because of it.
 */
export function buildJourneyNotification(
  route: RouteResult,
  progress: RouteProgress | null,
  clock: RouteClock,
): JourneyNotificationContent {
  // Without progress there is no sequence to borrow, so build one -- the
  // journey still has a destination and an arrival time worth showing.
  const sequence = progress?.sequence ?? buildRouteStationSequence(route);
  const lastIndex = sequence.length - 1;
  const destinationName = sequence[lastIndex].stationName;

  if (!progress) {
    return {
      title: `${destinationName} · ${formatRouteClock(clock, sequence[lastIndex].offsetSeconds)}`,
      // Deliberately not a stop count: without a fix we don't know how many
      // are left, and guessing from the origin would claim the user hasn't
      // started when they may be halfway there.
      body: 'Waiting for your location',
      color: lineColor(route, 0),
      showStopAction: true,
    };
  }

  const current = progress.nearestIndex;
  const remaining = lastIndex - current;

  if (remaining === 0) {
    return {
      title: `Arrived at ${destinationName}`,
      body: 'Journey complete',
      progress: { current: lastIndex, max: lastIndex },
      color: lineColor(route, sequence[current].legIndex),
      showStopAction: true,
    };
  }

  const interchange = nextInterchangeIndex(sequence, current);
  const isAtInterchange = interchange === current;
  // At the interchange the useful colour is the line being changed *to* --
  // the one the user is about to be standing on, not the one they arrived on.
  const colorLegIndex = isAtInterchange
    ? sequence[current].legIndex + 1
    : sequence[current].legIndex;

  return {
    title: `${destinationName} · ${formatRouteClock(clock, sequence[lastIndex].offsetSeconds)}`,
    body: bodyFor(route, sequence, current, interchange, remaining, destinationName),
    progress: { current, max: lastIndex },
    color: lineColor(route, colorLegIndex),
    showStopAction: true,
  };
}

function bodyFor(
  route: RouteResult,
  sequence: RouteStation[],
  current: number,
  interchange: number,
  remaining: number,
  destinationName: string,
): string {
  // Ordered by urgency: what to do right now beats what to do next, which
  // beats where you are.
  if (interchange === current) {
    return `Change here for the ${lineName(route, sequence[current].legIndex + 1)}`;
  }
  if (remaining === 1) {
    return `Get off at ${destinationName} next`;
  }
  if (interchange === current + 1) {
    return `${stops(remaining)} · change at ${sequence[interchange].stationName}`;
  }
  return `${stops(remaining)} · next ${sequence[current + 1].stationName}`;
}

/**
 * Where the journey next changes lines, at or after `fromIndex`, or -1.
 *
 * A change is visible in the sequence as a leg boundary: the station you
 * alight at keeps the leg it was reached on, and the one after it belongs to
 * the next leg. That holds for a cross-platform change (where both are the
 * same station, deduplicated to one entry) and for a walking transfer (where
 * they are genuinely two stations), so one rule covers both.
 */
function nextInterchangeIndex(sequence: RouteStation[], fromIndex: number): number {
  for (let i = fromIndex; i < sequence.length - 1; i++) {
    if (sequence[i].legIndex < sequence[i + 1].legIndex) return i;
  }
  return -1;
}

function stops(count: number): string {
  return `${count} ${count === 1 ? 'stop' : 'stops'}`;
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
