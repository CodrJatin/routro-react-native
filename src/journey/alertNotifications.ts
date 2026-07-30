import { Platform } from 'react-native';

type NotificationsModule = typeof import('expo-notifications');

/** `undefined` means "not tried yet", `null` means "tried and unavailable". */
let notifications: NotificationsModule | null | undefined;
let isHandlerSet = false;

/**
 * Loads expo-notifications on demand rather than importing it at module scope.
 *
 * The package throws from its own top level when its native module is missing,
 * which is the normal state of affairs whenever JS has been updated but the
 * native app hasn't been rebuilt. A static import turns that into a crash on
 * launch, because the import chain reaches this file from the tabs layout --
 * so a stale build took down the whole app rather than just its alerts.
 * Losing alerts in that situation is acceptable; losing the app is not.
 */
function getNotifications(): NotificationsModule | null {
  if (notifications !== undefined) return notifications;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    notifications = require('expo-notifications') as NotificationsModule;
  } catch (error) {
    console.warn('[journey] notifications unavailable, alerts disabled', error);
    notifications = null;
  }
  return notifications;
}

/**
 * Alerts live on their own channel, separate from the journey's ongoing
 * notification.
 *
 * That separation is the whole design. The ongoing notification is replaced
 * every few seconds and must stay silent; these are rare and must interrupt.
 * One channel cannot be both, and Android only lets a channel's importance be
 * set at creation -- so getting this wrong once means every user who installed
 * that build keeps the wrong behaviour until they reinstall.
 */
const ALERT_CHANNEL_ID = 'metrosync.alerts';

let isConfigured = false;

/**
 * Shows alerts even while the app is open.
 *
 * The default is to suppress them in the foreground, which is wrong here: the
 * user may well be looking at the map rather than the itinerary when the
 * "get off next" alert fires, and silently swallowing it is the one failure
 * this feature cannot afford.
 */
function ensureHandler(Notifications: NotificationsModule): void {
  if (isHandlerSet) return;
  isHandlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function ensureAlertChannel(): Promise<void> {
  if (isConfigured) return;

  const Notifications = getNotifications();
  if (!Notifications) {
    // Marked configured so every later alert doesn't re-attempt the require.
    isConfigured = true;
    return;
  }
  ensureHandler(Notifications);

  if (Platform.OS !== 'android') {
    isConfigured = true;
    return;
  }
  await Notifications.setNotificationChannelAsync(ALERT_CHANNEL_ID, {
    name: 'Journey alerts',
    description: 'Getting off, changing lines, and friends arriving.',
    // HIGH rather than MAX: this should slide down over what you are doing and
    // make a sound, but it is not a phone call and has no business bypassing
    // Do Not Disturb.
    importance: Notifications.AndroidImportance.HIGH,
    enableVibrate: true,
    // A double pulse -- distinguishable from a message by feel alone, which is
    // the point when the phone is in a pocket on a loud train.
    vibrationPattern: [0, 250, 150, 250],
  });
  isConfigured = true;
}

export interface AlertNotification {
  title: string;
  body: string;
  color?: string;
}

/**
 * Fires one alert immediately.
 *
 * Deliberately fire-and-forget: an alert that fails to display is not worth
 * interrupting a journey over, and the ongoing notification still carries the
 * same information for anyone who looks.
 */
export async function presentAlert(alert: AlertNotification): Promise<void> {
  try {
    await ensureAlertChannel();
    const Notifications = getNotifications();
    if (!Notifications) return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: alert.title,
        body: alert.body,
        color: alert.color,
        priority: Notifications.AndroidNotificationPriority.HIGH,
        sound: true,
      },
      // Now, not scheduled. A journey alert is only ever about this moment.
      trigger: null,
    });
  } catch (error) {
    console.warn('[journey] could not present alert', error);
  }
}
