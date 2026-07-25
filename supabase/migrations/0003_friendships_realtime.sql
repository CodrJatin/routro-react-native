-- Live friendship updates.
--
-- The friendship list was fetched once when the app mounted and never
-- refreshed, so accepting a request on one device never reached the other:
-- the accepting user's peer kept an unchanged list, never subscribed to
-- their location channel, and could not see them on the map until they
-- manually pulled to refresh. Unfriending had a worse failure mode -- the
-- removed side kept its already-joined Realtime channel and carried on
-- receiving location until that channel happened to rejoin.
--
-- Adding the table to the realtime publication lets the client subscribe to
-- postgres_changes and reconcile immediately. The existing
-- "friendships: read own" RLS policy still governs what each user sees.

alter publication supabase_realtime add table public.friendships;

-- Without REPLICA IDENTITY FULL a DELETE only carries the primary key, so a
-- client-side filter on requester_id/addressee_id can never match one and
-- unfriend events would be silently dropped -- precisely the case that most
-- needs to propagate.
alter table public.friendships replica identity full;
