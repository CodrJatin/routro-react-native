import { create } from 'zustand';
import { addJourneyServiceTickListener } from '../../modules/journey-service';
import { findRoute } from '../engine/graph';
import type { RouteMode, StationId } from '../engine/types';
import { refreshJourneyNow } from '../journey/journeyController';
import { useSelfPositionStore } from '../location/selfPosition';
import { buildRouteStationSequence, type RouteStation } from '../route/routeProgress';

/**
 * A fake user, travelling a real route.
 *
 * Everything downstream of a journey -- the ongoing notification, the get-off
 * alert, the change-lines alert, progress on the itinerary, the pin on the
 * map -- is a function of one thing: what is in `useSelfPositionStore`. So the
 * whole simulator is a clock that writes plausible coordinates into that store
 * and nothing else. No downstream code knows it exists, which is the point:
 * testing a code path that only runs under simulation would test nothing.
 *
 * Position is a pure function of elapsed time rather than a step per callback.
 * That matters because two very different things drive it -- a JS interval
 * while the app is on screen, and the foreground service's native tick while it
 * is not -- and a per-callback step would advance at two different speeds, or
 * stall entirely when JS timers are frozen in the background. Deriving from the
 * clock means whichever one wakes us gets the same answer.
 *
 * Dev builds only. `JourneySimulatorPanel` is the only caller and renders
 * nothing outside `__DEV__`.
 */

/** Multipliers on real journey time. A Delhi Metro crossing is roughly an
 * hour, so 60x walks it in a minute and 10x is slow enough to watch each
 * station arrive. */
export const SIMULATION_SPEEDS = [10, 30, 60] as const;

/** How often the on-screen clock is re-read. Not the fix rate the app would
 * see in reality -- it's deliberately faster, so scrubbing and speed changes
 * feel immediate. */
const APPLY_INTERVAL_MS = 500;

interface JourneySimulatorState {
  isRunning: boolean;
  /** Running but not advancing. The fake position stays put, which is itself
   * worth testing -- it's a user standing on a platform. */
  isPaused: boolean;
  speed: number;
  /** Seconds into the journey, in journey time rather than wall time. */
  elapsedSeconds: number;
  totalSeconds: number;
  /** Index of the station the fake user is nearest, for the panel's readout. */
  nearestIndex: number;
  stationCount: number;
  start: (originId: StationId, destinationId: StationId, mode: RouteMode) => boolean;
  stop: () => void;
  setPaused: (isPaused: boolean) => void;
  setSpeed: (speed: number) => void;
  /** Jumps to just after the next station. The fastest way to a get-off or
   * change-lines alert without waiting out the ride. */
  skipToNextStation: () => void;
  restart: () => void;
}

// Module state rather than store state: none of it is rendered, and the ticker
// callbacks need to read it without re-subscribing.
let sequence: RouteStation[] = [];
let interval: ReturnType<typeof setInterval> | null = null;
let tickSubscription: { remove: () => void } | null = null;
/** Journey seconds at the moment the clock last started or was scrubbed. */
let baseSeconds = 0;
/** Wall clock at that same moment. */
let baseAtMs = 0;

export const useJourneySimulatorStore = create<JourneySimulatorState>((set, get) => ({
  isRunning: false,
  isPaused: false,
  speed: SIMULATION_SPEEDS[1],
  elapsedSeconds: 0,
  totalSeconds: 0,
  nearestIndex: 0,
  stationCount: 0,

  start: (originId, destinationId, mode) => {
    const route = findRoute(originId, destinationId, mode);
    if (!route) return false;

    sequence = buildRouteStationSequence(route);
    if (sequence.length < 2) return false;

    baseSeconds = sequence[0].offsetSeconds;
    baseAtMs = Date.now();
    set({
      isRunning: true,
      isPaused: false,
      elapsedSeconds: baseSeconds,
      totalSeconds: sequence[sequence.length - 1].offsetSeconds,
      stationCount: sequence.length,
      nearestIndex: 0,
    });

    startTicking();
    apply();
    return true;
  },

  stop: () => {
    stopTicking();
    sequence = [];
    useSelfPositionStore.getState().endSimulation();
    set({ isRunning: false, isPaused: false, elapsedSeconds: 0, nearestIndex: 0 });
  },

  setPaused: (isPaused) => {
    if (!get().isRunning) return;
    // Freeze the clock where it stands rather than remembering when it was
    // paused: resuming then needs no arithmetic about how long it sat there.
    baseSeconds = get().elapsedSeconds;
    baseAtMs = Date.now();
    set({ isPaused });
  },

  setSpeed: (speed) => {
    // Re-anchor first, or the new multiplier is applied retroactively to time
    // already travelled and the fake user teleports.
    baseSeconds = get().elapsedSeconds;
    baseAtMs = Date.now();
    set({ speed });
  },

  skipToNextStation: () => {
    if (!get().isRunning) return;
    const next = sequence.find((station) => station.offsetSeconds > get().elapsedSeconds + 1);
    baseSeconds = next ? next.offsetSeconds : get().totalSeconds;
    baseAtMs = Date.now();
    set({ elapsedSeconds: baseSeconds });
    apply();
  },

  restart: () => {
    if (!get().isRunning) return;
    baseSeconds = sequence[0]?.offsetSeconds ?? 0;
    baseAtMs = Date.now();
    set({ elapsedSeconds: baseSeconds, isPaused: false });
    apply();
  },
}));

function startTicking() {
  stopTicking();
  interval = setInterval(apply, APPLY_INTERVAL_MS);
  // The service's tick comes off a native Looper, so it keeps arriving with
  // the app backgrounded and the screen off -- which is exactly the state
  // worth testing the notification in, and exactly when the interval above is
  // frozen. A no-op when no journey is running.
  tickSubscription = addJourneyServiceTickListener(() => apply());
}

function stopTicking() {
  if (interval !== null) clearInterval(interval);
  interval = null;
  tickSubscription?.remove();
  tickSubscription = null;
}

/** Reads the clock, works out where that puts the fake user, and writes it. */
function apply() {
  const state = useJourneySimulatorStore.getState();
  if (!state.isRunning || sequence.length < 2) return;

  const elapsed = state.isPaused
    ? state.elapsedSeconds
    : Math.min(state.totalSeconds, baseSeconds + ((Date.now() - baseAtMs) / 1000) * state.speed);

  const { lat, lon, nearestIndex } = positionAt(elapsed);
  useSelfPositionStore.getState().setSimulated(lat, lon);

  if (elapsed !== state.elapsedSeconds || nearestIndex !== state.nearestIndex) {
    useJourneySimulatorStore.setState({ elapsedSeconds: elapsed, nearestIndex });
  }

  // Only when the station under the fake user changes: a repaint twice a
  // second would hammer the notification for no visible gain, and alerts only
  // ever fire on a station boundary anyway. A no-op with no journey running.
  if (nearestIndex !== state.nearestIndex) {
    void refreshJourneyNow();
  }
}

/**
 * Where the journey is at `seconds`, interpolated between the two stations
 * either side of it.
 *
 * A straight line between stations rather than the track's real geometry: the
 * app only ever asks which station is nearest, and a great-circle chord between
 * two adjacent metro stations never strays far enough to change that answer.
 */
function positionAt(seconds: number): { lat: number; lon: number; nearestIndex: number } {
  const first = sequence[0];
  const last = sequence[sequence.length - 1];
  if (seconds <= first.offsetSeconds) return { lat: first.lat, lon: first.lon, nearestIndex: 0 };
  if (seconds >= last.offsetSeconds) {
    return { lat: last.lat, lon: last.lon, nearestIndex: last.index };
  }

  for (let i = 0; i < sequence.length - 1; i++) {
    const from = sequence[i];
    const to = sequence[i + 1];
    if (seconds > to.offsetSeconds) continue;

    const span = to.offsetSeconds - from.offsetSeconds;
    const t = span <= 0 ? 1 : (seconds - from.offsetSeconds) / span;
    return {
      lat: from.lat + (to.lat - from.lat) * t,
      lon: from.lon + (to.lon - from.lon) * t,
      // Past halfway the next station is the nearer one, which is also where
      // the app's own progress flips -- so the panel agrees with the map.
      nearestIndex: t < 0.5 ? from.index : to.index,
    };
  }

  return { lat: last.lat, lon: last.lon, nearestIndex: last.index };
}

/** The station the fake user is at or approaching, for the panel's readout. */
export function simulatedStationName(index: number): string | null {
  return sequence[index]?.stationName ?? null;
}
