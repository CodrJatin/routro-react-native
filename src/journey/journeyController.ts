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
import { logFixAccuracy, watchOptions } from '../location/watchOptions';
import { locationChannelManager } from '../realtime/locationChannel';
import type { RouteClock } from '../route/routeClock';
import { getRouteProgress, type RouteProgress } from '../route/routeProgress';
import { flipSavedJourneyAfterArrival } from '../route/savedJourneysStore';
import { ensureAlertChannel, presentAlert } from './alertNotifications';
import { journeyAlertFor } from './alerts';
import { startFriendAlerts, stopFriendAlerts } from './friendAlerts';
import { isJourneySharingEnabled, useJourneySharingStore } from './journeySharingPrefs';
import { isAlertKindEnabled, useNotificationPrefsStore } from './notificationPrefs';
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

/** How long to wait before rebuilding a watcher the provider dropped, and how
 * many times to try before the journey is actually ended. Same reasoning as
 * `RECONNECT_DELAYS_MS` in `locationChannel.ts`: a provider hiccup -- entering a
 * tunnel, a fused-provider restart, a moment of no satellites -- is a normal
 * event on a metro, and ending a journey on the first one meant the app gave
 * up on the ride at exactly the point it was most needed. */
const WATCHER_RETRY_DELAY_MS = 5000;
const WATCHER_RETRY_ATTEMPTS = 3;

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
/** Consecutive watcher failures, reset by any successful fix. See
 * `WATCHER_RETRY_ATTEMPTS`. */
let watcherFailures = 0;
let watcherRetryTimer: ReturnType<typeof setTimeout> | null = null;
/** When the pending watcher retry is due, so the service tick can run it if
 * the JS timer never fires. Zero when none is pending. */
let watcherRetryDueAt = 0;
/**
 * The notification content last handed to the service, so an unchanged repaint
 * can be skipped.
 *
 * `refresh` runs on every fix and every tick, and for most of a journey it
 * produces byte-identical content -- the same station, the same stop count, the
 * same minute. Each one was still crossing the native bridge to redraw a
 * notification that already said exactly that. Removing the filter on the
 * watcher made fixes arrive more often, which would have multiplied the waste;
 * comparing first means the change costs less than what it replaced.
 */
let lastNotificationKey: string | null = null;

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
  // Neither a previous journey's GPS trouble nor its notification text may
  // carry into this one -- the first would spend this journey's retries before
  // it started, the second would suppress its opening repaint as a duplicate.
  watcherFailures = 0;
  lastNotificationKey = null;
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

  // Hydrated before publishing, or the first push would use the default rather
  // than what the user actually chose.
  await useJourneySharingStore.getState().hydrate();
  await publishSharedJourney();

  // Scoped to the journey rather than always-on: a friend two stops away
  // matters while you are travelling and is just noise while you are at home.
  await useNotificationPrefsStore.getState().hydrate();
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
 * Repaints from whatever is in the position store right now.
 *
 * Exists for the journey simulator, which moves the user by writing to that
 * store directly and so arrives with no fix callback of its own. Without it the
 * only trigger left is the 5s service tick, and a simulation running at 60x
 * would cross several stations between two ticks -- skipping the alerts that
 * fire at them, which is usually the thing being tested.
 *
 * Not a code path a real journey ever takes: a real fix already brings its own
 * refresh. It runs the same `refresh` either way, so nothing here is a
 * simulation-only branch.
 */
export async function refreshJourneyNow(): Promise<void> {
  await refresh();
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
  await useJourneySharingStore.getState().hydrate();
  await publishSharedJourney();
  await useNotificationPrefsStore.getState().hydrate();
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
  watcherFailures = 0;
  lastNotificationKey = null;
  useJourneyStore.getState().setSession(null);
  if (notice) useJourneyStore.getState().setEndedNotice(notice);

  // Reads the session that was just cleared, so this publishes "no journey" --
  // friends stop seeing a destination the moment the journey ends, rather than
  // when presence next happens to re-sync.
  await publishSharedJourney();

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

  // Not awaited: a presence re-track is a courtesy to friends, and the
  // notification in front of the user must not wait on the network for it.
  // A no-op unless something actually changed -- see `publishSharedJourney`.
  void publishSharedJourney();

  // Before the service call, not after: an alert the user acts on is worth
  // more than a notification repaint, and a failed repaint ends the journey.
  await maybeAlert(progress);

  // Repaint only when the user would actually see a difference. See
  // `lastNotificationKey`. Deliberately keyed on the rendered content rather
  // than on progress, because that is what decides whether the repaint is
  // visible -- two different positions inside the same station, arriving in
  // the same minute, produce identical text and nothing worth crossing the
  // bridge for.
  const notificationKey = JSON.stringify(content);
  if (notificationKey !== lastNotificationKey) {
    if (!(await updateJourneyService(content))) {
      // The service went away underneath us. Nothing is being tracked, so stop
      // claiming otherwise instead of repainting a notification that isn't there.
      await endJourney(null);
      return;
    }
    // After the call, not before: a failed repaint must not be remembered as
    // the notification's current state, or the retry would be skipped as a
    // duplicate of something that never landed.
    lastNotificationKey = notificationKey;
  }

  if (hasArrived(progress)) {
    if (arrivedAt === null) {
      arrivedAt = Date.now();
    } else if (Date.now() - arrivedAt >= ARRIVAL_LINGER_MS) {
      // Before ending it, which clears the session this reads. Deliberately
      // here rather than inside `endJourney`: that also runs for a journey
      // stopped halfway, one whose route vanished under a recompiled graph,
      // and one whose service died -- none of which mean the user arrived
      // anywhere, and none of which should offer them the trip home.
      await flipSavedJourneyForArrival();
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

/**
 * Pushes the current journey (or nothing) to the realtime layer for friends to
 * see, honouring the user's sharing preference.
 *
 * The single place that decision is made. `locationChannel` deliberately has no
 * idea what a journey or a preference is -- it takes a record and relays it, in
 * the same way `setBackgroundAllowed` only tells it that *something* is holding
 * the process open.
 *
 * Idempotent, and called from `refresh` as well as from start/stop, so it
 * doubles as a re-assertion: a preference toggled mid-journey, or a journey
 * that outlived a channel teardown, is corrected on the next tick rather than
 * staying wrong until the journey ends.
 */
async function publishSharedJourney(): Promise<void> {
  const session = useJourneyStore.getState().session;
  await locationChannelManager.setSharedJourney(
    session && isJourneySharingEnabled()
      ? {
          originId: session.originId,
          destinationId: session.destinationId,
          mode: session.mode,
          startedAt: session.startedAt,
        }
      : null,
  );
}

/** Fires the alert for where the user is now, unless it has already been
 * fired this journey. See `firedAlertKeys`. */
async function maybeAlert(progress: RouteProgress | null): Promise<void> {
  if (!route) return;
  const alert = journeyAlertFor(route, progress);
  if (!alert || firedAlertKeys.has(alert.key)) return;

  // Latched even when the alert won't be shown, so turning a preference back
  // on mid-journey doesn't immediately fire an alert about a station passed
  // ten minutes ago -- and so a superseded alert can't fire later either.
  firedAlertKeys.add(alert.key);

  if (alert.redundantAfter && firedAlertKeys.has(alert.redundantAfter)) return;
  if (!isAlertKindEnabled(alert.kind)) return;

  await presentAlert(alert);
}

/** Offers the trip home on the card the trip out was planned from. Failures
 * are swallowed on purpose: a saved-list write that didn't land must not stop
 * the journey it was triggered by from ending. */
async function flipSavedJourneyForArrival(): Promise<void> {
  const session = useJourneyStore.getState().session;
  if (!session) return;
  try {
    await flipSavedJourneyAfterArrival(session.originId, session.destinationId);
  } catch {
    // Best-effort; the card simply stays pointing the way it did.
  }
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
      // Shared with the map and broadcast watchers -- see `watchOptions.ts`.
      // `mayShowUserSettingsDialog` is off there by default, which matters
      // here: this also runs from `initJourneyController` at launch, where
      // expo's default of true would open Play's "turn on location?" dialog
      // before the app had drawn a frame.
      watchOptions(),
      (position) => {
        // Arriving at all is the proof the provider recovered, so the failure
        // count goes back to zero here rather than on the watcher being
        // created -- a watcher that installs cleanly and then delivers nothing
        // is the failure this is counting.
        watcherFailures = 0;
        logFixAccuracy('journey', position.coords.accuracy);
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
        void handleWatcherFailure(`Location stopped: ${reason}`);
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
    await handleWatcherFailure(
      error instanceof Error ? `Couldn't start GPS: ${error.message}` : "Couldn't start GPS.",
    );
  }
}

/**
 * The provider stopped or refused to start. Rebuild rather than end the
 * journey, up to `WATCHER_RETRY_ATTEMPTS`.
 *
 * The old behaviour ended it outright on the first failure, which on a metro
 * meant a tunnel could cancel the ride -- taking the alight alert with it, the
 * one thing the user actually started this for. The journey service keeps
 * running throughout, so the notification stays put and the arrival clock keeps
 * being re-timed off the tick while GPS is missing; only the position goes
 * quiet, which is a state every consumer already handles.
 */
async function handleWatcherFailure(reason: string): Promise<void> {
  stopWatcher();
  if (++watcherFailures > WATCHER_RETRY_ATTEMPTS) {
    await endJourney(reason);
    return;
  }
  console.warn(
    `[journey] watcher failed (${reason}), retry ${watcherFailures}/${WATCHER_RETRY_ATTEMPTS}`,
  );
  const myGeneration = generation;
  watcherRetryDueAt = Date.now() + WATCHER_RETRY_DELAY_MS;
  watcherRetryTimer = setTimeout(() => {
    watcherRetryTimer = null;
    // Superseded by a stop or a restart while the delay ran.
    if (myGeneration !== generation) return;
    void retryWatcherIfDue();
  }, WATCHER_RETRY_DELAY_MS);
}

/** Runs the pending retry. Driven by the service tick as well as by the timer
 * above, because that timer does not fire while the app is backgrounded
 * (BACKGROUND.md) -- which is where a journey spends most of its life, and so
 * where a dropped watcher would otherwise never be rebuilt at all. Whichever
 * gets here first clears the due time; the other finds nothing to do. */
async function retryWatcherIfDue(): Promise<void> {
  if (watcherRetryDueAt === 0 || Date.now() < watcherRetryDueAt) return;
  watcherRetryDueAt = 0;
  await startWatcher();
}

function stopWatcher(): void {
  watcher?.remove();
  watcher = null;
  watcherRetryDueAt = 0;
  if (watcherRetryTimer !== null) {
    clearTimeout(watcherRetryTimer);
    watcherRetryTimer = null;
  }
}

function subscribe(): void {
  unsubscribe();
  tickSubscription = addJourneyServiceTickListener(() => {
    // The service's tick is the app's only working clock while backgrounded,
    // so everything periodic hangs off it -- not just the notification.
    locationChannelManager.tick();
    void retryWatcherIfDue();
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
