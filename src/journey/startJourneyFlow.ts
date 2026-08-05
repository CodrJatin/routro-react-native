import { Alert } from 'react-native';
import type { RouteMode, StationId } from '../engine/types';
import { startJourney } from './journeyController';
import { useJourneyStore } from './journeyStore';

export type StartJourneyOutcome = 'started' | 'cancelled' | 'failed';

/**
 * The one way a journey begins from the UI: the first-run explanation, the
 * start itself, and the alert when it couldn't.
 *
 * Lifted out of `StartJourneyButton` once saved journeys grew a start button
 * of their own. The intro is shown once per install and describes what the app
 * does while nobody is looking at it -- which button happened to be pressed
 * must not decide whether the user ever sees it.
 */
export async function confirmAndStartJourney(
  originId: StationId,
  destinationId: StationId,
  mode: RouteMode,
): Promise<StartJourneyOutcome> {
  if (!useJourneyStore.getState().hasSeenIntro) {
    if (!(await askIntro())) return 'cancelled';
    useJourneyStore.getState().markIntroSeen();
  }

  const result = await startJourney(originId, destinationId, mode);
  if (!result.ok) {
    Alert.alert("Couldn't start the journey", result.reason);
    return 'failed';
  }
  return 'started';
}

/**
 * Resolves true only if the user chose to go ahead.
 *
 * `onDismiss` matters as much as the buttons: on Android the back button
 * closes an alert without pressing either, and without it that promise would
 * never settle -- leaving the caller's busy state spinning on a button the
 * user has already walked away from.
 */
function askIntro(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Start this journey?',
      // Trimmed when sharing became the default. The paragraph about friends
      // seeing you move has moved to onboarding, where it belongs: it is true
      // of the whole app now, not of this button, and repeating it here made
      // the one genuinely new fact -- that something keeps running after you
      // put the phone away -- the middle of a wall of text.
      'Routro will show a notification with your progress and tell you when to get off — ' +
        'including while the app is closed and your phone is locked. Friends keep seeing you ' +
        'move for the whole journey.\n\n' +
        'Stop any time from the notification, or by swiping the app away.',
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Start', onPress: () => resolve(true) },
      ],
      { onDismiss: () => resolve(false) },
    );
  });
}
