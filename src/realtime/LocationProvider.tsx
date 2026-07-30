import { useEffect, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { otherParty } from '../friends/useFriendships';
import { useFriendshipsContext } from '../friends/FriendshipsProvider';
import { locationChannelManager } from './locationChannel';
import { useLocationStore } from './locationStore';

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

  const acceptedFriendIds = userId
    ? rows.filter((r) => r.status === 'accepted').map((r) => otherParty(r, userId).id)
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
      onFriendRemoved: (id) => useLocationStore.getState().removeFriend(id),
      onConnectionChange: (state) => useLocationStore.getState().setConnectionState(state),
      onBroadcastInterrupted: (reason) =>
        useLocationStore.getState().setBroadcastNotice(reason),
    });
  }, []);

  useEffect(() => {
    if (!isConfigured || !userId) return;
    locationChannelManager.joinOwn(userId);
    return () => {
      locationChannelManager.teardown();
    };
  }, [isConfigured, userId]);

  useEffect(() => {
    if (!isConfigured || !userId) return;
    locationChannelManager.syncFriendSubscriptions(acceptedFriendIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigured, userId, acceptedFriendIdsKey]);

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
        await locationChannelManager.resumeForForeground();
      }
    });
    return () => subscription.remove();
  }, [isConfigured]);

  return <>{children}</>;
}
