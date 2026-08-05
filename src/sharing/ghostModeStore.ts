import { create } from 'zustand';

/**
 * Ghost Mode: nothing goes out, nothing comes in.
 *
 * Symmetric on purpose. A user hidden from their friends while still watching
 * them is the one behaviour that would make this app worth distrusting, and
 * a privacy mode that costs its user nothing is one they would leave on
 * permanently -- which is the same empty map that off-by-default sharing
 * produced, arrived at from the other direction.
 *
 * Deliberately NOT persisted, and that absence is the entire implementation of
 * "it resets when you swipe the app away". Zustand state lives in the JS heap:
 * it survives backgrounding, where the user is still in the middle of whatever
 * they went dark for, and dies with the process, which is exactly what a swipe
 * kills. Writing it to AsyncStorage would mean adding a deliberate clear-on-
 * cold-start path to undo the persistence we had just added.
 *
 * One caveat worth knowing about: Android also kills processes under memory
 * pressure, and nothing can tell that apart from a swipe. Someone who goes
 * ghost, leaves the app for a long time and comes back may find themselves
 * visible again. Nothing was shared while the process was dead, so the gap is
 * one of expectation rather than exposure -- but it is a real gap.
 */
interface GhostModeState {
  isGhost: boolean;
  setGhost: (value: boolean) => void;
}

export const useGhostModeStore = create<GhostModeState>((set) => ({
  isGhost: false,
  setGhost: (isGhost) => set({ isGhost }),
}));

/** For the non-React callers -- the realtime layer and the journey controller
 * both need the answer outside a component. */
export function isGhostModeOn(): boolean {
  return useGhostModeStore.getState().isGhost;
}
