import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useSelfPositionStore } from './selfPosition';

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

      Location.getLastKnownPositionAsync()
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
