import { useEffect, useRef, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
// MOCK FRIEND -- temporary dev fixture, delete with src/dev/mockFriend.ts
import { isMockFriendId } from '../dev/mockFriend';
import {
  clearMeetState,
  forgetMeetsWith,
  initMeetController,
  teardownMeetController,
} from '../friends/meetController';
import { otherParty } from '../friends/useFriendships';
import { useFriendshipsContext } from '../friends/FriendshipsProvider';
import { useGhostModeStore } from '../sharing/ghostModeStore';
import { hasSpentLocationPrompt, markLocationPromptSpent } from '../sharing/locationPromptMemory';
import { locationChannelManager } from './locationChannel';
import { meetChannelManager } from './meetChannel';
import { useLocationStore } from './locationStore';
import { useNetworkWatcher } from './useNetworkWatcher';

/** Mounted once inside the authenticated (tabs) layout. Joins the user's own
 * presence/location channel, keeps friend-channel subscriptions in sync with
 * the accepted-friends list, and pauses broadcasting when the app is
 * backgrounded.
 *
 * That pause is now conditional: while a journey is being tracked, a
 * foreground service holds the process open and broadcasting deliberately
 * continues -- friends watching you cross the city are the point of it. With
 * no journey running the original behaviour is unchanged, so the app still
 * shares nothing from the background without a visible notification saying so.
 * `locationChannelManager` decides which of the two applies; see
 * `setBackgroundAllowed`.
 *
 * Note this still never needs ACCESS_BACKGROUND_LOCATION: a location-typed
 * foreground service grants while-in-use access to the whole process, which is
 * what keeps this app off the background-location permission review path. */
export function LocationProvider({ children }: { children: ReactNode }) {
  const { isConfigured, session } = useAuth();
  const userId = session?.user.id;
  const { rows } = useFriendshipsContext();
  const isGhost = useGhostModeStore((state) => state.isGhost);
  const connectionState = useLocationStore((state) => state.connectionState);

  // Mirrors the device's network state into the store, and pulls the next
  // reconnect forward the moment the radio comes back. See `useNetworkWatcher`.
  useNetworkWatcher();

  const acceptedFriendIds = userId
    ? rows
        .filter((r) => r.status === 'accepted')
        .map((r) => otherParty(r, userId).id)
        // MOCK FRIEND -- temporary dev fixture. The fake friend has no real
        // channel, and subscribing to one would fail RLS and then report them
        // offline, wiping the very presence and journey the fixture injected.
        // Delete this filter with src/dev/mockFriend.ts.
        .filter((id) => !isMockFriendId(id))
    : [];
  // Sorted/joined only to give the effect below a stable dependency -- the
  // effect itself uses `acceptedFriendIds` straight from this render's
  // closure, not a re-parsed copy of the key. Sorting in place is safe:
  // `acceptedFriendIds` is a fresh array from filter/map every render and
  // nothing else depends on its original order.
  const acceptedFriendIdsKey = acceptedFriendIds.sort().join(',');

  useEffect(() => {
    locationChannelManager.setHandlers({
      onBroadcastingChange: (enabled) => useLocationStore.getState().setBroadcasting(enabled),
      onFriendLocation: (loc) => useLocationStore.getState().upsertFriendLocation(loc),
      onFriendPresence: (id, status) => useLocationStore.getState().setFriendPresence(id, status),
      onFriendJourney: (id, journey) => useLocationStore.getState().setFriendJourney(id, journey),
      onFriendRemoved: (id) => useLocationStore.getState().removeFriend(id),
      onConnectionChange: (state) => useLocationStore.getState().setConnectionState(state),
      onBroadcastInterrupted: (reason) =>
        useLocationStore.getState().setBroadcastNotice({ title: 'Sharing stopped', message: reason }),
      onLocationNotice: (notice) => useLocationStore.getState().setBroadcastNotice(notice),
    });
  }, []);

  // Meet requests ride their own per-pair channels rather than the location
  // ones -- see src/realtime/meetChannel.ts for why. Wired here because this is
  // where the accepted-friends list and the signed-in user already meet.
  useEffect(() => {
    initMeetController();
    return () => {
      teardownMeetController();
    };
  }, []);

  useEffect(() => {
    if (!isConfigured || !userId) return;
    locationChannelManager.joinOwn(userId);
    meetChannelManager.setSelf(userId);
    return () => {
      locationChannelManager.teardown();
      meetChannelManager.teardown();
      // A meet belongs to a pair of accounts, not to a device. Signing out has
      // to take the agreed meets and the pending requests with it.
      clearMeetState();
    };
  }, [isConfigured, userId]);

  // Meets with people who are no longer friends. Their channel closes on the
  // server the moment the friendship goes (the RLS policy tests it), so an
  // agreed meet with them could otherwise sit on the itinerary with no way
  // left to cancel or update it.
  const previousFriendIds = useRef<string[]>([]);
  useEffect(() => {
    const current = new Set(acceptedFriendIds);
    for (const id of previousFriendIds.current) {
      if (!current.has(id)) forgetMeetsWith(id);
    }
    previousFriendIds.current = Array.from(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptedFriendIdsKey]);

  // Ghost Mode's outbound half: stop transmitting, withdraw presence, and keep
  // it withdrawn across reconnects. Asserted from here rather than set at the
  // toggle, so the manager and the store cannot drift apart -- whatever the
  // store says is what the channel does, including on a fresh sign-in.
  useEffect(() => {
    void locationChannelManager.setGhost(isGhost);
  }, [isGhost]);

  // Ghost Mode's inbound half. Dropping the subscriptions rather than hiding
  // the pins is the honest version of "you can't see your friends": nothing
  // arrives, nothing is buffered, and `unsubscribeFromFriend` reports each
  // departure through `onFriendRemoved`, which clears their last position out
  // of the store. Leaving those behind would be a map full of friend pins in
  // the mode whose whole promise is that there are none.
  //
  // Meets go with them. A meet is an offer to be somewhere at a time, and one
  // arriving while the sender cannot see you -- and you cannot answer without
  // giving yourself away -- is a request neither side can act on.
  useEffect(() => {
    if (!isConfigured || !userId) return;
    const visibleFriendIds = isGhost ? [] : acceptedFriendIds;
    locationChannelManager.syncFriendSubscriptions(visibleFriendIds);
    // MOCK FRIEND -- `acceptedFriendIds` is already filtered of the fixture id
    // above, so no meet channel is ever attempted for it.
    meetChannelManager.syncFriends(visibleFriendIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigured, userId, acceptedFriendIdsKey, isGhost]);

  /**
   * Sharing starts on its own, without anybody tapping a thing.
   *
   * Two conditions guard it. Ghost Mode, obviously. And having at least one
   * accepted friend: broadcasting to nobody is a GPS watcher and a websocket
   * spent on an audience of zero, and -- the bigger reason -- it would spend
   * the one automatic location prompt at the moment it can least be justified,
   * on a map with nothing to show for saying yes.
   *
   * Gated on the connection being up rather than firing on mount, because
   * `joinOwn` above is not awaited: an attempt on the first render would be
   * refused as 'no-channel' every cold start. Re-running on later reconnects is
   * harmless and mildly useful -- `setBroadcasting` returns early when a live
   * watcher already exists, and re-asserts sharing when one somehow doesn't.
   */
  useEffect(() => {
    if (!isConfigured || !userId) return;
    if (isGhost || acceptedFriendIds.length === 0) return;
    if (connectionState !== 'connected') return;

    let isCancelled = false;
    void (async () => {
      const isPromptSpent = await hasSpentLocationPrompt();
      if (isCancelled) return;
      // Marked before the ask, not after: a dialog the user dismisses without
      // answering still spent the one we were allowed to open.
      if (!isPromptSpent) markLocationPromptSpent();
      const result = await locationChannelManager.setBroadcasting(true, {
        prompt: !isPromptSpent,
      });
      // Deliberately silent. Nobody asked for this, so nobody is owed an alert
      // when it doesn't happen -- the map's sharing button already shows the
      // state, and tapping it is the path that explains itself.
      if (!result.ok) console.warn(`[location] auto-share did not start: ${result.reason}`);
    })();

    return () => {
      isCancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigured, userId, isGhost, acceptedFriendIds.length > 0, connectionState]);

  // Mirrored into the location store so background alerts can name a friend.
  // They run with nothing mounted, so reaching back into this list at the
  // moment an alert fires would be a race they'd usually lose.
  useEffect(() => {
    if (!userId) return;
    const names: Record<string, string> = {};
    for (const row of rows) {
      if (row.status !== 'accepted') continue;
      const friend = otherParty(row, userId);
      const name = friend.display_name?.trim();
      if (name) names[friend.id] = name;
    }
    useLocationStore.getState().setFriendNames(names);
  }, [rows, userId]);

  useEffect(() => {
    if (!isConfigured) return;
    const subscription = AppState.addEventListener('change', async (next: AppStateStatus) => {
      // 'inactive' deliberately does NOT count as backgrounded. On iOS it
      // fires for a notification pull-down, Control Centre, the app switcher
      // and an incoming-call banner -- none of which mean the user has left.
      // Treating them as departures untracked presence, which lands on
      // friends' devices as "stopped broadcasting" and deletes the pin
      // outright (see setFriendPresence), losing the movement history the
      // line badge is derived from; and the trip back re-ran the entire
      // start-up flow, permission request included. iOS always passes through
      // 'inactive' on its way to 'background', so a real departure still
      // pauses immediately.
      if (next === 'background') {
        await locationChannelManager.pauseForBackground();
      } else if (next === 'active') {
        // Before resuming anything: with no journey running, JS timers stop
        // the moment the app is backgrounded (BACKGROUND.md), which takes
        // supabase-js's realtime keepalive down with them. The server then
        // drops the socket after its own timeout, and realtime-js's reconnect
        // backoff is itself a JS timer -- so the connection can be dead on
        // return with nothing left running that would ever notice. Presence
        // would be re-tracked onto a socket that isn't there, and the user
        // would sit there looking "online" to nobody.
        await locationChannelManager.ensureConnected();
        await locationChannelManager.resumeForForeground();
      }
    });
    return () => subscription.remove();
  }, [isConfigured]);

  return <>{children}</>;
}
