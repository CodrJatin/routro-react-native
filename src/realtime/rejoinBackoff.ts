/**
 * The one retry ladder every Realtime channel in this app rejoins on.
 *
 * Defined once for the same reason `watchOptions.ts` exists: there are three
 * independent things here that reconnect -- the user's own location channel,
 * each friend's location channel, and each meet channel -- and the moment two
 * of them carry their own copy of these numbers, they drift. The friend
 * channels and the own channel already shared this ladder by having it written
 * out twice in one file; the meet channels did not retry at all.
 */

/**
 * The quick attempts, tried in order before settling into the interval below.
 *
 * There is no attempt limit and no give-up state. That is a deliberate
 * reversal of the obvious design, and it is worth saying why: a dropped socket
 * is the ordinary condition of a phone on a metro, not an error, and a bounded
 * ladder simply means a tunnel longer than the budget ends the feature and
 * makes the user notice and fix it by hand. The banner already says the
 * connection is down, so nothing is being hidden by continuing to try.
 *
 * The ramp exists only to catch a momentary blip -- the gap between two
 * carriages of signal -- in seconds, rather than making the user wait out a
 * full interval for something that was already over.
 */
export const REJOIN_DELAYS_MS = [3000, 7000];

/**
 * The steady interval the retries settle into once the quick attempts are used
 * up.
 *
 * Deliberately flat rather than an exponential backoff. Past the ramp this is
 * a real outage, and there is nothing to be gained by backing off further: a
 * longer tunnel would only mean a slower recovery, which is precisely
 * backwards. A rejoin on a socket that is already down is a local no-op, not a
 * network round trip, so this costs effectively nothing.
 */
export const REJOIN_INTERVAL_MS = 10_000;

/** How long to wait before attempt number `attempt` (1-based). */
export function rejoinDelayFor(attempt: number): number {
  return REJOIN_DELAYS_MS[attempt - 1] ?? REJOIN_INTERVAL_MS;
}
