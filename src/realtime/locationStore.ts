import { useEffect, useMemo, useReducer } from 'react';
import { create } from 'zustand';
import type { SharedJourney } from './sharedJourney';

export type PresenceStatus = 'offline' | 'online' | 'broadcasting';
/**
 * `connecting` is the first join. `reconnecting` is a live connection that
 * dropped and is being retried -- a separate state because the two mean very
 * different things to someone looking at the map: one is "not there yet", the
 * other is "you had this and we are getting it back".
 *
 * There is deliberately no terminal error state. Retrying does not stop while
 * the user is signed in (see `rejoinBackoff.ts`), so
 * a state meaning "gave up" would never be reachable, and having one invited
 * the UI to imply an outage was permanent when it was simply ongoing.
 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting';

/**
 * A one-off message about location, carrying its own title.
 *
 * The title used to be hardcoded at the call site as "Sharing stopped", which
 * was true of the only thing that raised one. It is not true of all of them --
 * an approximate-location grant is a warning about a session that is still
 * running -- and telling someone sharing had stopped when it hadn't would be
 * worse than saying nothing.
 */
export interface LocationNotice {
  title: string;
  message: string;
}

/** The one derived "is this friend live?" model. Previously FriendsLayer,
 * FriendFocusStack and friends.tsx each answered this question their own
 * way (two duplicated staleness constants plus a third, presence-only
 * model), which is what let the map and the Friends tab disagree about the
 * same person. Everything now reads this instead. */
export type FriendStatus = 'live' | 'stale' | 'online' | 'offline';

export interface FriendLocation {
  userId: string;
  lat: number;
  lon: number;
  /** ms since epoch, from the SENDER's device clock -- ordering/dedup only.
   * Never diff this against a local Date.now(); device clock drift makes a
   * friend permanently fresh or permanently stale. */
  ts: number;
  /** ms since epoch, from THIS device's clock at the moment the message
   * arrived -- the only value safe to compare against Date.now(). Refreshed
   * by a heartbeat repeat as well as by real movement: it answers "is this
   * friend still live?", which a repeat does prove. */
  receivedAt: number;
  /** ms since epoch, this device's clock, for when this position was first
   * seen. Unlike `receivedAt` a heartbeat repeat does NOT move it, so it is
   * what pin animation must measure against -- otherwise every repeat resets
   * the glide and the pin snaps back to replay its last move. */
  movedAt: number;
  /** The last DISTINCT fix before this one, when there is one. Retained so
   * consumers can derive direction of travel (which metro line a friend is
   * actually on) and interpolate pin movement between broadcasts, neither
   * of which is possible from a single point. Survives heartbeat repeats:
   * overwriting it with an identical point would erase the very movement
   * the line badge is read from. */
  previous: { lat: number; lon: number; movedAt: number } | null;
}

interface LocationState {
  isBroadcasting: boolean;
  connectionState: ConnectionState;
  /**
   * Whether the device believes it has a working internet connection.
   *
   * Kept beside `connectionState` rather than folded into it as a fourth
   * value, because the two answer different questions and both are worth
   * having at once: one is about this device's radio, the other about the
   * channel on top of it. Collapsing them would also mean a network event
   * writing into a state machine that is otherwise driven entirely by channel
   * callbacks, and those callbacks would immediately overwrite it.
   *
   * Defaults to true. An unknown network is treated as present, so nothing is
   * suppressed on a platform or a moment that cannot answer.
   */
  isOnline: boolean;
  /** Something about location the user needs telling, so the map can say it.
   * Cleared once shown. */
  broadcastNotice: LocationNotice | null;
  setBroadcastNotice: (notice: LocationNotice | null) => void;
  friendLocations: Record<string, FriendLocation>;
  friendPresence: Record<string, PresenceStatus>;
  /**
   * The journey each friend is currently travelling, when they're sharing one.
   *
   * Carried on presence rather than in the location broadcast: origin,
   * destination and mode change once per journey, while a position ticks every
   * 5s. Presence syncs on join and only re-syncs when the sender calls
   * `track()` again, which is exactly the cadence this needs -- and it means a
   * friend's journey is already known the moment we subscribe, without waiting
   * for them to move.
   *
   * Set from every presence sync, including to null when a friend's payload
   * carries no journey. That makes it live and die with presence itself, so
   * unlike `friendLocations` there is no separate staleness rule to get wrong.
   */
  friendJourneys: Record<string, SharedJourney>;
  /** Display names by user id, mirrored from the friendships list so that
   * background code can name a friend without depending on React state having
   * loaded. Only ever used for display -- never for identity. */
  friendNames: Record<string, string>;
  setBroadcasting: (value: boolean) => void;
  setOnline: (isOnline: boolean) => void;
  setFriendNames: (names: Record<string, string>) => void;
  setConnectionState: (state: ConnectionState) => void;
  upsertFriendLocation: (loc: Omit<FriendLocation, 'receivedAt' | 'movedAt' | 'previous'>) => void;
  setFriendPresence: (userId: string, status: PresenceStatus) => void;
  /** Null clears it -- see `friendJourneys`. */
  setFriendJourney: (userId: string, journey: SharedJourney | null) => void;
  removeFriend: (userId: string) => void;
}

/** Global, ephemeral, in-memory only -- nothing here is ever persisted.
 * The Map screen subscribes to just `friendLocations` via a selector so a
 * location tick only re-renders the small <FriendsLayer/> leaf component,
 * never the map canvas or the rest of the screen tree. */
export const useLocationStore = create<LocationState>((set) => ({
  isBroadcasting: false,
  connectionState: 'connecting',
  isOnline: true,
  broadcastNotice: null,
  friendLocations: {},
  friendPresence: {},
  friendJourneys: {},
  friendNames: {},

  setBroadcasting: (value) => set({ isBroadcasting: value }),

  setOnline: (isOnline) => set({ isOnline }),

  setFriendNames: (friendNames) => set({ friendNames }),

  setConnectionState: (state) => set({ connectionState: state }),

  setBroadcastNotice: (notice) => set({ broadcastNotice: notice }),

  upsertFriendLocation: (loc) =>
    set((state) => {
      const existing = state.friendLocations[loc.userId];
      const now = Date.now();

      // A heartbeat repeat of a fix we already hold (see
      // HEARTBEAT_RESEND_AFTER_MS in locationChannel.ts). It proves the
      // friend is still live, which is the whole point of it -- but it is
      // not new movement, so it refreshes `receivedAt` and nothing else.
      // This is what `ts` is carried for: the sender leaves it at the
      // original reading's time, which makes a repeat identifiable.
      const isRepeat =
        existing !== undefined &&
        existing.ts === loc.ts &&
        existing.lat === loc.lat &&
        existing.lon === loc.lon;

      return {
        friendLocations: {
          ...state.friendLocations,
          // Stamped with the RECEIVER's clock, here and only here -- this is
          // what staleness/"updated Xs ago" must be measured against.
          [loc.userId]: isRepeat
            ? { ...existing, receivedAt: now }
            : {
                ...loc,
                receivedAt: now,
                movedAt: now,
                previous: existing
                  ? { lat: existing.lat, lon: existing.lon, movedAt: existing.movedAt }
                  : null,
              },
        },
      };
    }),

  /**
   * Deliberately touches presence and nothing else.
   *
   * This used to delete the friend's last known location whenever presence
   * left 'broadcasting', to stop a stale pin lingering forever. That was the
   * right goal reached through the wrong signal. Presence is the weaker and
   * flakier of the two channels: it re-syncs on every join and leave, it is the
   * first thing lost when a socket blips, and a friend crossing a tunnel
   * generates exactly that. So a friend who was still actively transmitting
   * had their pin erased by a presence event that had already been overtaken
   * by the positions arriving behind it -- and erased is not recoverable, since
   * the next fix arrives with no `previous` to derive their line or glide from.
   *
   * The lingering pin was never presence's problem to solve anyway:
   * `computeFriendStatus` ages a location out at `OFFLINE_AFTER_MS` on the
   * receiver's own clock, and `FriendsLayer` drops any pin whose status reads
   * 'offline'. That path handles a force-quit, a dead battery and a friend who
   * simply stopped -- none of which send a presence event either.
   */
  setFriendPresence: (userId, status) =>
    set((state) => ({ friendPresence: { ...state.friendPresence, [userId]: status } })),

  setFriendJourney: (userId, journey) =>
    set((state) => {
      const existing = state.friendJourneys[userId];

      // Presence syncs on every join, leave and re-track on the channel, and
      // the journey in it is unchanged across almost all of them. Returning a
      // fresh `friendJourneys` object each time would invalidate every
      // selector reading it -- and the routes derived from it are memoised on
      // that identity, so this guard is what keeps a friend's route from being
      // recomputed on unrelated presence traffic.
      const isSame =
        existing === undefined
          ? journey === null
          : journey !== null &&
            existing.originId === journey.originId &&
            existing.destinationId === journey.destinationId &&
            existing.mode === journey.mode &&
            existing.startedAt === journey.startedAt;
      if (isSame) return state;

      const friendJourneys = { ...state.friendJourneys };
      if (journey) friendJourneys[userId] = journey;
      else delete friendJourneys[userId];
      return { friendJourneys };
    }),

  removeFriend: (userId) =>
    set((state) => {
      const friendLocations = { ...state.friendLocations };
      const friendPresence = { ...state.friendPresence };
      const friendJourneys = { ...state.friendJourneys };
      delete friendLocations[userId];
      delete friendPresence[userId];
      delete friendJourneys[userId];
      return { friendLocations, friendPresence, friendJourneys };
    }),
}));

/** Dimmed "signal lost" window: a broadcasting friend's location older than
 * this is still shown, just faded. */
const STALE_AFTER_MS = 30_000;
/** Hard TTL: past this, a location is dropped outright rather than only
 * dimmed -- covers a friend who goes offline without ever sending a
 * presence event (force-quit, dead battery, killed process). */
const OFFLINE_AFTER_MS = 90_000;
/** How often the one shared clock powering every consumer of friend status
 * ticks. Single interval for the whole app, not one per component. */
const STATUS_TICK_INTERVAL_MS = 10_000;

/**
 * The two signals, weighted by how much each is actually worth.
 *
 * A position that landed on this device seconds ago is direct proof the friend
 * is transmitting right now. Presence is a claim made once and then left to
 * rot until something re-syncs it. So when they disagree, the position wins --
 * which is the opposite of what this did before, where presence was a gate the
 * location had to get past. One dropped presence sync (or a sender who hit the
 * broadcast-teardown bug) marked a friend who was visibly still moving as
 * 'online', or 'offline', with their pin removed.
 *
 * Every freshness test here is against `receivedAt`, this device's own clock at
 * the moment the message arrived -- never the sender's `ts`, which is a
 * different device's idea of the time and would make a friend with a skewed
 * clock permanently live or permanently stale.
 */
function computeFriendStatus(
  presence: PresenceStatus | undefined,
  location: FriendLocation | undefined,
  now: number,
): FriendStatus {
  const age = location ? now - location.receivedAt : Infinity;

  // Fresh traffic is self-evident: they are sending, therefore they are live,
  // whatever presence last got round to saying.
  if (age <= STALE_AFTER_MS) return 'live';

  if (presence === 'broadcasting') {
    // Sharing, but nothing has arrived lately -- a tunnel, typically. Worth
    // drawing dimmed up to the TTL, because a last known position from under a
    // minute ago is the most useful thing to show someone looking for a
    // friend. Past it, presence is no longer believable either: a force-quit
    // or a dead battery leaves this claim standing with nothing behind it.
    return age <= OFFLINE_AFTER_MS ? 'stale' : 'offline';
  }

  // Presence says they are not sharing, and no recent position contradicts it.
  // Believed immediately rather than aged out, so a friend who deliberately
  // switches sharing off disappears when they meant to -- the one case where
  // presence is both current and the only thing that knows.
  return presence === 'online' ? 'online' : 'offline';
}

// --- single shared clock tick, module-scoped so every useFriendStatuses()
// caller shares one interval instead of running its own. Reference-counted
// so it only runs while at least one component is actually mounted.
let tickHandle: ReturnType<typeof setInterval> | null = null;
let tickSubscribers = 0;
const tickListeners = new Set<() => void>();

function subscribeToTick(listener: () => void): () => void {
  tickListeners.add(listener);
  tickSubscribers += 1;
  if (!tickHandle) {
    tickHandle = setInterval(() => {
      tickListeners.forEach((fn) => fn());
    }, STATUS_TICK_INTERVAL_MS);
  }
  return () => {
    tickListeners.delete(listener);
    tickSubscribers -= 1;
    if (tickSubscribers <= 0 && tickHandle) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
  };
}

/** The one place "is this friend live?" gets decided. Combines presence
 * with receivedAt-based freshness (see `computeFriendStatus`), backed by a
 * single shared clock tick rather than a per-component `setInterval`.
 * FriendsLayer, FriendFocusStack and friends.tsx all consume this instead
 * of deriving their own notion of staleness. */
export function useFriendStatuses(): Record<string, FriendStatus> {
  const friendLocations = useLocationStore((state) => state.friendLocations);
  const friendPresence = useLocationStore((state) => state.friendPresence);
  const [tick, forceTick] = useReducer((c: number) => c + 1, 0);

  useEffect(() => subscribeToTick(forceTick), []);

  return useMemo(() => {
    const now = Date.now();
    const ids = new Set([...Object.keys(friendLocations), ...Object.keys(friendPresence)]);
    const result: Record<string, FriendStatus> = {};
    for (const id of ids) {
      result[id] = computeFriendStatus(friendPresence[id], friendLocations[id], now);
    }
    return result;
    // `tick` must be a dependency, not just a re-render trigger: a bare
    // re-render does not invalidate a useMemo, so without it a friend who
    // simply stops sending would never transition live -> stale -> offline
    // (nothing else in the store changes to recompute against).
  }, [friendLocations, friendPresence, tick]);
}
