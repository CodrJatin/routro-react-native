import { getStation } from '../engine/graph';
import type { RouteMode, StationId } from '../engine/types';

/**
 * The journey a friend is currently travelling, as it crosses the wire.
 *
 * Structurally identical to `JourneySession` (see journey/journeyStore.ts) but
 * declared separately and deliberately: the realtime layer knows nothing about
 * journeys, it only relays an opaque record the journey controller hands it.
 * Same reasoning as `setBackgroundAllowed` in locationChannel.ts.
 *
 * Only the two station ids and the mode are sent -- never the computed route.
 * Every client bundles the same compiled graph and runs the same `findRoute`,
 * so shipping the itinerary would add nothing but a graph-version skew failure
 * mode: a sender on a newer build could describe a journey through stations the
 * receiver cannot draw.
 */
export interface SharedJourney {
  originId: StationId;
  destinationId: StationId;
  mode: RouteMode;
  /** ms since epoch, from the SENDER's clock. Display and cache-busting only,
   * never diffed against a local `Date.now()` -- same rule as `FriendLocation.ts`. */
  startedAt: number;
}

/**
 * Narrows the `journey` field of an untrusted presence payload, or null if
 * there isn't a usable one.
 *
 * The trust boundary for journey data, exactly as `parseLocPayload` is for
 * coordinates. Only an accepted friend can publish here, but a client version
 * mismatch is enough to send something malformed, and these ids flow into
 * `findRoute` and straight out to the map.
 *
 * Absent is a normal case, not an error: a friend not on a journey sends no
 * journey, and so does a friend running a build from before this existed.
 */
export function parseSharedJourney(value: unknown): SharedJourney | null {
  if (typeof value !== 'object' || value === null) return null;
  const { originId, destinationId, mode, startedAt } = value as Record<string, unknown>;

  if (typeof originId !== 'string' || typeof destinationId !== 'string') return null;
  if (originId === destinationId) return null;
  if (mode !== 'fastest' && mode !== 'min-interchange') return null;
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt) || startedAt <= 0) return null;

  // Checked here rather than left to `findRoute` returning null further in: a
  // journey naming stations this build has never heard of is not something to
  // carry around in the store and rediscover as an empty route at each of the
  // four places that read it.
  if (!getStation(originId) || !getStation(destinationId)) return null;

  return { originId, destinationId, mode, startedAt };
}
