import { useMemo } from 'react';
import { create } from 'zustand';
import type { Profile } from '../auth/AuthProvider';
import { findRoute } from '../engine/graph';
import type { RouteMode, StationId } from '../engine/types';
import type { FriendshipRow } from '../friends/useFriendships';
import { useJourneyStore } from '../journey/journeyStore';
import { useLocationStore } from '../realtime/locationStore';
import type { SharedJourney } from '../realtime/sharedJourney';
import { useActiveRouteStore } from '../route/activeRouteStore';
import { buildRouteStationSequence, type RouteStation } from '../route/routeProgress';

/**
 * ============================================================================
 * TEMPORARY DEV FIXTURE -- DELETE BEFORE SHIPPING
 * ============================================================================
 *
 * A fake friend, sharing a fake journey, so the journey-sharing UI can be
 * looked at without a second phone, a second account and an accepted
 * friendship between them.
 *
 * It fabricates exactly what a real sharing friend puts into the app and
 * nothing else -- a presence status, a position, a shared journey and a
 * friendship row -- so every surface downstream (the friend card, the map pin,
 * the destination flag, the station card, the meet-up list) runs its ordinary
 * code path and has no idea this exists. Nothing here is a mock of the feature;
 * it is a mock of the *friend*.
 *
 * To remove it, delete this file, `MockFriendPanel.tsx`, and the three blocks
 * marked `MOCK FRIEND` in:
 *   - src/friends/useFriendships.ts   (appends the fake friendship row)
 *   - src/realtime/LocationProvider.tsx (keeps it off the real channel sync)
 *   - app/(tabs)/settings.tsx          (renders the panel)
 */

/** Prefixed so every integration point can recognise a fake id on sight, and
 * so it can never collide with a real Supabase uuid. */
export const MOCK_FRIEND_ID = 'mock-friend-0000-0000-000000000001';

export function isMockFriendId(id: string): boolean {
  return id === MOCK_FRIEND_ID;
}

const MOCK_PROFILE: Profile = {
  id: MOCK_FRIEND_ID,
  email: 'aditi@example.com',
  display_name: 'Aditi (mock)',
  avatar_url: null,
  public_uid: 'aa11bb22',
  created_at: new Date(0).toISOString(),
};

/** Used when the user has no route of their own to mirror. A long Blue Line
 * run, so there are plenty of stations to place the fake friend at. */
const FALLBACK_JOURNEY: { originId: StationId; destinationId: StationId; mode: RouteMode } = {
  originId: 'dwarka-mor',
  destinationId: 'ramakrishna-ashram-marg',
  mode: 'fastest',
};

interface MockFriendState {
  isActive: boolean;
  /** Index into the fake friend's own station sequence. */
  stationIndex: number;
  stationCount: number;
  stationName: string | null;
  destinationName: string | null;
  /** True when the journey was built by reversing the user's own route, which
   * is what makes the meet-up list fill up. */
  isMirroringSelfRoute: boolean;
  enable: () => void;
  disable: () => void;
  moveBy: (delta: number) => void;
}

// Module state: the sequence is not rendered directly and the movers need to
// read it without re-subscribing.
let sequence: RouteStation[] = [];
let journey: SharedJourney | null = null;
/** The last fix published, so the heartbeat can repeat it verbatim. */
let lastFix: { lat: number; lon: number; ts: number } | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;

/**
 * How often the fake friend repeats its last position.
 *
 * Not optional. A real sender resends every 15s (see HEARTBEAT_RESEND_AFTER_MS)
 * and the receiver dims a friend at 30s and drops them entirely at 90s -- so a
 * fixture that published one fix and went quiet would fade off the map while
 * being looked at, which is the one thing it exists not to do.
 *
 * Repeating the identical fix is also the honest simulation: `upsertFriendLocation`
 * recognises it as a repeat and refreshes only `receivedAt`, leaving `movedAt`
 * and `previous` alone exactly as it would for real traffic.
 */
const MOCK_HEARTBEAT_MS = 10_000;

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeat = setInterval(() => {
    if (!lastFix) return;
    useLocationStore.getState().upsertFriendLocation({ userId: MOCK_FRIEND_ID, ...lastFix });
  }, MOCK_HEARTBEAT_MS);
}

function stopHeartbeat(): void {
  if (heartbeat !== null) clearInterval(heartbeat);
  heartbeat = null;
  lastFix = null;
}

export const useMockFriendStore = create<MockFriendState>((set, get) => ({
  isActive: false,
  stationIndex: 0,
  stationCount: 0,
  stationName: null,
  destinationName: null,
  isMirroringSelfRoute: false,

  enable: () => {
    const target = pickJourney();
    const route = findRoute(target.originId, target.destinationId, target.mode);
    if (!route) return;

    sequence = buildRouteStationSequence(route);
    if (sequence.length < 2) return;

    journey = {
      originId: target.originId,
      destinationId: target.destinationId,
      mode: target.mode,
      // A journey that started a few minutes ago, so it reads as one in
      // progress rather than one beginning this instant.
      startedAt: Date.now() - 8 * 60_000,
    };

    useLocationStore.getState().setFriendJourney(MOCK_FRIEND_ID, journey);
    useLocationStore.getState().setFriendPresence(MOCK_FRIEND_ID, 'broadcasting');

    // Roughly a third of the way in: far enough that stations behind them read
    // as passed, far enough from the end that plenty remain ahead to meet at.
    const startIndex = Math.max(1, Math.floor(sequence.length / 3));
    set({
      isActive: true,
      stationCount: sequence.length,
      destinationName: sequence[sequence.length - 1].stationName,
      isMirroringSelfRoute: target.isMirroringSelfRoute,
    });
    placeAt(startIndex);
    startHeartbeat();
  },

  disable: () => {
    stopHeartbeat();
    sequence = [];
    journey = null;
    // Presence first: setFriendPresence drops the location as a side effect
    // when the status is not 'broadcasting', exactly as it does for a real
    // friend who stops sharing.
    useLocationStore.getState().setFriendPresence(MOCK_FRIEND_ID, 'offline');
    useLocationStore.getState().removeFriend(MOCK_FRIEND_ID);
    useLocationStore.getState().setFriendJourney(MOCK_FRIEND_ID, null);
    set({
      isActive: false,
      stationIndex: 0,
      stationCount: 0,
      stationName: null,
      destinationName: null,
      isMirroringSelfRoute: false,
    });
  },

  moveBy: (delta) => {
    if (!get().isActive || sequence.length === 0) return;
    placeAt(get().stationIndex + delta);
  },
}));

/**
 * Puts the fake friend at a station and publishes it the way a real broadcast
 * would.
 *
 * Goes through `upsertFriendLocation` rather than writing the store directly,
 * so `receivedAt`, `movedAt` and `previous` are all derived by the same code
 * that handles real traffic -- `previous` in particular, without which the
 * line-inference fallback and the pin's glide animation have nothing to work
 * from.
 */
function placeAt(index: number): void {
  const clamped = Math.max(0, Math.min(sequence.length - 1, index));
  const station = sequence[clamped];

  // A distinct `ts` per move is what makes this read as real movement rather
  // than as a heartbeat repeat, which is what populates `previous`.
  lastFix = { lat: station.lat, lon: station.lon, ts: Date.now() };
  useLocationStore.getState().upsertFriendLocation({ userId: MOCK_FRIEND_ID, ...lastFix });

  useMockFriendStore.setState({ stationIndex: clamped, stationName: station.stationName });
}

/**
 * The route to put the fake friend on.
 *
 * Reversed from the user's own route whenever they have one, so the two are
 * travelling toward each other down the same corridor -- which guarantees the
 * meet-up list has something in it, and makes it the interesting case (a real
 * decision about where to converge) rather than a degenerate one.
 */
function pickJourney(): {
  originId: StationId;
  destinationId: StationId;
  mode: RouteMode;
  isMirroringSelfRoute: boolean;
} {
  const session = useJourneyStore.getState().session;
  if (session) {
    return {
      originId: session.destinationId,
      destinationId: session.originId,
      mode: session.mode,
      isMirroringSelfRoute: true,
    };
  }

  const planner = useActiveRouteStore.getState();
  if (planner.originId && planner.destinationId) {
    return {
      originId: planner.destinationId,
      destinationId: planner.originId,
      mode: planner.mode,
      isMirroringSelfRoute: true,
    };
  }

  return { ...FALLBACK_JOURNEY, isMirroringSelfRoute: false };
}

/**
 * The fake friendship row, for `useFriendships` to append to the real ones.
 *
 * The friend card, the map pin and the focus stack all gate on there being an
 * accepted friendship with a profile attached -- injecting presence and a
 * journey alone would light up the station card and nothing else.
 */
export function useMockFriendRows(selfUserId: string | undefined): FriendshipRow[] {
  const isActive = useMockFriendStore((state) => state.isActive);

  return useMemo(() => {
    if (!__DEV__ || !isActive || !selfUserId) return [];
    return [
      {
        id: `mock-friendship-${MOCK_FRIEND_ID}`,
        status: 'accepted',
        // The mock is the requester and the real user the addressee, so
        // `otherParty` resolves to the mock profile.
        requester_id: MOCK_FRIEND_ID,
        addressee_id: selfUserId,
        created_at: new Date(0).toISOString(),
        requester: MOCK_PROFILE,
        addressee: {
          id: selfUserId,
          email: 'you@example.com',
          display_name: 'You',
          avatar_url: null,
          public_uid: '00000000',
          created_at: new Date(0).toISOString(),
        },
      },
    ];
  }, [isActive, selfUserId]);
}
