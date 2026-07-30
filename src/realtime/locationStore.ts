import { useEffect, useMemo, useReducer } from 'react';
import { create } from 'zustand';

export type PresenceStatus = 'offline' | 'online' | 'broadcasting';
export type ConnectionState = 'connecting' | 'connected' | 'error';

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
  /** Set when broadcasting stopped for a reason the user didn't choose, so
   * the map can tell them. Cleared once shown. */
  broadcastNotice: string | null;
  setBroadcastNotice: (notice: string | null) => void;
  friendLocations: Record<string, FriendLocation>;
  friendPresence: Record<string, PresenceStatus>;
  /** Display names by user id, mirrored from the friendships list so that
   * background code can name a friend without depending on React state having
   * loaded. Only ever used for display -- never for identity. */
  friendNames: Record<string, string>;
  setBroadcasting: (value: boolean) => void;
  setFriendNames: (names: Record<string, string>) => void;
  setConnectionState: (state: ConnectionState) => void;
  upsertFriendLocation: (loc: Omit<FriendLocation, 'receivedAt' | 'movedAt' | 'previous'>) => void;
  setFriendPresence: (userId: string, status: PresenceStatus) => void;
  removeFriend: (userId: string) => void;
}

/** Global, ephemeral, in-memory only -- nothing here is ever persisted.
 * The Map screen subscribes to just `friendLocations` via a selector so a
 * location tick only re-renders the small <FriendsLayer/> leaf component,
 * never the map canvas or the rest of the screen tree. */
export const useLocationStore = create<LocationState>((set) => ({
  isBroadcasting: false,
  connectionState: 'connecting',
  broadcastNotice: null,
  friendLocations: {},
  friendPresence: {},
  friendNames: {},

  setBroadcasting: (value) => set({ isBroadcasting: value }),

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

  setFriendPresence: (userId, status) =>
    set((state) => {
      const friendPresence = { ...state.friendPresence, [userId]: status };
      if (status === 'broadcasting') return { friendPresence };

      // A friend who stopped broadcasting shouldn't keep a stale pin on the
      // map forever -- clear their last known location the moment presence
      // leaves 'broadcasting'. (A hard TTL in FriendsLayer/useFriendStatuses
      // still covers the case where presence never flips, e.g. force-quit.)
      const friendLocations = { ...state.friendLocations };
      delete friendLocations[userId];
      return { friendPresence, friendLocations };
    }),

  removeFriend: (userId) =>
    set((state) => {
      const friendLocations = { ...state.friendLocations };
      const friendPresence = { ...state.friendPresence };
      delete friendLocations[userId];
      delete friendPresence[userId];
      return { friendLocations, friendPresence };
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

function computeFriendStatus(
  presence: PresenceStatus | undefined,
  location: FriendLocation | undefined,
  now: number,
): FriendStatus {
  // Past the hard TTL, a friend is offline regardless of what presence last
  // said -- this is what makes a force-quit/dead-battery friend eventually
  // disappear even if no presence "left" event ever arrives.
  if (location && now - location.receivedAt > OFFLINE_AFTER_MS) return 'offline';

  if (presence !== 'broadcasting') return presence === 'online' ? 'online' : 'offline';

  // Presence flips to 'broadcasting' before the first GPS fix arrives, so a
  // location can briefly be missing right after a friend turns broadcasting
  // on -- that's still live, just without a pin to show yet.
  if (!location) return 'live';

  return now - location.receivedAt <= STALE_AFTER_MS ? 'live' : 'stale';
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
