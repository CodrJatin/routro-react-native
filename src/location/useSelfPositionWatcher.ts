import * as Location from 'expo-location';
import { useEffect } from 'react';
import { useSelfPositionStore } from './selfPosition';
import { logFixAccuracy, watchOptions } from './watchOptions';

/** How long to wait before trying again after the provider errors or the
 * watcher won't start. Long enough not to spin on a device with location
 * switched off, short enough to pick GPS back up on the walk out of a tunnel. */
const RETRY_DELAY_MS = 5000;

/**
 * Keeps `useSelfPositionStore` current from a GPS watcher of this screen's
 * own, for as long as `enabled` stays true.
 *
 * Callers are expected to pass false whenever a journey or broadcasting is
 * already running a watcher -- both write to the same store, and a second
 * consumer of the same GPS is pure battery cost for identical fixes.
 *
 * Retries rather than giving up. The previous version of this ran through
 * MapLibre's own native location engine, which starts silently and stays
 * silent: a watcher that failed to start, or a provider that stopped
 * delivering, left a pin frozen on screen with nothing anywhere saying so.
 */
export function useSelfPositionWatcher(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRetry = () => {
      if (cancelled || retryTimer !== null) return;
      subscription?.remove();
      subscription = null;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void start();
      }, RETRY_DELAY_MS);
    };

    const start = async () => {
      try {
        const next = await Location.watchPositionAsync(
          // Shared with the broadcast and journey watchers -- see
          // `watchOptions.ts` for why these must not be per-file copies.
          watchOptions(),
          (position) => {
            logFixAccuracy('map', position.coords.accuracy);
            useSelfPositionStore
              .getState()
              .setLive(position.coords.latitude, position.coords.longitude);
          },
          // The provider reporting a problem -- location switched off
          // mid-session being the obvious one. Without this it goes nowhere
          // and the watcher is simply dead from then on.
          (reason) => {
            console.warn(`[location] self watcher stopped: ${reason}`);
            scheduleRetry();
          },
        );

        if (cancelled) {
          // Disabled while `watchPositionAsync` was resolving -- remove what
          // was just created rather than leaking a watcher with no handle
          // left to stop it.
          next.remove();
          return;
        }
        subscription = next;
      } catch (error) {
        console.warn('[location] self watcher failed to start', error);
        scheduleRetry();
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      subscription?.remove();
      subscription = null;
    };
  }, [enabled]);
}
