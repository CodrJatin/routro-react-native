import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { create } from 'zustand';

export interface SelfPosition {
  lat: number;
  lon: number;
  /** ms since epoch, this device's clock -- used only to decide whether a
   * last-known read is worth writing over what's already here. */
  at: number;
}

interface SelfPositionState {
  position: SelfPosition | null;
  /** A fix from the live GPS watcher. Always wins: it's now. */
  setLive: (lat: number, lon: number) => void;
  /** A fix from the OS's last-known cache, which may be minutes or hours
   * old -- so it only fills a gap, never overwrites something fresher. */
  seed: (lat: number, lon: number, at: number) => void;
}

/**
 * Where the user is, shared across screens.
 *
 * The map runs a live GPS watcher; the route planner and Friends deliberately
 * don't (a second watcher is exactly what the map screen was fixed to avoid).
 * Without somewhere shared to put the answer, those screens each read the
 * OS's last-known fix independently and could place the user at different
 * stations on the same journey at the same moment. One store, one answer.
 *
 * In-memory only. A stale position restored from disk on next launch would be
 * worse than none -- it would show progress along a journey the user isn't on.
 */
export const useSelfPositionStore = create<SelfPositionState>((set, get) => ({
  position: null,

  setLive: (lat, lon) => set({ position: { lat, lon, at: Date.now() } }),

  seed: (lat, lon, at) => {
    const current = get().position;
    if (current && current.at >= at) return;
    set({ position: { lat, lon, at } });
  },
}));

/**
 * Fills the store from the OS's last-known fix whenever the calling screen
 * comes into focus. Cheap and watcher-free: it reads a cache the OS already
 * keeps rather than powering up GPS, and does nothing at all without location
 * permission (the read simply resolves null).
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
