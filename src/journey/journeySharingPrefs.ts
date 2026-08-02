import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'routro.journeySharing';

/**
 * Whether friends you are already sharing your location with also see where
 * that journey is going.
 *
 * Defaults on. The same accepted-friendship, private channel and RLS policies
 * gate this as gate the live position, and a friend who can watch you cross the
 * city can already infer most of it -- so an off-by-default switch would mostly
 * serve to hide the feature rather than to protect anyone.
 *
 * It exists at all because destination is a different kind of fact from
 * position: it says where you will be later, not only where you are now. That
 * is worth being able to decline without giving up location sharing entirely.
 *
 * A second, non-negotiable half of the rule lives in `locationChannel`: the
 * journey is only ever advertised while actually broadcasting. This preference
 * subtracts from that, never adds.
 */
interface JourneySharingState {
  shareJourney: boolean;
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  setShareJourney: (value: boolean) => void;
}

const DEFAULT_SHARE_JOURNEY = true;

export const useJourneySharingStore = create<JourneySharingState>((set, get) => ({
  shareJourney: DEFAULT_SHARE_JOURNEY,
  isHydrated: false,

  hydrate: async () => {
    if (get().isHydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      set({
        // Only an explicit stored 'false' turns it off. An unreadable or
        // absent value is the same as never having chosen, which is the
        // default.
        shareJourney: raw === null ? DEFAULT_SHARE_JOURNEY : raw === 'true',
        isHydrated: true,
      });
    } catch {
      set({ shareJourney: DEFAULT_SHARE_JOURNEY, isHydrated: true });
    }
  },

  setShareJourney: (value) => {
    set({ shareJourney: value });
    AsyncStorage.setItem(STORAGE_KEY, String(value)).catch(() => {
      // Best-effort; the in-memory value is what this session acts on.
    });
  },
}));

/** Read at publish time rather than captured when a journey starts, so turning
 * it off takes effect on the current journey rather than the next one. */
export function isJourneySharingEnabled(): boolean {
  return useJourneySharingStore.getState().shareJourney;
}
