import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'metrosync.basemapEnabled';
/** A key of its own rather than a JSON blob under the one above: the basemap
 * setting is already shipped, and re-encoding it would mean writing a migration
 * for a single boolean. */
const PLACE_LABELS_STORAGE_KEY = 'metrosync.basemapPlaceLabels';

interface BasemapState {
  /** True once the user has opted in to real map tiles in Settings. */
  isEnabled: boolean;
  /** Whether the basemap draws OSM's own place names. Only meaningful while
   * `isEnabled` -- see `placeLabelsEnabled` in mapStyle.ts. */
  arePlaceLabelsEnabled: boolean;
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  setEnabled: (isEnabled: boolean) => void;
  setPlaceLabelsEnabled: (arePlaceLabelsEnabled: boolean) => void;
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
  // Off by default, unlike the basemap's own default-off-because-network
  // reasoning: OSM's place names sit on top of the station names this app
  // exists to show, and someone who turns real streets on is asking for the
  // streets, not for a second set of labels competing with ours.
  arePlaceLabelsEnabled: false,
  isHydrated: false,

  hydrate: async () => {
    if (get().isHydrated) return;
    try {
      const [enabled, placeLabels] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(PLACE_LABELS_STORAGE_KEY),
      ]);
      set({
        isEnabled: enabled === 'true',
        arePlaceLabelsEnabled: placeLabels === 'true',
        isHydrated: true,
      });
    } catch {
      set({ isEnabled: false, arePlaceLabelsEnabled: false, isHydrated: true });
    }
  },

  setEnabled: (isEnabled) => {
    set({ isEnabled });
    AsyncStorage.setItem(STORAGE_KEY, String(isEnabled)).catch(() => {
      // Best-effort: the in-memory value stays correct for this session.
    });
  },

  setPlaceLabelsEnabled: (arePlaceLabelsEnabled) => {
    set({ arePlaceLabelsEnabled });
    AsyncStorage.setItem(PLACE_LABELS_STORAGE_KEY, String(arePlaceLabelsEnabled)).catch(() => {
      // Best-effort, as above.
    });
  },
}));
