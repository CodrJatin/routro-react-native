import type { StationId } from '../engine/types';
import { estimateFriendEta } from '../friends/friendEta';
import { useMeetStore } from '../friends/meetStore';
import { findNearestStation } from '../friends/nearestStation';
import { useSelfPositionStore } from '../location/selfPosition';
import { useLocationStore, type FriendLocation } from '../realtime/locationStore';
import { readSelfDestinationId } from '../route/useSelfRoute';
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
 * interrupting for: a friend getting close, and a friend reaching a station
 * that means something to the user -- see `arrivalReasonFor`, which is what
 * keeps "arriving somewhere" from meaning every stop on their line.
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

/**
 * Why a friend turning up somewhere is worth interrupting for.
 *
 * The list is deliberately short. A friend riding a line passes a station
 * every couple of minutes, and announcing each one buried the alerts that
 * matter under a stream of ones that don't -- which is how someone ends up
 * silencing friend alerts altogether. These three are the places where their
 * arrival changes what the user should do next.
 */
type ArrivalReason = 'meeting-point' | 'your-destination' | 'where-you-are';

const ARRIVAL_BODY: Record<ArrivalReason, string> = {
  'meeting-point': "Where you're meeting them.",
  'your-destination': "That's your destination.",
  'where-you-are': "That's where you are.",
};

/**
 * Whether this station is one of the few the user cares about, and why.
 *
 * Ordered by how much the user has committed to the place: a meeting they
 * agreed to outranks where they happen to be headed, which outranks where they
 * are standing. Only the first one is reported, so an arrival never says two
 * things at once.
 *
 * Kept cheap on purpose -- this runs on every fix a friend sends from near a
 * station. The meet is a hash lookup, the destination is read straight off the
 * session (see `readSelfDestinationId`, which deliberately does not route),
 * and only the last one scans the station list.
 */
function arrivalReasonFor(userId: string, stationId: StationId): ArrivalReason | null {
  if (useMeetStore.getState().meets[userId]?.stationId === stationId) return 'meeting-point';
  if (readSelfDestinationId() === stationId) return 'your-destination';

  const self = useSelfPositionStore.getState().position;
  if (!self) return null;
  const here = findNearestStation(self.lat, self.lon);
  // The same threshold the friend had to clear. Without it, "that's where you
  // are" would fire while the user is on a moving train that merely happens to
  // be nearest that station.
  if (here && here.stationId === stationId && here.distanceMeters <= AT_STATION_METERS) {
    return 'where-you-are';
  }
  return null;
}

async function considerFriend(userId: string, location: FriendLocation): Promise<void> {
  const name = friendLabel(userId);

  const station = findNearestStation(location.lat, location.lon);
  if (station && station.distanceMeters <= AT_STATION_METERS) {
    const reason = arrivalReasonFor(userId, station.stationId);
    // Keyed by station as well as friend: the handful of stations that qualify
    // are genuinely different events -- a friend reaching the meeting point
    // and later reaching your destination are two things you want to hear --
    // and the filter above is what stops that becoming one alert per stop.
    const key = `arrived:${userId}:${station.stationId}`;
    if (reason && !firedKeys.has(key)) {
      firedKeys.add(key);
      await presentAlert({
        title: `${name} is at ${station.name}`,
        body: ARRIVAL_BODY[reason],
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
