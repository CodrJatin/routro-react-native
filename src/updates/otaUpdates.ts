import * as Updates from 'expo-updates';
import { useJourneyStore } from '../journey/journeyStore';

/**
 * Bringing over-the-air updates in without ever interrupting someone.
 *
 * expo-updates on its own already checks at launch and applies what it found
 * at the *next* launch, so the gap this closes is narrower than it looks: an
 * app that is opened, backgrounded and reopened for days without ever being
 * cold-started never checks again, and a downloaded update sits unapplied for
 * just as long. Checking on the way back into the app fixes both halves.
 *
 * What it must not do is reload at a bad moment, and there are two of those.
 */

/**
 * How long the user must have been away before a downloaded update is applied
 * on their return.
 *
 * A reload is a full JS restart -- the map redraws, the friends list refetches,
 * and any half-finished tap is gone. After ten minutes away that is
 * indistinguishable from opening the app fresh, which is exactly the point:
 * the update lands in the one moment it costs nothing. Come back sooner and
 * the update simply waits, since it is already downloaded and expo-updates
 * will apply it at the next launch regardless. Nothing is lost by being
 * patient here; something real is lost by not being.
 */
export const APPLY_AFTER_AWAY_MS = 10 * 60 * 1000;

/**
 * Set once this session has downloaded an update.
 *
 * Kept alongside the `isPending` argument rather than instead of it, because
 * the two know different things. `isPending` comes from `Updates.useUpdates()`
 * and covers an update the automatic launch-time check already fetched -- but
 * it is React state, so a foreground that fetches and then immediately wants
 * to decide about reloading is reading it a render too early. This flag is
 * written synchronously by the fetch itself.
 */
let hasFetchedThisSession = false;

/** In-flight guard. A check on a bad connection outlasts several foreground
 * events, and each must not start its own. */
let isSyncing = false;

/** Test seam: module state has to be resettable between cases. */
export function resetOtaState(): void {
  hasFetchedThisSession = false;
  isSyncing = false;
}

/**
 * Called when the app returns to the foreground, with how long it was away and
 * whether an update is already downloaded and waiting.
 *
 * Resolves when the attempt is done. It does not resolve after a reload, for
 * the reason the expo-updates docs give: `reloadAsync` settles immediately
 * before the reload is actually posted to the main thread, so anything after
 * it is running on borrowed time. Nothing here does more than clear a flag.
 */
export async function syncUpdateOnForeground(
  awayForMs: number,
  isPending: boolean,
): Promise<void> {
  // Dev builds load their JS from Metro, and all three of the calls below
  // reject outright there. `isEnabled` additionally covers a build with no
  // update URL configured.
  if (__DEV__ || !Updates.isEnabled) return;
  if (isSyncing) return;

  // The first of the two bad moments, and the more important one: a journey is
  // being tracked. It survives a reload -- `initJourneyController` reconciles
  // a running service against a restored session on purpose -- but surviving
  // is not the same as being free. A restart drops the realtime channels,
  // stands the location watcher back up and reruns startup, in the middle of
  // the ride the user started this for. A journey also spends most of its life
  // backgrounded, so the away-time rule below would otherwise call this the
  // perfect moment to reload.
  if (useJourneyStore.getState().session) return;

  isSyncing = true;
  try {
    const mayApply = awayForMs >= APPLY_AFTER_AWAY_MS;

    // Already downloaded -- by the launch-time check, or by an earlier
    // foreground. Nothing to fetch, only a decision about when to apply it.
    if (hasFetchedThisSession || isPending) {
      if (mayApply) await Updates.reloadAsync();
      return;
    }

    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return;

    await Updates.fetchUpdateAsync();
    hasFetchedThisSession = true;
    if (mayApply) await Updates.reloadAsync();
  } catch (error) {
    // Never fatal, and deliberately quiet. Being offline is the usual reason
    // and is not worth a word to the user: the app they already have works,
    // and the next foreground will try again.
    console.warn('[updates] could not sync an update', error);
  } finally {
    isSyncing = false;
  }
}
