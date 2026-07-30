import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import type { RouteMode, StationId } from '../engine/types';

const STORAGE_KEY = 'metrosync.journeySession';

export interface JourneySession {
  originId: StationId;
  destinationId: StationId;
  mode: RouteMode;
  /** ms since epoch. Used to stop a journey somebody forgot to end. */
  startedAt: number;
}

interface JourneyState {
  /** Null means no journey is being tracked. There is at most one. */
  session: JourneySession | null;
  isHydrated: boolean;
  /** Set when a journey ended for a reason the user didn't choose, so the UI
   * can say so. Cleared once shown -- same contract as
   * `locationStore.broadcastNotice`. */
  endedNotice: string | null;
  hydrate: () => Promise<void>;
  setSession: (session: JourneySession | null) => void;
  setEndedNotice: (notice: string | null) => void;
}

/**
 * The journey being tracked in the background.
 *
 * Persisted, unlike `activeRouteStore` -- but only so the next launch can
 * *clear* it. The foreground service cannot outlive the process (swiping the
 * app away stops it, by design), so a session found on disk with no service
 * running is a journey that already ended, not one to resume. Reconciliation
 * lives in `journeyController.initJourneyController`.
 */
export const useJourneyStore = create<JourneyState>((set, get) => ({
  session: null,
  isHydrated: false,
  endedNotice: null,

  hydrate: async () => {
    if (get().isHydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      set({ session: raw ? parseStored(raw) : null, isHydrated: true });
    } catch {
      // An unreadable store just means we don't know about a previous
      // journey, which is the same as there not having been one.
      set({ session: null, isHydrated: true });
    }
  },

  setSession: (session) => {
    set({ session });
    persist(session);
  },

  setEndedNotice: (endedNotice) => set({ endedNotice }),
}));

/** True while a journey is being tracked. */
export function useIsJourneyActive(): boolean {
  return useJourneyStore((state) => state.session !== null);
}

function persist(session: JourneySession | null) {
  const write = session
    ? AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    : AsyncStorage.removeItem(STORAGE_KEY);
  write.catch(() => {
    // Best-effort. The in-memory session is what this process acts on; the
    // stored copy only matters to a launch that hasn't happened yet.
  });
}

function parseStored(raw: string): JourneySession | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const session = parsed as Record<string, unknown>;
    if (
      typeof session.originId !== 'string' ||
      typeof session.destinationId !== 'string' ||
      typeof session.startedAt !== 'number' ||
      (session.mode !== 'fastest' && session.mode !== 'min-interchange')
    ) {
      return null;
    }
    return {
      originId: session.originId,
      destinationId: session.destinationId,
      mode: session.mode,
      startedAt: session.startedAt,
    };
  } catch {
    return null;
  }
}
