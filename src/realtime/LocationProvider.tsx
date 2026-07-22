import { useEffect, useRef, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { otherParty } from '../friends/useFriendships';
import { useFriendshipsContext } from '../friends/FriendshipsProvider';
import { locationChannelManager } from './locationChannel';
import { useLocationStore } from './locationStore';

/** Mounted once inside the authenticated (tabs) layout. Joins the user's own
 * presence/location channel, keeps friend-channel subscriptions in sync with
 * the accepted-friends list, and pauses broadcasting when the app is
 * backgrounded (no background location -- keeps this app off the
 * background-location permission review path, and matches the "ephemeral,
 * foreground-only" design in the architecture). */
export function LocationProvider({ children }: { children: ReactNode }) {
  const { isConfigured, session } = useAuth();
  const userId = session?.user.id;
  const { rows } = useFriendshipsContext();
  const wasBroadcastingBeforeBackground = useRef(false);

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

  useEffect(() => {
    if (!isConfigured) return;
    const subscription = AppState.addEventListener('change', async (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        wasBroadcastingBeforeBackground.current = await locationChannelManager.pauseForBackground();
      } else if (next === 'active') {
        await locationChannelManager.resumeForForeground(wasBroadcastingBeforeBackground.current);
      }
    });
    return () => subscription.remove();
  }, [isConfigured]);

  return <>{children}</>;
}
