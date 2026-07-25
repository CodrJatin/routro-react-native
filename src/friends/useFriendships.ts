import { useCallback, useEffect, useRef, useState } from 'react';
import type { Profile } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';

export type FriendshipStatus = 'pending' | 'accepted';

export interface FriendshipRow {
  id: string;
  status: FriendshipStatus;
  requester_id: string;
  addressee_id: string;
  created_at: string;
  requester: Profile;
  addressee: Profile;
}

export interface MutationResult {
  error: string | null;
}

export function otherParty(row: FriendshipRow, selfUserId: string): Profile {
  return row.requester_id === selfUserId ? row.addressee : row.requester;
}

export function useFriendships(selfUserId: string | undefined) {
  const [rows, setRows] = useState<FriendshipRow[]>([]);
  /** True only for the very first load. Kept separate from `isRefreshing` so
   * a background reconcile doesn't blank the list the user is looking at. */
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnce = useRef(false);

  const refetch = useCallback(async () => {
    if (!selfUserId) {
      setRows([]);
      setIsLoading(false);
      hasLoadedOnce.current = false;
      return;
    }
    if (hasLoadedOnce.current) setIsRefreshing(true);

    const { data, error: fetchError } = await supabase
      .from('friendships')
      .select(
        '*, requester:profiles!friendships_requester_id_fkey(*), addressee:profiles!friendships_addressee_id_fkey(*)',
      )
      .or(`requester_id.eq.${selfUserId},addressee_id.eq.${selfUserId}`)
      .order('created_at', { ascending: false });

    if (fetchError) {
      // Keep whatever rows we already had -- a failed refresh shouldn't
      // erase a list that was correct a moment ago.
      setError(fetchError.message);
    } else {
      setRows((data as FriendshipRow[] | null) ?? []);
      setError(null);
    }

    hasLoadedOnce.current = true;
    setIsLoading(false);
    setIsRefreshing(false);
  }, [selfUserId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  /** Keeps the list live. Without this the rows were fetched once on mount:
   * accepting a request never reached the other device (so they never
   * subscribed to the new friend's location channel), and an unfriended peer
   * kept receiving location until their Realtime channel happened to rejoin.
   *
   * Two bindings rather than one because PostgREST filters can't express
   * OR -- a row is relevant if we're on either side of it. DELETE events
   * only carry filterable columns because 0003 sets REPLICA IDENTITY FULL. */
  useEffect(() => {
    if (!selfUserId) return;

    const channel = supabase
      .channel(`friendships:${selfUserId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'friendships',
          filter: `requester_id=eq.${selfUserId}`,
        },
        () => void refetch(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'friendships',
          filter: `addressee_id=eq.${selfUserId}`,
        },
        () => void refetch(),
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`[friends] friendship sync channel failed to join: ${status}`);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selfUserId, refetch]);

  async function sendRequest(handle: string): Promise<MutationResult> {
    if (!selfUserId) return { error: 'Not signed in.' };

    const { data: found, error: lookupError } = await supabase.rpc('find_user_by_handle', {
      handle: handle.trim(),
    });
    if (lookupError) return { error: lookupError.message };

    const target = (found as { id: string }[] | null)?.[0];
    if (!target) return { error: 'No user found with that email or ID.' };
    if (target.id === selfUserId) return { error: "You can't add yourself." };

    const { error: insertError } = await supabase
      .from('friendships')
      .insert({ requester_id: selfUserId, addressee_id: target.id });
    if (insertError) {
      const message =
        insertError.code === '23505' ? 'A friendship or request already exists.' : insertError.message;
      return { error: message };
    }

    await refetch();
    return { error: null };
  }

  /** Returns the error rather than swallowing it -- a failed accept used to
   * be indistinguishable from a successful one, since the row simply
   * reappeared unchanged after the refetch. */
  async function acceptRequest(friendshipId: string): Promise<MutationResult> {
    const { error: updateError } = await supabase
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('id', friendshipId);
    await refetch();
    return { error: updateError?.message ?? null };
  }

  async function removeFriendship(friendshipId: string): Promise<MutationResult> {
    const { error: deleteError } = await supabase
      .from('friendships')
      .delete()
      .eq('id', friendshipId);
    await refetch();
    return { error: deleteError?.message ?? null };
  }

  return {
    rows,
    isLoading,
    isRefreshing,
    error,
    refetch,
    sendRequest,
    acceptRequest,
    removeFriendship,
  };
}
