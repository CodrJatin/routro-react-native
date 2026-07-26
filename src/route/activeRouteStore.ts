import { create } from 'zustand';
import type { RouteMode, StationId } from '../engine/types';

interface ActiveRouteState {
  originId: StationId | null;
  destinationId: StationId | null;
  mode: RouteMode;
  /** Bumped whenever the map should frame the camera on the route again. */
  fitToken: number;
  /** No-ops when the journey is already the active one, so the planner can
   * call it from an effect without churning subscribers. */
  setActiveRoute: (originId: StationId, destinationId: StationId, mode: RouteMode) => void;
  clear: () => void;
  /** Asks the map to re-frame a route it may already be showing -- what "Go
   * to map" does now that the route itself arrives without it. */
  requestFit: () => void;
}

/** The journey the map is drawing, held outside the planner screen.
 *
 * This used to travel as navigation params, which meant the route only
 * reached the map when the user pressed "Go to map" -- until then the map had
 * no idea a journey existed, so the highlighted polyline, the dimmed
 * background tracks and the per-station arrival times in the detail card were
 * all missing. Planner state lives here instead, so picking or changing a
 * route updates the map immediately whether or not it's on screen.
 *
 * Deliberately not persisted: a journey is for the session you planned it in. */
export const useActiveRouteStore = create<ActiveRouteState>((set, get) => ({
  originId: null,
  destinationId: null,
  mode: 'fastest',
  fitToken: 0,

  setActiveRoute: (originId, destinationId, mode) => {
    const state = get();
    if (state.originId === originId && state.destinationId === destinationId && state.mode === mode) {
      return;
    }
    set({ originId, destinationId, mode, fitToken: state.fitToken + 1 });
  },

  clear: () => {
    if (get().originId === null && get().destinationId === null) return;
    set({ originId: null, destinationId: null });
  },

  requestFit: () => set((state) => ({ fitToken: state.fitToken + 1 })),
}));
