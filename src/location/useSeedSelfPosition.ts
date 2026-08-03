import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useSelfPositionStore } from './selfPosition';

/**
 * Bounds on what the OS's cache is allowed to seed us with.
 *
 * Unbounded, `getLastKnownPositionAsync` will happily return a fix from hours
 * ago and tens of kilometres away -- whatever it last happened to record. The
 * store's `seed` refuses to overwrite something fresher, but with an empty
 * store there is nothing to refuse against, so on a cold open that fix became
 * the user's position: it drove `getRouteProgress`, and so decided which
 * stations the app believed were already behind them.
 *
 * Two minutes and 200 metres keeps this doing the job it exists for -- covering
 * the seconds before the first real fix -- while making it decline to answer at
 * all rather than answer wrongly. A null seed is a state the app already
 * handles everywhere; a confidently wrong one is not.
 */
const SEED_MAX_AGE_MS = 120_000;
const SEED_REQUIRED_ACCURACY_METERS = 200;

/**
 * Fills the store from the OS's last-known fix whenever the calling screen
 * comes into focus. Cheap and watcher-free: it reads a cache the OS already
 * keeps rather than powering up GPS, and does nothing at all without location
 * permission (the read simply resolves null).
 *
 * Split out of `selfPosition.ts` so the store itself stays importable from the
 * broadcast manager and the journey controller, neither of which is a
 * component and neither of which should be pulling in expo-router.
 */
export function useSeedSelfPosition() {
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      Location.getLastKnownPositionAsync({
        maxAge: SEED_MAX_AGE_MS,
        requiredAccuracy: SEED_REQUIRED_ACCURACY_METERS,
      })
        .then((position) => {
          if (cancelled || !position) return;
          useSelfPositionStore
            .getState()
            .seed(position.coords.latitude, position.coords.longitude, position.timestamp);
        })
        .catch(() => {
          // No permission, no cached fix, or the provider is off -- all of
          // which just mean "we don't know where you are", handled by null.
        });

      return () => {
        cancelled = true;
      };
    }, []),
  );
}
