import * as Updates from 'expo-updates';
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { syncUpdateOnForeground } from './otaUpdates';

/**
 * Checks for an over-the-air update whenever the app is reopened. See
 * `otaUpdates.ts` for what it does with one, and for why it is careful about
 * when.
 *
 * No check on mount: expo-updates has already run its own at launch, and this
 * exists precisely to cover the launches that never happen again.
 */
export function useOtaUpdates(): void {
  // Whether an update the launch-time check already downloaded is waiting to
  // be applied. Mirrored into a ref because the AppState listener below is
  // registered once and would otherwise close over the value as of mount.
  const { isUpdatePending } = Updates.useUpdates();
  const isPending = useRef(isUpdatePending);
  // From an effect, not during render: a discarded render must not leave a ref
  // describing state the app was never in.
  useEffect(() => {
    isPending.current = isUpdatePending;
  }, [isUpdatePending]);

  useEffect(() => {
    // Held here rather than in the module so it cannot outlive the mount, and
    // so a foreground with no preceding background (the very first event on
    // some platforms) reads as "no time away" rather than as an eternity.
    let awayAt: number | null = null;

    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background') {
        awayAt = Date.now();
        return;
      }
      // 'inactive' is not a departure -- a notification pull-down or the app
      // switcher fires it, and treating those as time away would let a reload
      // land on someone who never actually left. Same rule as
      // LocationProvider.
      if (next !== 'active') return;

      const awayForMs = awayAt === null ? 0 : Date.now() - awayAt;
      awayAt = null;
      void syncUpdateOnForeground(awayForMs, isPending.current);
    });

    return () => subscription.remove();
  }, []);
}
