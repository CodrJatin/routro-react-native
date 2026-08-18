import type { RealtimeChannel } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { Profile } from '../auth/AuthProvider';
// MOCK FRIEND -- temporary dev fixture, delete with src/dev/mockFriend.ts
import { useMockFriendRows } from '../dev/mockFriend';
import { supabase } from '../lib/supabase';
import { rejoinDelayFor } from '../realtime/rejoinBackoff';

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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// public_uid is generated (see 0001_init.sql) as the first 8 hex characters
// of a UUID, always lowercase -- so a valid ID is exactly 8 hex chars.
const PUBLIC_UID_PATTERN = /^[0-9a-f]{8}$/;

/** The fields find_user_by_handle is allowed to expose about a stranger --
 * enough to send a request and to show who it's going to, nothing more. */
export interface HandleTarget {
  id: string;
  display_name: string | null;
  public_uid: string;
  avatar_url: string | null;
}

/** Resolves an email or 8-char public ID to that minimal profile.
 *
 * Standalone rather than a method on the hook because the invite-link screen
 * lives outside the tab group, and so outside FriendshipsProvider -- it needs
 * the same lookup without a friendship list behind it. */
export async function lookupUserByHandle(
  handle: string,
): Promise<{ target: HandleTarget | null; error: string | null }> {
  // Lowercased before anything else: emails and public_uids are both stored
  // lowercase in the DB and the RPC does an exact (non-fuzzy) match, so a
  // single capital letter -- the mobile keyboard's default for the first
  // character -- used to make a real match look like "no user found".
  const normalized = handle.trim().toLowerCase();
  if (!normalized) return { target: null, error: 'Enter an email or ID.' };

  const looksLikeEmail = normalized.includes('@');
  const isValid = looksLikeEmail ? EMAIL_PATTERN.test(normalized) : PUBLIC_UID_PATTERN.test(normalized);
  if (!isValid) {
    return {
      target: null,
      error: looksLikeEmail
        ? 'Enter a valid email address.'
        : 'Enter a valid 8-character ID (letters a-f and numbers 0-9).',
    };
  }

  const { data, error } = await supabase.rpc('find_user_by_handle', { handle: normalized });
  if (error) return { target: null, error: error.message };

  const target = (data as HandleTarget[] | null)?.[0] ?? null;
  if (!target) return { target: null, error: 'No user found with that email or ID.' };
  return { target, error: null };
}

export interface ExistingFriendship {
  status: FriendshipStatus;
  direction: 'incoming' | 'outgoing';
}

/** Looks up any existing row between the two users, in either direction.
 *
 * The invite screen calls this alongside the handle lookup so it can show
 * "already friends" / "request already sent" instead of a Send button that
 * would just fail on the DB's unique constraint -- including when the same
 * invite link is opened again (a real re-tap, or the OS replaying a deep
 * link on process restore) after the request already went out. */
export async function getExistingFriendship(
  selfUserId: string,
  targetUserId: string,
): Promise<{ friendship: ExistingFriendship | null; error: string | null }> {
  const { data, error } = await supabase
    .from('friendships')
    .select('status, requester_id')
    .or(
      `and(requester_id.eq.${selfUserId},addressee_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},addressee_id.eq.${selfUserId})`,
    )
    .maybeSingle();

  if (error) return { friendship: null, error: error.message };
  if (!data) return { friendship: null, error: null };

  return {
    friendship: {
      status: data.status,
      direction: data.requester_id === selfUserId ? 'outgoing' : 'incoming',
    },
    error: null,
  };
}

/** Inserts the pending row. Split from the lookup so the invite screen can name
 * who it is about to add and wait for a tap, rather than committing a request
 * as a side effect of opening a link. */
export async function createFriendRequest(
  selfUserId: string,
  targetUserId: string,
): Promise<MutationResult> {
  if (targetUserId === selfUserId) return { error: "You can't add yourself." };

  const { error } = await supabase
    .from('friendships')
    .insert({ requester_id: selfUserId, addressee_id: targetUserId });
  if (error) {
    return {
      error: error.code === '23505' ? 'A friendship or request already exists.' : error.message,
    };
  }
  return { error: null };
}

export function useFriendships(selfUserId: string | undefined) {
  const [rows, setRows] = useState<FriendshipRow[]>([]);
  /** True only for the very first load. Kept separate from `isRefreshing` so
   * a background reconcile doesn't blank the list the user is looking at. */
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnce = useRef(false);
  /**
   * Ticket for the most recently *started* fetch.
   *
   * This hook refetches from more places than it looks: two realtime bindings,
   * every mutation, a rejoin, and now the return to foreground -- several of
   * which fire together. Accepting a request, for instance, updates the row
   * and then refetches, while the postgres_changes event for that same update
   * arrives and refetches again. Two queries are then in flight over a list
   * that has just changed, and nothing ordered the responses: the slower one
   * wins by landing last, whichever it is. Losing that race writes the list as
   * it was *before* the change the user just made, and it stays that way until
   * something else happens to refetch.
   *
   * A monotonic ticket is enough to fix it because these are whole-list reads.
   * There is no merging to do -- the newest response is simply the truth, and
   * every older one is noise, however recently it was asked for.
   */
  const latestRequest = useRef(0);

  const refetch = useCallback(async () => {
    const requestId = ++latestRequest.current;

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

    // Overtaken while this was in flight. Everything below is skipped, not
    // just the rows: publishing this response's error would report a failure
    // the newer request may be about to disprove, and clearing the spinner
    // would end it while the request it belongs to is still running. A stale
    // answer is stale in all of its fields.
    //
    // The newer request is what clears these -- it always resolves, on the
    // error path as well as the success one, so nothing is left hanging.
    if (requestId !== latestRequest.current) return;

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
    // Invalidates anything still in flight. Without this a response for the
    // previous user could land on the next one: `selfUserId` changing rebuilds
    // `refetch`, but the old query is already out and holds a ticket that is
    // still the newest until the replacement fetch starts.
    return () => {
      latestRequest.current += 1;
    };
  }, [refetch]);

  /** Keeps the list live. Without this the rows were fetched once on mount:
   * accepting a request never reached the other device (so they never
   * subscribed to the new friend's location channel), and an unfriended peer
   * kept receiving location until their Realtime channel happened to rejoin.
   *
   * Two bindings rather than one because PostgREST filters can't express
   * OR -- a row is relevant if we're on either side of it. DELETE events
   * only carry filterable columns because 0003 sets REPLICA IDENTITY FULL.
   *
   * A failed join is repaired rather than merely logged, on the same ladder as
   * the location and meet channels. This one is worth repairing for a reason
   * the others aren't: it is the channel that decides *who* the other two
   * subscribe to. Left dead, the friends list silently stops being live, and
   * every downstream consequence -- a newly accepted friend who never appears
   * on the map, an unfriended one who never goes away -- reads as a bug
   * somewhere else entirely. */
  useEffect(() => {
    if (!selfUserId) return;

    let isCancelled = false;
    let channel: RealtimeChannel | null = null;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const join = () => {
      channel = supabase
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
          if (status === 'SUBSCRIBED') {
            attempt = 0;
            return;
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn(`[friends] friendship sync channel failed to join: ${status}`);
            scheduleRejoin();
          }
        });
    };

    const scheduleRejoin = () => {
      // realtime-js emits several failures per drop; only the first may
      // advance the ramp.
      if (isCancelled || retryTimer !== null) return;
      const delay = rejoinDelayFor(++attempt);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (isCancelled) return;
        const previous = channel;
        channel = null;
        if (previous) void supabase.removeChannel(previous);
        // Before rejoining, not after: postgres_changes has no replay, so
        // anything that happened while this was down is simply not coming.
        // The rejoined channel only promises to deliver what happens next.
        void refetch();
        join();
      }, delay);
    };

    join();

    return () => {
      isCancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [selfUserId, refetch]);

  /**
   * Re-reads the list on the way back into the app.
   *
   * Backgrounding stops every JS timer, which takes supabase-js's socket
   * keepalive with it; the server drops the connection, and postgres_changes
   * has no replay to catch up with. So a request accepted, or a friendship
   * ended, while the app was away arrives nowhere -- and unlike a momentary
   * drop, nothing reports an error, because from this side the channel simply
   * went quiet. `locationChannelManager.ensureConnected` repairs the transport
   * on foreground for exactly the same reason; this repairs the data.
   *
   * One query, only on a real return to the app -- 'inactive' is deliberately
   * not treated as a departure, matching LocationProvider.
   */
  useEffect(() => {
    if (!selfUserId) return;
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') void refetch();
    });
    return () => subscription.remove();
  }, [selfUserId, refetch]);

  async function sendRequest(handle: string): Promise<MutationResult> {
    if (!selfUserId) return { error: 'Not signed in.' };

    const { target, error: lookupError } = await lookupUserByHandle(handle);
    if (!target) return { error: lookupError ?? 'No user found with that email or ID.' };

    const result = await createFriendRequest(selfUserId, target.id);
    if (result.error) return result;

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

  // MOCK FRIEND -- temporary dev fixture. Returns [] outside __DEV__ and
  // whenever the panel is off, so this is a no-op in every real build.
  // Delete this line and the spread below with src/dev/mockFriend.ts.
  const mockRows = useMockFriendRows(selfUserId);

  return {
    rows: mockRows.length > 0 ? [...mockRows, ...rows] : rows,
    isLoading,
    isRefreshing,
    error,
    refetch,
    sendRequest,
    acceptRequest,
    removeFriendship,
  };
}
