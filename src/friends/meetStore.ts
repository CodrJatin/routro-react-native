import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import type { StationId } from '../engine/types';
import { getStation } from '../engine/graph';
import type { SharedJourney } from '../realtime/sharedJourney';
import { MEET_REQUEST_COOLDOWN_MS } from '../realtime/meetMessage';

const STORAGE_KEY = 'metrosync.meets';

/** How long a settled outgoing request stays on screen before it is cleared.
 * "They said no" / "No answer" is the only feedback the asker gets, and
 * removing it the instant it lands would mean they never see it. */
const SETTLED_LINGER_MS = 8000;

/**
 * How long an agreed meet survives.
 *
 * Long enough to cover any plausible Delhi Metro trip plus a wait, short
 * enough that a meet nobody cancelled isn't still decorating the itinerary
 * tomorrow morning. A meet is also cleared the moment its station is reached
 * (see `useMeetMarkers`), which is how it normally ends.
 */
const MEET_MAX_AGE_MS = 3 * 60 * 60 * 1000;

export interface IncomingMeetRequest {
  id: string;
  fromUserId: string;
  stationId: StationId;
  /** This device's clock when it landed -- what the countdown and the quoted
   * ETA are both measured from. */
  receivedAt: number;
  expiresAt: number;
  /** Seconds-to-station the sender quoted, relative to `receivedAt`. */
  etaSeconds: number | null;
  /** What the sender is travelling, when they told us. Lets the card name
   * where they are headed even if they aren't sharing their location. */
  journey: SharedJourney | null;
  position: { lat: number; lon: number } | null;
}

export type OutgoingOutcome =
  | 'pending'
  | 'accepted'
  | 'declined'
  /** They never answered in time. */
  | 'expired'
  /** It never reached them -- channel down, or they aren't reachable. */
  | 'undelivered';

export interface OutgoingMeetRequest {
  id: string;
  toUserId: string;
  stationId: StationId;
  sentAt: number;
  expiresAt: number;
  outcome: OutgoingOutcome;
  /** When it stopped being pending, for the linger above. */
  settledAt: number | null;
}

export interface AcceptedMeet {
  friendUserId: string;
  /** The request this meet came out of. Kept so either side calling it off
   * later can name the same thing the other side is holding. */
  requestId: string;
  stationId: StationId;
  /** This device's clock at the moment both sides agreed. */
  agreedAt: number;
  /** Their seconds-to-station as of `agreedAt`. Kept so a friend who isn't
   * sharing their location can still be timed; a friend who is gets recomputed
   * from their live journey instead. */
  theirEtaSeconds: number | null;
}

interface MeetState {
  /** Requests waiting on an answer from this user, by request id. More than
   * one is normal -- two friends can ask at once. */
  incoming: Record<string, IncomingMeetRequest>;
  /** Requests this user has sent, at most one per friend. */
  outgoing: Record<string, OutgoingMeetRequest>;
  /** Meets both sides agreed to, at most one per friend. */
  meets: Record<string, AcceptedMeet>;
  /** When this user last asked each friend, for the once-a-minute rule.
   * Deliberately outlives the request itself -- the cooldown has to keep
   * running after a request expires or is declined, which is exactly when
   * someone is tempted to ask again. */
  lastRequestAt: Record<string, number>;
  isHydrated: boolean;

  hydrate: () => Promise<void>;
  addIncoming: (request: IncomingMeetRequest) => void;
  dropIncoming: (id: string) => void;
  setOutgoing: (request: OutgoingMeetRequest) => void;
  settleOutgoing: (friendUserId: string, id: string, outcome: OutgoingOutcome) => void;
  dropOutgoing: (friendUserId: string) => void;
  markRequestSent: (friendUserId: string, at: number) => void;
  setMeet: (meet: AcceptedMeet) => void;
  clearMeet: (friendUserId: string) => void;
  /** Everything about one person: they were unfriended, or went away. */
  forgetFriend: (userId: string) => void;
  /** Sign-out. Nothing here belongs to the next session. */
  reset: () => void;
}

export const useMeetStore = create<MeetState>((set, get) => ({
  incoming: {},
  outgoing: {},
  meets: {},
  lastRequestAt: {},
  isHydrated: false,

  hydrate: async () => {
    if (get().isHydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      set({ meets: parseStoredMeets(raw), isHydrated: true });
    } catch {
      // An unreadable store just means we don't know about an earlier meet,
      // which is the same as there not having been one.
      set({ isHydrated: true });
    }
    sweepMeetState();
  },

  addIncoming: (request) => {
    set((state) => {
      // One pending request per friend: asking again replaces the previous
      // card rather than stacking two from the same person.
      const incoming = Object.fromEntries(
        Object.entries(state.incoming).filter(([, held]) => held.fromUserId !== request.fromUserId),
      );
      incoming[request.id] = request;
      return { incoming };
    });
    ensureTicker();
  },

  dropIncoming: (id) =>
    set((state) => {
      if (!state.incoming[id]) return state;
      const incoming = { ...state.incoming };
      delete incoming[id];
      return { incoming };
    }),

  setOutgoing: (request) => {
    set((state) => ({ outgoing: { ...state.outgoing, [request.toUserId]: request } }));
    ensureTicker();
  },

  settleOutgoing: (friendUserId, id, outcome) =>
    set((state) => {
      const existing = state.outgoing[friendUserId];
      // Guarded on the id so a late reply to a request that has already been
      // replaced can't overwrite the newer one's state.
      if (!existing || existing.id !== id) return state;
      // Settled requests are final, with one exception: an acceptance that
      // lost a race with our own countdown (see ACCEPT_GRACE_MS) still has to
      // land, or the card would go on saying "no answer" next to a meet that
      // is actually on.
      if (existing.outcome !== 'pending' && !(existing.outcome === 'expired' && outcome === 'accepted')) {
        return state;
      }
      return {
        outgoing: {
          ...state.outgoing,
          [friendUserId]: { ...existing, outcome, settledAt: Date.now() },
        },
      };
    }),

  dropOutgoing: (friendUserId) =>
    set((state) => {
      if (!state.outgoing[friendUserId]) return state;
      const outgoing = { ...state.outgoing };
      delete outgoing[friendUserId];
      return { outgoing };
    }),

  markRequestSent: (friendUserId, at) =>
    set((state) => ({ lastRequestAt: { ...state.lastRequestAt, [friendUserId]: at } })),

  setMeet: (meet) => {
    set((state) => ({ meets: { ...state.meets, [meet.friendUserId]: meet } }));
    persistMeets();
  },

  clearMeet: (friendUserId) => {
    set((state) => {
      if (!state.meets[friendUserId]) return state;
      const meets = { ...state.meets };
      delete meets[friendUserId];
      return { meets };
    });
    persistMeets();
  },

  forgetFriend: (userId) => {
    set((state) => {
      const incoming = Object.fromEntries(
        Object.entries(state.incoming).filter(([, held]) => held.fromUserId !== userId),
      );
      const outgoing = { ...state.outgoing };
      delete outgoing[userId];
      const meets = { ...state.meets };
      delete meets[userId];
      const lastRequestAt = { ...state.lastRequestAt };
      delete lastRequestAt[userId];
      return { incoming, outgoing, meets, lastRequestAt };
    });
    persistMeets();
  },

  reset: () => {
    set({ incoming: {}, outgoing: {}, meets: {}, lastRequestAt: {} });
    persistMeets();
  },
}));

/** How long before this user may ask this friend again, in ms. Zero when they
 * can ask now. */
export function meetCooldownRemainingMs(friendUserId: string, now = Date.now()): number {
  const last = useMeetStore.getState().lastRequestAt[friendUserId];
  if (last === undefined) return 0;
  return Math.max(0, MEET_REQUEST_COOLDOWN_MS - (now - last));
}

/**
 * Drops what has run out: expired requests, settled ones that have been on
 * screen long enough, and meets old enough to be forgotten.
 *
 * Only writes when something actually changed. That is what lets the one-second
 * ticker below run without re-rendering every screen that reads this store
 * sixty times a minute.
 */
export function sweepMeetState(now = Date.now()): void {
  const state = useMeetStore.getState();
  let changed = false;

  const incoming: Record<string, IncomingMeetRequest> = {};
  for (const [id, request] of Object.entries(state.incoming)) {
    if (now >= request.expiresAt) {
      changed = true;
      continue;
    }
    incoming[id] = request;
  }

  const outgoing: Record<string, OutgoingMeetRequest> = {};
  for (const [friendId, request] of Object.entries(state.outgoing)) {
    if (request.outcome === 'pending') {
      if (now >= request.expiresAt) {
        changed = true;
        outgoing[friendId] = { ...request, outcome: 'expired', settledAt: now };
      } else {
        outgoing[friendId] = request;
      }
      continue;
    }
    if (request.settledAt !== null && now - request.settledAt >= SETTLED_LINGER_MS) {
      changed = true;
      continue;
    }
    outgoing[friendId] = request;
  }

  const meets: Record<string, AcceptedMeet> = {};
  let meetsChanged = false;
  for (const [friendId, meet] of Object.entries(state.meets)) {
    if (now - meet.agreedAt > MEET_MAX_AGE_MS) {
      meetsChanged = true;
      continue;
    }
    meets[friendId] = meet;
  }

  // Only the slices that actually changed. Handing back a fresh `meets` object
  // on every request expiry would invalidate every selector reading it -- and
  // the itinerary markers are memoised on that identity, so an unrelated
  // countdown ending would recompute every meet on the route.
  if (changed) useMeetStore.setState({ incoming, outgoing });
  if (meetsChanged) {
    useMeetStore.setState({ meets });
    persistMeets();
  }

  stopTickerIfIdle();
}

// --- the sweep ticker ------------------------------------------------------
//
// Requests expire on a wall clock, and nothing else in the app is guaranteed
// to tick while one is on screen. Reference-free and self-stopping: it runs
// only while something can actually expire, so an app with no pending request
// (the overwhelmingly normal case) has no timer running at all.

let ticker: ReturnType<typeof setInterval> | null = null;

function ensureTicker(): void {
  if (ticker !== null) return;
  ticker = setInterval(() => sweepMeetState(), 1000);
}

function stopTickerIfIdle(): void {
  if (ticker === null) return;
  const state = useMeetStore.getState();
  if (Object.keys(state.incoming).length > 0 || Object.keys(state.outgoing).length > 0) return;
  clearInterval(ticker);
  ticker = null;
}

function persistMeets(): void {
  const { meets } = useMeetStore.getState();
  const write =
    Object.keys(meets).length > 0
      ? AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(Object.values(meets)))
      : AsyncStorage.removeItem(STORAGE_KEY);
  write.catch(() => {
    // Best-effort. The in-memory copy is what this session acts on; the stored
    // one only matters to a launch that hasn't happened yet.
  });
}

/** Field by field, so a blob written by an older or newer build can't put a
 * station this graph has never heard of onto the itinerary. */
function parseStoredMeets(raw: string | null): Record<string, AcceptedMeet> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return {};
    const now = Date.now();
    const meets: Record<string, AcceptedMeet> = {};
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { friendUserId, requestId, stationId, agreedAt, theirEtaSeconds } = entry as Record<
        string,
        unknown
      >;
      if (typeof friendUserId !== 'string' || typeof stationId !== 'string') continue;
      if (typeof requestId !== 'string') continue;
      if (typeof agreedAt !== 'number' || !Number.isFinite(agreedAt)) continue;
      if (now - agreedAt > MEET_MAX_AGE_MS) continue;
      if (!getStation(stationId)) continue;
      meets[friendUserId] = {
        friendUserId,
        requestId,
        stationId,
        agreedAt,
        theirEtaSeconds:
          typeof theirEtaSeconds === 'number' && Number.isFinite(theirEtaSeconds)
            ? theirEtaSeconds
            : null,
      };
    }
    return meets;
  } catch {
    return {};
  }
}
