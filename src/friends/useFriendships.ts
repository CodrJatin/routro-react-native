import { useCallback, useEffect, useState } from 'react';
import type { Profile } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';

export type FriendshipStatus = 'pending' | 'accepted' | 'blocked';

export interface FriendshipRow {
  id: string;
  status: FriendshipStatus;
  requester_id: string;
  addressee_id: string;
  created_at: string;
  requester: Profile;
  addressee: Profile;
}

export function otherParty(row: FriendshipRow, selfUserId: string): Profile {
  return row.requester_id === selfUserId ? row.addressee : row.requester;
}

export function useFriendships(selfUserId: string | undefined) {
  const [rows, setRows] = useState<FriendshipRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!selfUserId) {
      setRows([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data } = await supabase
      .from('friendships')
      .select(
        '*, requester:profiles!friendships_requester_id_fkey(*), addressee:profiles!friendships_addressee_id_fkey(*)',
      )
      .or(`requester_id.eq.${selfUserId},addressee_id.eq.${selfUserId}`)
      .order('created_at', { ascending: false });
    setRows((data as FriendshipRow[] | null) ?? []);
    setIsLoading(false);
  }, [selfUserId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function sendRequest(handle: string): Promise<{ error: string | null }> {
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
      const message = insertError.code === '23505' ? 'A friendship or request already exists.' : insertError.message;
      return { error: message };
    }

    await refetch();
    return { error: null };
  }

  async function acceptRequest(friendshipId: string) {
    await supabase.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId);
    await refetch();
  }

  async function removeFriendship(friendshipId: string) {
    await supabase.from('friendships').delete().eq('id', friendshipId);
    await refetch();
  }

  return { rows, isLoading, refetch, sendRequest, acceptRequest, removeFriendship };
}
