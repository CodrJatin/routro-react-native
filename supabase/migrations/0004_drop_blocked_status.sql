-- Remove the unused 'blocked' friendship status.
--
-- The status was accepted by the CHECK constraint and present in the client
-- type union, but no UI ever set it and no query treated it differently
-- from any other non-accepted row -- a blocked user was simply filtered out
-- of the accepted list, so the block carried no meaning anywhere. Leaving a
-- settable-but-meaningless value in the schema invites it being written
-- out-of-band and silently doing nothing.
--
-- Unfriending (delete) remains the escape hatch, and it does revoke location
-- access for real: the RLS policy on realtime.messages requires an
-- 'accepted' row to exist.

-- Defensive: nothing should be able to have written this, but a constraint
-- swap fails on any row that violates the new form.
update public.friendships set status = 'pending' where status = 'blocked';

alter table public.friendships drop constraint friendships_status_check;

alter table public.friendships
  add constraint friendships_status_check check (status in ('pending', 'accepted'));
