import * as Location from 'expo-location';
import { useEffect } from 'react';
import { useSelfPositionStore } from './selfPosition';

/** Matches the journey and broadcast watchers, so whichever of the three is
 * running costs the same and produces the same kind of fix. */
const LOCATION_INTERVAL_MS = 5000;

/**
 * Deliberately zero, where the other two watchers filter at 15 metres.
 *
 * `distanceInterval` is a hard filter in the OS, not a hint -- nothing is
 * delivered at all until the device has moved that far. The other watchers can
 * live with that because they only care about movement. This one also has to
 * answer "is this position still current?", and a filtered watcher is
 * indistinguishable from a dead one while the user stands on a platform: the
 * pin would fade to stale (see `SELF_POSITION_STALE_AFTER_MS`) purely for not
 * moving. Unfiltered delivery costs no extra power -- the provider is already
 * running at `LOCATION_INTERVAL_MS` either way, this only stops the OS
 * throwing the results away.
 */
const LOCATION_DISTANCE_METERS = 0;

/** How long to wait before trying again after the provider errors or the
 * watcher won't start. Long enough not to spin on a device with location
 * switched off, short enough to pick GPS back up on the walk out of a tunnel. */
const RETRY_DELAY_MS = 5000;

/**
 * Off, and the single most important option here.
 *
 * expo-location defaults this to true, which means that on Android, with
 * device location switched off, `watchPositionAsync` opens Google Play's "turn
 * on location?" dialog on its own -- and rejects when the user declines. This
 * watcher starts by itself whenever the map is on screen and retries on
 * failure, so that combination put a system dialog in front of anyone who
 * opened the Map tab with location off, and put it back every
 * `RETRY_DELAY_MS`, forever, no matter how many times they said no.
 *
 * Nothing about a pin drawing itself justifies interrupting the user. With
 * this off the watcher installs quietly and simply never receives a fix, which
 * is the same state a tunnel produces and is already handled. Asking to switch
 * location on belongs to the things the user actually asked for -- the locate
 * button and the sharing toggle -- and only at the moment they ask.
 */
const MAY_SHOW_USER_SETTINGS_DIALOG = false;

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
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: LOCATION_INTERVAL_MS,
            distanceInterval: LOCATION_DISTANCE_METERS,
            mayShowUserSettingsDialog: MAY_SHOW_USER_SETTINGS_DIALOG,
          },
          (position) => {
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
