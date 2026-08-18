import { useEffect } from 'react';
import { showDialog } from '../dialog/dialogStore';
import { useJourneyStore } from './journeyStore';

/**
 * Reports a journey that ended for a reason the user didn't choose -- GPS
 * switched off, a four-hour session timing out, the service being killed.
 *
 * Renders nothing, and lives in the tabs layout rather than on a screen: a
 * journey can end while the user is on any tab, or on none of them, and
 * silently dropping the notification is the failure mode this exists to
 * prevent. The user would otherwise find out by noticing an absence.
 */
export function JourneyNotice() {
  const endedNotice = useJourneyStore((state) => state.endedNotice);

  useEffect(() => {
    if (!endedNotice) return;
    void showDialog({ title: 'Journey stopped', message: endedNotice, tone: 'danger' });
    useJourneyStore.getState().setEndedNotice(null);
  }, [endedNotice]);

  return null;
}
