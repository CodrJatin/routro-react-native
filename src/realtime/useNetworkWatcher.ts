import * as Network from 'expo-network';
import { useEffect, useRef } from 'react';
import { locationChannelManager } from './locationChannel';
import { useLocationStore } from './locationStore';

/**
 * Watches the device's own network state, so the app stops guessing at it.
 *
 * Two things come out of knowing this, and they are worth separating.
 *
 * The first is honesty. Every drop looked identical from inside the reconnect
 * ladder, so the banner said "Reconnecting" whether the server was
 * unreachable or the user had simply turned wifi off with no signal to fall
 * back on. Those call for different things from the person reading it -- one
 * is "wait", the other is "do something" -- and only one of them is worth
 * offering a Retry button for.
 *
 * The second is speed. The ladder settles at a flat ten seconds, which is the
 * right patience for an outage nobody can see the end of, but it is exactly
 * wrong for the moment a train pulls out of a tunnel: the radio is back, the
 * socket could be too, and the app would sit there for most of that interval
 * anyway. That is the gap the Retry button was really covering, and it should
 * not have needed a user to press it.
 */
export function useNetworkWatcher(): void {
  /** The last state acted on, so only an actual transition triggers a retry.
   * expo-network reports every change -- wifi to cellular, a band switch --
   * and most of them are not a recovery. */
  const wasOnline = useRef(true);

  useEffect(() => {
    let isCancelled = false;

    const apply = (state: Network.NetworkState) => {
      if (isCancelled) return;
      // `isInternetReachable` is the stronger claim and the one that matters:
      // Android reports a connected network for a wifi access point with no
      // route out, which is a captive portal and is not internet. It is
      // undefined where the platform cannot say, hence the fallback rather
      // than a strict test -- an unknown network is treated as present, so a
      // missing answer never suppresses the app's own reporting.
      const isOnline = state.isInternetReachable ?? state.isConnected ?? true;
      useLocationStore.getState().setOnline(isOnline);

      const recovered = isOnline && !wasOnline.current;
      wasOnline.current = isOnline;

      // Bring the next attempt forward rather than waiting out the interval.
      // `retryNow` is the same entry point the banner's button uses, and it is
      // safe to call at any time: the manager collapses overlapping attempts
      // and returns immediately if the channel is already joined.
      if (recovered) {
        console.warn('[network] back online, retrying the realtime connection');
        void locationChannelManager.retryNow();
      }
    };

    // Seeded once, because the listener only reports changes -- an app opened
    // with no connection would otherwise believe it had one until the radio
    // next did something.
    void Network.getNetworkStateAsync()
      .then(apply)
      .catch((error: unknown) => {
        // Not fatal, and deliberately not treated as offline: failing to read
        // the network is not evidence of anything about the network.
        console.warn('[network] could not read initial network state', error);
      });

    const subscription = Network.addNetworkStateListener(apply);

    return () => {
      isCancelled = true;
      subscription.remove();
    };
  }, []);
}
