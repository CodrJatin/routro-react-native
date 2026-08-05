import { useFriendStatuses } from '../realtime/locationStore';
import { useFriendshipsContext } from './FriendshipsProvider';
import { otherParty } from './useFriendships';

/** Count of friends currently live or stale -- the same "Active" definition
 * the Friends tab's Active section uses (see friends.tsx), kept in one place
 * so the tab bar indicator and the list can never disagree about who counts. */
export function useActiveFriendCount(selfUserId: string | undefined): number {
  const { rows } = useFriendshipsContext();
  const statuses = useFriendStatuses();

  if (!selfUserId) return 0;

  let count = 0;
  for (const row of rows) {
    if (row.status !== 'accepted') continue;
    const status = statuses[otherParty(row, selfUserId).id] ?? 'offline';
    if (status === 'live' || status === 'stale') count++;
  }
  return count;
}
