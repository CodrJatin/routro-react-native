import { estimateFriendEta } from '../friends/friendEta';
import { findNearestStation } from '../friends/nearestStation';
import { useSelfPositionStore } from '../location/selfPosition';
import { useLocationStore, type FriendLocation } from '../realtime/locationStore';
import { presentAlert } from './alertNotifications';
import { areFriendAlertsEnabled } from './notificationPrefs';

/** Stops away at which a friend is worth mentioning. Close enough to act on
 * (get off, wait, meet them), far enough to be useful. */
const NEARBY_STOPS = 2;

/** How close a friend has to be to a station to count as having arrived at it,
 * matching what the Friends tab already treats as "at" a station. */
const AT_STATION_METERS = 250;

/** Latched per friend and event, so a friend sitting two stops away doesn't
 * re-announce themselves on every broadcast they send. Cleared when the
 * watcher stops. */
let firedKeys = new Set<string>();
let unsubscribe: (() => void) | null = null;

/**
 * Watches friends' broadcast locations and alerts on the two moments worth
 * interrupting for: a friend getting close, and a friend arriving somewhere.
 *
 * Driven by the location store rather than by a timer, so it works in the
 * background for free -- friend positions arrive over the websocket, which is
 * a native callback into JS and unaffected by React Native pausing its timers.
 */
export function startFriendAlerts(): void {
  stopFriendAlerts();
  firedKeys = new Set();

  unsubscribe = useLocationStore.subscribe((state, previous) => {
    // Read per emission rather than captured at start, so switching the
    // preference off silences alerts immediately rather than at the next
    // journey.
    if (!areFriendAlertsEnabled()) return;
    if (state.friendLocations === previous.friendLocations) return;

    for (const [userId, location] of Object.entries(state.friendLocations)) {
      // Unchanged since the last emission, or a heartbeat repeat of a fix we
      // have already considered -- either way there is nothing new to say.
      if (previous.friendLocations[userId]?.movedAt === location.movedAt) continue;
      void considerFriend(userId, location);
    }
  });
}

export function stopFriendAlerts(): void {
  unsubscribe?.();
  unsubscribe = null;
  firedKeys = new Set();
}

async function considerFriend(userId: string, location: FriendLocation): Promise<void> {
  const name = friendLabel(userId);

  const station = findNearestStation(location.lat, location.lon);
  if (station && station.distanceMeters <= AT_STATION_METERS) {
    // Keyed by station, not by friend: someone riding the line past you would
    // otherwise announce every station they pass through.
    const key = `arrived:${userId}:${station.stationId}`;
    if (!firedKeys.has(key)) {
      firedKeys.add(key);
      await presentAlert({
        title: `${name} is at ${station.name}`,
        body: 'They just arrived.',
      });
      return;
    }
  }

  const self = useSelfPositionStore.getState().position;
  if (!self) return;

  const eta = estimateFriendEta(self.lat, self.lon, location.lat, location.lon);
  if (!eta || eta.stops > NEARBY_STOPS || eta.stops === 0) return;

  // One "getting close" per friend per journey. Announcing it again as they
  // close from two stops to one is noise -- the user already knows.
  const key = `nearby:${userId}`;
  if (firedKeys.has(key)) return;
  firedKeys.add(key);

  await presentAlert({
    title: `${name} is ${eta.stops} ${eta.stops === 1 ? 'stop' : 'stops'} away`,
    body: `About ${eta.minutes} min from you.`,
  });
}

/**
 * A friend's display name, or a neutral fallback.
 *
 * Deliberately does not reach into the friendships list: this runs in the
 * background where nothing guarantees that list has loaded, and "A friend is
 * at Rajiv Chowk" is a better alert than one that never fires.
 */
function friendLabel(userId: string): string {
  return useLocationStore.getState().friendNames[userId] ?? 'A friend';
}
