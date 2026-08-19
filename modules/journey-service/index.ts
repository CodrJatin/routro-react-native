import { NativeModule, requireOptionalNativeModule } from 'expo';

export interface JourneyProgress {
  /** Stations completed. */
  current: number;
  /** Stations in the whole journey. */
  max: number;
}

/** One leg's share of the tracker, in stations, drawn in that line's colour.
 * Lengths must add up to `progress.max`: Android derives the bar's maximum
 * from the segments rather than being told one. */
export interface JourneyTrackerSegment {
  length: number;
  /** `#RRGGBB`. */
  color?: string;
}

/** A marker sitting on the tracker -- an interchange, in the colour of the
 * line being changed to. */
export interface JourneyTrackerPoint {
  /** Stations from the start of the journey. */
  position: number;
  color?: string;
}

export interface JourneyNotificationContent {
  title: string;
  body?: string;
  /** Shown in the header line beside the app name. */
  subText?: string;
  progress?: JourneyProgress;
  /** Android 16's segmented tracker. Ignored below that, where `progress`
   * still draws the ordinary bar. */
  segments?: JourneyTrackerSegment[];
  points?: JourneyTrackerPoint[];
  /** `#RRGGBB` or `#AARRGGBB` -- the line colour, so the notification reads as
   * part of the journey rather than as a generic app notice. */
  color?: string;
  showStopAction?: boolean;
}

/** `stop` is the notification's Stop button. `taskRemoved` is the user swiping
 * the app out of recents, which ends the journey by design -- both mean the
 * service is going away and the JS session should tear itself down. */
export type JourneyServiceAction = 'stop' | 'taskRemoved';

export interface JourneyServiceActionEvent {
  action: JourneyServiceAction;
}

export interface JourneyServiceTickEvent {
  /** ms since epoch, from the device clock at the moment the tick fired. */
  at: number;
}

export interface JourneyServiceLocationEvent {
  lat: number;
  lon: number;
  /** Radius of uncertainty in metres, or null where the provider omits it. */
  accuracy: number | null;
  /** When the fix was taken, ms since epoch on the device clock. */
  at: number;
}

type JourneyServiceEvents = {
  onAction: (event: JourneyServiceActionEvent) => void;
  onTick: (event: JourneyServiceTickEvent) => void;
  onLocation: (event: JourneyServiceLocationEvent) => void;
};

declare class JourneyServiceNativeModule extends NativeModule<JourneyServiceEvents> {
  startAsync(
    content: JourneyNotificationContent,
    tickIntervalMs: number,
    locationIntervalMs: number,
  ): Promise<void>;
  startLocationUpdatesAsync(intervalMs: number): Promise<string | null>;
  updateAsync(content: JourneyNotificationContent): Promise<boolean>;
  stopAsync(): Promise<void>;
  isRunning(): boolean;
}

// Optional rather than required: the module is Android-only, and every screen
// that touches a journey still has to render on iOS and in tests.
const native = requireOptionalNativeModule<JourneyServiceNativeModule>('JourneyService');

/** False on iOS and anywhere the native module isn't linked. Callers should
 * gate the "Start journey" affordance on this rather than letting it fail. */
export const isJourneyServiceAvailable = native !== null;

/**
 * Starts the foreground service and shows the ongoing notification.
 *
 * Only works from the foreground -- Android 12+ blocks starting a foreground
 * service from the background. Rejects with `ERR_FOREGROUND_SERVICE_START` if
 * called anyway.
 *
 * `locationIntervalMs` starts the journey's GPS feed from inside the service,
 * so fixes begin arriving without waiting on a second round trip that could
 * land before the service exists. `startJourneyServiceLocationUpdates` is the
 * same feed's restart, and is what a caller uses from then on.
 */
export async function startJourneyService(
  content: JourneyNotificationContent,
  {
    tickIntervalMs = 0,
    locationIntervalMs = 0,
  }: { tickIntervalMs?: number; locationIntervalMs?: number } = {},
): Promise<boolean> {
  if (!native) return false;
  await native.startAsync(content, tickIntervalMs, locationIntervalMs);
  return true;
}

/**
 * Replaces the notification's contents. Works while backgrounded and with the
 * screen off, which is the whole reason this module exists.
 *
 * Returns false when no journey is running, so a caller that has drifted out of
 * sync finds out rather than believing it just rendered something.
 */
export async function updateJourneyService(
  content: JourneyNotificationContent,
): Promise<boolean> {
  if (!native) return false;
  return native.updateAsync(content);
}

/**
 * Starts -- or restarts -- the journey's GPS feed, delivered through
 * `addJourneyServiceLocationListener`.
 *
 * **Use this instead of `Location.watchPositionAsync` for anything that has to
 * keep receiving fixes in the background.** expo-location's Android module
 * removes every watch it owns from `OnActivityEntersBackground` and re-requests
 * them on foreground, which is driven by the activity's lifecycle and knows
 * nothing about foreground services -- so a watcher started from JS goes
 * silent, with no error, the moment the phone is pocketed. The service's own
 * client is not on that lifecycle. See `JourneyLocationUpdates.kt`.
 *
 * Resolves to null once fixes are on their way, or to why they are not -- no
 * journey running, or the request refused (permission withdrawn mid-journey
 * being the realistic case). A caller therefore finds out rather than waiting
 * forever for a fix that is never coming, which is the whole complaint against
 * the arrangement this replaced.
 */
export async function startJourneyServiceLocationUpdates(
  intervalMs: number,
): Promise<string | null> {
  if (!native) return "This device can't follow a journey.";
  return native.startLocationUpdatesAsync(intervalMs);
}

export async function stopJourneyService(): Promise<void> {
  if (!native) return;
  await native.stopAsync();
}

export function isJourneyServiceRunning(): boolean {
  return native?.isRunning() ?? false;
}

/** Fires when the journey was ended from outside JS -- the notification's Stop
 * button, or the app being swiped away. */
export function addJourneyServiceActionListener(
  listener: (event: JourneyServiceActionEvent) => void,
): { remove: () => void } {
  if (!native) return { remove: () => {} };
  return native.addListener('onAction', listener);
}

/**
 * The service's tick, at the `tickIntervalMs` passed to `startJourneyService`.
 *
 * **Use this instead of `setInterval` for anything that has to keep running in
 * the background.** React Native drives JS timers off a Choreographer frame
 * callback that `JavaTimerManager.onHostPause` removes the moment the app is
 * backgrounded, so `setInterval` stops dead -- foreground service or not. This
 * comes off the service's own Looper handler and is unaffected.
 */
export function addJourneyServiceTickListener(
  listener: (event: JourneyServiceTickEvent) => void,
): { remove: () => void } {
  if (!native) return { remove: () => {} };
  return native.addListener('onTick', listener);
}

/** Fixes from the service's own location client. See
 * `startJourneyServiceLocationUpdates`, which is what turns them on. */
export function addJourneyServiceLocationListener(
  listener: (event: JourneyServiceLocationEvent) => void,
): { remove: () => void } {
  if (!native) return { remove: () => {} };
  return native.addListener('onLocation', listener);
}

