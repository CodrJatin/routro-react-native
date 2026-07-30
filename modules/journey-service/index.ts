import { NativeModule, requireOptionalNativeModule } from 'expo';

export interface JourneyProgress {
  /** Stations completed. */
  current: number;
  /** Stations in the whole journey. */
  max: number;
}

export interface JourneyNotificationContent {
  title: string;
  body?: string;
  progress?: JourneyProgress;
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

type JourneyServiceEvents = {
  onAction: (event: JourneyServiceActionEvent) => void;
  onTick: (event: JourneyServiceTickEvent) => void;
};

declare class JourneyServiceNativeModule extends NativeModule<JourneyServiceEvents> {
  startAsync(content: JourneyNotificationContent, tickIntervalMs: number): Promise<void>;
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
 */
export async function startJourneyService(
  content: JourneyNotificationContent,
  { tickIntervalMs = 0 }: { tickIntervalMs?: number } = {},
): Promise<boolean> {
  if (!native) return false;
  await native.startAsync(content, tickIntervalMs);
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
