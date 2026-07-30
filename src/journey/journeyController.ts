import * as Location from 'expo-location';
import { PermissionsAndroid, Platform } from 'react-native';
import {
  addJourneyServiceActionListener,
  addJourneyServiceTickListener,
  isJourneyServiceAvailable,
  isJourneyServiceRunning,
  startJourneyService,
  stopJourneyService,
  updateJourneyService,
} from '../../modules/journey-service';
import { findRoute } from '../engine/graph';
import type { RouteMode, RouteResult, StationId } from '../engine/types';
import { useSelfPositionStore } from '../location/selfPosition';
import { locationChannelManager } from '../realtime/locationChannel';
import type { RouteClock } from '../route/routeClock';
import { getRouteProgress, type RouteProgress } from '../route/routeProgress';
import { ensureAlertChannel, presentAlert } from './alertNotifications';
import { journeyAlertFor } from './alerts';
import { startFriendAlerts, stopFriendAlerts, useFriendAlertsStore } from './friendAlerts';
import { useJourneyStore, type JourneySession } from './journeyStore';
import { buildJourneyNotification } from './notificationContent';

/**
 * How often the service wakes JS.
 *
 * Nothing to do with how often position arrives. It keeps the arrival clock
 * honest for someone standing still on a platform, where no new fix will
 * arrive but every quoted time is quietly going stale -- and it is also the
 * app's only working clock while backgrounded, so `locationChannel` hangs its
 * heartbeats off it too. See BACKGROUND.md.
 *
 * 5s is set by the slowest thing that depends on it: the broadcast heartbeat
 * resends a fix once 15s old, and friends mark a sender stale at 30s. A 15s
 * tick would put the worst case at 15 + 15 = exactly the staleness threshold.
 */
const TICK_INTERVAL_MS = 5000;

/** Matches the broadcast watcher's settings in `locationChannel.ts`, so a
 * journey doesn't cost noticeably more battery than sharing already does. */
const LOCATION_INTERVAL_MS = 5000;
const LOCATION_DISTANCE_METERS = 15;

/** Close enough to the last station to call the journey done. Deliberately
 * much tighter than `MAX_ON_ROUTE_DISTANCE_METERS`, which only decides whether
 * the user is on this route at all. */
const ARRIVAL_DISTANCE_METERS = 400;

/** How long "Arrived" stays on screen before the notification is taken away.
 * Stopping the instant the destination is reached deletes the one message the
 * user most wants to see. */
const ARRIVAL_LINGER_MS = 30_000;

/** A journey nobody ended. Four hours is far longer than any Delhi Metro trip,
 * so this only ever catches a forgotten one -- but a foreground service and a
 * GPS watcher running overnight is worth catching. */
const MAX_JOURNEY_MS = 4 * 60 * 60 * 1000;

export type StartJourneyResult = { ok: true } | { ok: false; reason: string };

// --- module state. Deliberately not React: the controller has to keep working
// with nothing mounted, and a hook would tie it to whichever screen happened
// to be on top when the journey started.
let route: RouteResult | null = null;
let watcher: Location.LocationSubscription | null = null;
let tickSubscription: { remove: () => void } | null = null;
let actionSubscription: { remove: () => void } | null = null;
let arrivedAt: number | null = null;

/**
 * Alerts already fired this journey, by `JourneyAlert.key`.
 *
 * `journeyAlertFor` is stateless -- it answers what is true at this position,
 * not what is new -- so without this a user standing at an interchange would
 * be buzzed every few seconds, and a fix jittering across a station boundary
 * would buzz them repeatedly for the same event.
 *
 * In memory only. The service cannot outlive the process (swiping the app away
 * stops it), so there is no session that could return with its history lost.
 */
let firedAlertKeys = new Set<string>();

/** Bumped by every start/stop so a call that was awaiting something slow can
 * tell it has been superseded, rather than installing a watcher for a journey
 * that has since been cancelled. Same pattern as `locationChannel`. */
let generation = 0;

// The arrival clock, kept here rather than in `useRouteClock` -- same two
// modes, same meaning, but readable without a component. See RouteClock.
let clockAnchorMs = 0;
let clockAnchorOffsetSeconds = 0;
let clockIsLive = false;

/**
 * Starts tracking a journey: foreground service, ongoing notification, and a
 * location watcher that keeps both current.
 *
 * Must be called while the app is in the foreground. Android blocks starting a
 * foreground service from the background outright, which is why journeys begin
 * on an explicit tap rather than starting themselves.
 */
export async function startJourney(
  originId: StationId,
  destinationId: StationId,
  mode: RouteMode,
): Promise<StartJourneyResult> {
  if (!isJourneyServiceAvailable) {
    return { ok: false, reason: 'Background journeys are Android-only for now.' };
  }
  // Already tracking this exact journey -- re-requesting permissions and
  // restarting the watcher would be churn for no change.
  const existing = useJourneyStore.getState().session;
  if (
    existing &&
    existing.originId === originId &&
    existing.destinationId === destinationId &&
    existing.mode === mode
  ) {
    return { ok: true };
  }

  const nextRoute = findRoute(originId, destinationId, mode);
  if (!nextRoute) {
    return { ok: false, reason: "Couldn't find a route between those stations." };
  }

  const myGeneration = ++generation;

  // Notifications first. Without this the service still runs, but invisibly --
  // which is the most confusing way for this feature to fail, since the user
  // has no way to tell it is on and no way to stop it.
  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }
  if (myGeneration !== generation) return { ok: true };

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    return { ok: false, reason: 'Location permission is needed to follow your journey.' };
  }
  if (myGeneration !== generation) return { ok: true };

  if (!(await hasLocationServices())) {
    return {
      ok: false,
      reason: 'Location is turned off on this device. Switch it on, then try again.',
    };
  }
  if (myGeneration !== generation) return { ok: true };

  route = nextRoute;
  arrivedAt = null;
  // A fresh journey has said nothing yet, even if it retraces one that has.
  firedAlertKeys = new Set();
  resetClock();

  // Created up front rather than on the first alert: Android only honours a
  // channel's importance at creation, and creating it mid-journey would leave
  // the very first alert -- often "get off next" -- on default settings.
  await ensureAlertChannel();

  const progress = currentProgress();
  const content = buildJourneyNotification(nextRoute, progress, clockFor(progress));

  try {
    await startJourneyService(content, { tickIntervalMs: TICK_INTERVAL_MS });
  } catch (error) {
    route = null;
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Couldn't start the journey notification.",
    };
  }

  if (myGeneration !== generation) {
    // Superseded while starting -- take down what was just created rather than
    // leaving a service running for a journey nobody is tracking.
    await stopJourneyService();
    return { ok: true };
  }

  const session: JourneySession = { originId, destinationId, mode, startedAt: Date.now() };
  useJourneyStore.getState().setSession(session);

  // Deliberately does NOT switch sharing on. Following your own journey and
  // letting friends watch it are separate decisions, and quietly conflating
  // them would start broadcasting on the user's behalf. This only means that
  // sharing, if already on, survives the app being backgrounded.
  locationChannelManager.setBackgroundAllowed(true);
  await locationChannelManager.setExternalFixSource(true);

  // Scoped to the journey rather than always-on: a friend two stops away
  // matters while you are travelling and is just noise while you are at home.
  await useFriendAlertsStore.getState().hydrate();
  startFriendAlerts();

  subscribe();
  await startWatcher();

  return { ok: true };
}

/** Ends the journey the user asked to end. */
export async function stopJourney(): Promise<void> {
  await endJourney(null);
}

/**
 * Reconciles persisted state at launch, and keeps the controller listening for
 * a journey ended from outside JS.
 *
 * Call once, early. A stored session with no running service means the journey
 * ended while the app was gone -- the service cannot outlive the process -- so
 * the right move is always to clear it, never to resume.
 */
export async function initJourneyController(): Promise<void> {
  await useJourneyStore.getState().hydrate();
  if (!useJourneyStore.getState().session) return;

  if (!isJourneyServiceRunning()) {
    useJourneyStore.getState().setSession(null);
    return;
  }

  // The service survived (the React instance was replaced under a live
  // process). Pick the journey back up rather than orphaning its notification.
  const session = useJourneyStore.getState().session!;
  route = findRoute(session.originId, session.destinationId, session.mode);
  if (!route) {
    await endJourney('The saved journey no longer exists on the map.');
    return;
  }
  resetClock();
  await ensureAlertChannel();
  locationChannelManager.setBackgroundAllowed(true);
  await locationChannelManager.setExternalFixSource(true);
  await useFriendAlertsStore.getState().hydrate();
  startFriendAlerts();
  subscribe();
  await startWatcher();
}

async function endJourney(notice: string | null): Promise<void> {
  ++generation;
  stopWatcher();
  unsubscribe();
  stopFriendAlerts();
  route = null;
  arrivedAt = null;
  useJourneyStore.getState().setSession(null);
  if (notice) useJourneyStore.getState().setEndedNotice(notice);

  // Order matters: hand the GPS back before withdrawing the background
  // permission, so a user who was sharing keeps sharing across the handover
  // rather than going quiet between the two calls.
  await locationChannelManager.setExternalFixSource(false);
  locationChannelManager.setBackgroundAllowed(false);

  await stopJourneyService();
}

/**
 * Recomputes where the user is and repaints the notification.
 *
 * The single funnel -- every trigger (a new fix, a service tick, startup)
 * comes through here, so there is one answer to "where are we" rather than one
 * per caller.
 */
async function refresh(): Promise<void> {
  const session = useJourneyStore.getState().session;
  if (!route || !session) return;

  if (Date.now() - session.startedAt > MAX_JOURNEY_MS) {
    await endJourney('Your journey was still running after four hours, so it was stopped.');
    return;
  }

  const progress = currentProgress();
  const content = buildJourneyNotification(route, progress, clockFor(progress));

  // Before the service call, not after: an alert the user acts on is worth
  // more than a notification repaint, and a failed repaint ends the journey.
  await maybeAlert(progress);

  if (!(await updateJourneyService(content))) {
    // The service went away underneath us. Nothing is being tracked, so stop
    // claiming otherwise instead of repainting a notification that isn't there.
    await endJourney(null);
    return;
  }

  if (hasArrived(progress)) {
    if (arrivedAt === null) {
      arrivedAt = Date.now();
    } else if (Date.now() - arrivedAt >= ARRIVAL_LINGER_MS) {
      await endJourney(null);
    }
  } else {
    // Overshooting and coming back, or a jittery fix at the last station --
    // either way the journey isn't over, so the countdown starts again.
    arrivedAt = null;
  }
}

function currentProgress(): RouteProgress | null {
  return getRouteProgress(route, useSelfPositionStore.getState().position);
}

/** Fires the alert for where the user is now, unless it has already been
 * fired this journey. See `firedAlertKeys`. */
async function maybeAlert(progress: RouteProgress | null): Promise<void> {
  if (!route) return;
  const alert = journeyAlertFor(route, progress);
  if (!alert || firedAlertKeys.has(alert.key)) return;
  firedAlertKeys.add(alert.key);
  await presentAlert(alert);
}

function hasArrived(progress: RouteProgress | null): boolean {
  if (!progress) return false;
  return (
    progress.nearestIndex === progress.sequence.length - 1 &&
    progress.distanceMeters <= ARRIVAL_DISTANCE_METERS
  );
}

async function startWatcher(): Promise<void> {
  stopWatcher();
  const myGeneration = generation;

  try {
    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: LOCATION_INTERVAL_MS,
        distanceInterval: LOCATION_DISTANCE_METERS,
      },
      (position) => {
        // The journey's watcher is the app's live position while it runs --
        // the map and route planner read the same store, so they can't place
        // the user at a different station than the notification does.
        useSelfPositionStore
          .getState()
          .setLive(position.coords.latitude, position.coords.longitude);
        // Broadcast off the same fix rather than a watcher of its own -- see
        // `setExternalFixSource`. A no-op unless the user is sharing.
        locationChannelManager.submitFix(
          position.coords.latitude,
          position.coords.longitude,
          position.timestamp,
        );
        void refresh();
      },
      (reason) => {
        void endJourney(`Location stopped: ${reason}`);
      },
    );

    if (myGeneration !== generation) {
      // Journey ended while the watcher was being created -- remove it rather
      // than leaking a subscription with no handle left to stop it.
      subscription.remove();
      return;
    }
    watcher = subscription;
  } catch (error) {
    await endJourney(
      error instanceof Error ? `Couldn't start GPS: ${error.message}` : "Couldn't start GPS.",
    );
  }
}

function stopWatcher(): void {
  watcher?.remove();
  watcher = null;
}

function subscribe(): void {
  unsubscribe();
  tickSubscription = addJourneyServiceTickListener(() => {
    // The service's tick is the app's only working clock while backgrounded,
    // so everything periodic hangs off it -- not just the notification.
    locationChannelManager.tick();
    void refresh();
  });
  actionSubscription = addJourneyServiceActionListener(() => {
    // Stop button, or the app swiped away. The service is already stopping
    // itself; this just tears down our half.
    void endJourney(null);
  });
}

function unsubscribe(): void {
  tickSubscription?.remove();
  tickSubscription = null;
  actionSubscription?.remove();
  actionSubscription = null;
}

async function hasLocationServices(): Promise<boolean> {
  try {
    return await Location.hasServicesEnabledAsync();
  } catch {
    // Can't tell -- don't block the user on a failed capability check.
    return true;
  }
}

function resetClock(): void {
  clockAnchorMs = Date.now();
  clockAnchorOffsetSeconds = 0;
  clockIsLive = false;
}

/**
 * The same two modes `useRouteClock` has, without the component.
 *
 * Live, the offsets hang off the station the user is nearest to and are
 * re-pinned to now on every refresh, so a train sitting on a platform pushes
 * every remaining arrival out in real time. Not live, they hang off the trip
 * origin and stay put -- re-pinning them would march the whole journey forward
 * for a user we can't actually locate.
 */
function clockFor(progress: RouteProgress | null): RouteClock {
  const isLive = progress !== null;
  const anchorOffsetSeconds = progress
    ? progress.sequence[progress.nearestIndex].offsetSeconds
    : 0;

  if (isLive || isLive !== clockIsLive || anchorOffsetSeconds !== clockAnchorOffsetSeconds) {
    clockAnchorMs = Date.now();
  }
  clockIsLive = isLive;
  clockAnchorOffsetSeconds = anchorOffsetSeconds;

  return { anchorMs: clockAnchorMs, anchorOffsetSeconds, isLive };
}
