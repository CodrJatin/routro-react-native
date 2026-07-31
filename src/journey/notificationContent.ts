import type {
  JourneyNotificationContent,
  JourneyTrackerPoint,
  JourneyTrackerSegment,
} from '../../modules/journey-service';
import { getCompiledGraph } from '../engine/graph';
import type { RouteResult } from '../engine/types';
import { formatRouteClock, routeClockMs, type RouteClock } from '../route/routeClock';
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
 *
 * The surface is built around one idea: **the title is the instruction**. This
 * is read on a lock screen, one-handed, on a moving train, and the only
 * question being asked of it is "what do I do now" -- so that answer gets the
 * biggest line, and the destination, the clock and the line name arrange
 * themselves around it. Everything else is drawn rather than written: the
 * route becomes the coloured tracker, and the arrival becomes a countdown the
 * system ticks down on its own.
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
      title: `Following to ${destinationName}`,
      // Deliberately not a stop count: without a fix we don't know how many
      // are left, and guessing from the origin would claim the user hasn't
      // started when they may be halfway there. The tracker and the countdown
      // are withheld for the same reason -- both would draw a confident
      // picture of a position we do not have.
      body: 'Waiting for your location',
      subText: lineName(route, 0),
      color: lineColor(route, 0),
      showStopAction: true,
    };
  }

  const current = progress.nearestIndex;
  const remaining = lastIndex - current;
  const segments = trackerSegments(route, sequence, lastIndex);
  const points = trackerPoints(route, sequence);

  if (remaining === 0) {
    return {
      title: `Arrived at ${destinationName}`,
      body: 'Journey complete',
      subText: lineName(route, sequence[current].legIndex),
      progress: { current: lastIndex, max: lastIndex },
      segments,
      points,
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
    title: titleFor(route, sequence, current, interchange, remaining, destinationName),
    body: bodyFor(route, sequence, current, interchange, remaining, clock),
    subText: lineName(route, colorLegIndex),
    progress: { current, max: lastIndex },
    segments,
    points,
    countdownToMs: routeClockMs(clock, sequence[lastIndex].offsetSeconds),
    color: lineColor(route, colorLegIndex),
    showStopAction: true,
  };
}

/**
 * The instruction, in order of urgency: what to do right now beats what to do
 * next, which beats where you are.
 *
 * Phrased as something to *do* even in the last case -- "6 stops to Hauz Khas"
 * rather than "Hauz Khas · 10:42" -- because a title that only names a place
 * makes the reader do the subtraction themselves.
 */
function titleFor(
  route: RouteResult,
  sequence: RouteStation[],
  current: number,
  interchange: number,
  remaining: number,
  destinationName: string,
): string {
  if (interchange === current) {
    return `Change here for the ${lineName(route, sequence[current].legIndex + 1)}`;
  }
  if (remaining === 1) {
    return `Get off at ${destinationName} next`;
  }
  return `${stops(remaining)} to ${destinationName}`;
}

/** The supporting line: what's coming, and when the journey ends. */
function bodyFor(
  route: RouteResult,
  sequence: RouteStation[],
  current: number,
  interchange: number,
  remaining: number,
  clock: RouteClock,
): string {
  const arrival = `arrive ${formatRouteClock(clock, sequence[sequence.length - 1].offsetSeconds)}`;

  if (interchange === current) {
    // Standing on the platform of a change: the count to the destination is
    // what the title no longer has room for.
    return `${stops(remaining)} to go · ${arrival}`;
  }
  if (remaining === 1) {
    return arrival.charAt(0).toUpperCase() + arrival.slice(1);
  }
  if (interchange === current + 1) {
    return `Next ${sequence[interchange].stationName} · change for the ${lineName(route, sequence[interchange].legIndex + 1)}`;
  }
  return `Next ${sequence[current + 1].stationName} · ${arrival}`;
}

/**
 * The journey's legs as tracker segments, measured in stations.
 *
 * Android derives the bar's maximum by adding these up, so they have to span
 * the whole sequence exactly -- which they do, because a leg owns every station
 * from the one it boards at up to (not including) the next leg's boarding
 * station, and the last leg runs to the destination. Anything that doesn't add
 * up is dropped rather than drawn wrong: a short bar would silently misplace
 * the marker for the entire journey.
 */
function trackerSegments(
  route: RouteResult,
  sequence: RouteStation[],
  lastIndex: number,
): JourneyTrackerSegment[] | undefined {
  const legStarts: number[] = [];
  let seen = -1;
  for (const station of sequence) {
    if (station.legIndex > seen) {
      seen = station.legIndex;
      legStarts.push(station.index);
    }
  }

  const segments = legStarts.map((start, i) => ({
    length: (legStarts[i + 1] ?? lastIndex) - start,
    color: lineColor(route, i),
  }));

  if (segments.some((segment) => segment.length <= 0)) return undefined;
  return segments;
}

/** Every interchange, marked on the bar in the colour of the line being
 * changed to -- so the shape of the journey reads without a word of text. */
function trackerPoints(route: RouteResult, sequence: RouteStation[]): JourneyTrackerPoint[] {
  const points: JourneyTrackerPoint[] = [];
  for (let i = 0; i < sequence.length - 1; i++) {
    if (sequence[i].legIndex < sequence[i + 1].legIndex) {
      points.push({ position: i, color: lineColor(route, sequence[i + 1].legIndex) });
    }
  }
  return points;
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
