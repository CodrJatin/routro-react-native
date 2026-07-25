import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'metrosync.basemapEnabled';

interface BasemapState {
  /** True once the user has opted in to real map tiles in Settings. */
  isEnabled: boolean;
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  setEnabled: (isEnabled: boolean) => void;
}

/** A store rather than a hook with local state: Settings writes the preference
 * and the map screen reads it, and both stay mounted at once under the tab
 * navigator. Two independent `useState`s would drift.
 *
 * Off is the default and the failure mode -- an unreadable store, or a read
 * that hasn't landed yet, leaves the map fully offline rather than reaching
 * for the network on a setting the user never enabled. */
export const useBasemapStore = create<BasemapState>((set, get) => ({
  isEnabled: false,
  isHydrated: false,

  hydrate: async () => {
    if (get().isHydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      set({ isEnabled: raw === 'true', isHydrated: true });
    } catch {
      set({ isEnabled: false, isHydrated: true });
    }
  },

  setEnabled: (isEnabled) => {
    set({ isEnabled });
    AsyncStorage.setItem(STORAGE_KEY, String(isEnabled)).catch(() => {
      // Best-effort: the in-memory value stays correct for this session.
    });
  },
}));
