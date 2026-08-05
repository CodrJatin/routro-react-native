import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'routro.onboardingComplete';

/**
 * Whether the intro has been got through -- by reading it, by skipping it, or
 * by signing in past it. All three count, deliberately: this flag answers "has
 * this person been shown the door", not "did they read the sign on it".
 *
 * Persisted, and gating navigation, so the root layout has to wait for
 * `isHydrated` before it renders anything. Guessing false while the read is in
 * flight would put returning users through a flash of the intro on every cold
 * start; guessing true would hide it from the one person it exists for.
 */
interface OnboardingState {
  hasCompleted: boolean;
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  complete: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  hasCompleted: false,
  isHydrated: false,

  hydrate: async () => {
    if (get().isHydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      set({ hasCompleted: raw === 'true', isHydrated: true });
    } catch {
      // Unreadable: show the intro. It is skippable in two taps, which is a far
      // smaller cost than a first-run user never being told what the app does
      // with their location.
      set({ hasCompleted: false, isHydrated: true });
    }
  },

  complete: () => {
    if (get().hasCompleted) return;
    set({ hasCompleted: true });
    AsyncStorage.setItem(STORAGE_KEY, 'true').catch(() => {
      // Best-effort. Worst case the intro appears once more next launch.
    });
  },
}));
