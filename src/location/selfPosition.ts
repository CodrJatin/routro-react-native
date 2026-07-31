import { create } from 'zustand';

export interface SelfPosition {
  lat: number;
  lon: number;
  /** When this fix was TAKEN, on this device's clock -- used to decide whether
   * a last-known read is worth writing over what's already here, and to tell
   * a live position apart from one that has gone quiet (see
   * `SELF_POSITION_STALE_AFTER_MS`). A cached last-known read can be minutes
   * or hours older than the moment it arrived. */
  at: number;
  /** When these coordinates were first SEEN, on this device's clock. Unlike
   * `at` it is always now, which is what pin animation has to measure
   * against -- a seeded fix taken an hour ago still starts gliding from the
   * moment it lands. A repeat of coordinates already held does not move it. */
  movedAt: number;
  /** The last DISTINCT position before this one, so the pin can glide between
   * the two instead of jumping. Null on the first fix, which has nowhere
   * honest to animate from. Mirrors `FriendLocation.previous`, deliberately:
   * both pins are drawn by the same interpolation. */
  previous: { lat: number; lon: number; movedAt: number } | null;
}

/** Past this with no new fix, the position on screen is a guess about where
 * someone used to be. Matches the threshold friend pins go stale at. */
export const SELF_POSITION_STALE_AFTER_MS = 30_000;

interface SelfPositionState {
  position: SelfPosition | null;
  /** A fix from the live GPS watcher. Always wins: it's now. */
  setLive: (lat: number, lon: number) => void;
  /** A fix from the OS's last-known cache, which may be minutes or hours
   * old -- so it only fills a gap, never overwrites something fresher. */
  seed: (lat: number, lon: number, at: number) => void;
}

/** Folds a new reading into the position already held, carrying the old one
 * over as `previous` so the pin has something to glide from.
 *
 * Identical coordinates are treated as a watcher confirming the user hasn't
 * moved -- they refresh `at` and nothing else. Rebuilding the glide would
 * have a stationary user's pin replay its last move every few seconds, and
 * would erase the real previous position the animation needs. */
function advance(
  current: SelfPosition | null,
  lat: number,
  lon: number,
  at: number,
): SelfPosition {
  if (current && current.lat === lat && current.lon === lon) {
    return { ...current, at };
  }
  return {
    lat,
    lon,
    at,
    movedAt: Date.now(),
    previous: current
      ? { lat: current.lat, lon: current.lon, movedAt: current.movedAt }
      : null,
  };
}

/**
 * Where the user is, shared across screens.
 *
 * Exactly one live GPS watcher writes here at a time, and which one it is
 * depends only on what is already running: the journey controller's while a
 * journey is tracked, the broadcast watcher's while sharing is on, and the map
 * screen's when neither of those exists (see `useSelfPositionWatcher`). Every
 * one of them produces the same fixes, so the cheapest correct answer is to
 * read from whichever is already awake rather than start a second.
 *
 * That ordering is also why the pin does not depend on sharing being on: the
 * three cases cover each other, and the map only opts out of running a watcher
 * when something else is definitely running one.
 *
 * The route planner and Friends deliberately run none of their own. Without
 * somewhere shared to put the answer, those screens each read the OS's
 * last-known fix independently and could place the user at different stations
 * on the same journey at the same moment. One store, one answer.
 *
 * In-memory only. A stale position restored from disk on next launch would be
 * worse than none -- it would show progress along a journey the user isn't on.
 *
 * Deliberately free of React and of expo-location: the writers are the
 * broadcast manager and the journey controller, neither of which is a
 * component. `useSeedSelfPosition` lives in its own file for the same reason.
 */
export const useSelfPositionStore = create<SelfPositionState>((set, get) => ({
  position: null,

  setLive: (lat, lon) => set({ position: advance(get().position, lat, lon, Date.now()) }),

  seed: (lat, lon, at) => {
    const current = get().position;
    if (current && current.at >= at) return;
    set({ position: advance(current, lat, lon, at) });
  },
}));
