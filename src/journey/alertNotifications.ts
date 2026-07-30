import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

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
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensureAlertChannel(): Promise<void> {
  if (isConfigured || Platform.OS !== 'android') {
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
