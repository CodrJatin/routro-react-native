-- Rate-limit find_user_by_handle, closing the enumeration oracle 0001 left open.
--
-- The function is SECURITY DEFINER on purpose: profiles RLS deliberately does
-- not let you read a stranger's row, so adding a friend by email or ID needs a
-- way past it. What it did not have was a ceiling. Any authenticated caller
-- could ask it about an arbitrary email as fast as the network allowed, and a
-- hit tells them that address has a Routro account and hands back the display
-- name and avatar attached to it. A list of email addresses plus a loop is a
-- membership oracle over the whole user base.
--
-- Note what a limit here can and cannot do. It does not make the lookup
-- private -- anyone who knows an address can still test it, which is inherent
-- in "add a friend by email" and is the feature working as intended. It makes
-- the difference between testing one address and testing a million, which is
-- the difference that actually matters.

-- ---------------------------------------------------------------------------
-- The counter
-- ---------------------------------------------------------------------------

-- A fixed window rather than a sliding log: one row per user, reset when the
-- window rolls over. A sliding window would be more precise about the edges
-- and would mean storing every attempt, which is a table of "who looked up
-- how often" growing forever -- more retained data about people's behaviour
-- than the thing it is protecting.
create table public.handle_lookup_quota (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0
);

-- Enabled with no policies at all, deliberately. Nothing but the SECURITY
-- DEFINER function below has any business reading or writing this, and that
-- function bypasses RLS by definition. A user seeing their own counter would
-- only tell them how close they are to the limit.
alter table public.handle_lookup_quota enable row level security;

-- ---------------------------------------------------------------------------
-- The function
-- ---------------------------------------------------------------------------

drop function public.find_user_by_handle(text);

create function public.find_user_by_handle(handle text)
returns table (id uuid, display_name text, public_uid text, avatar_url text)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Generous for a human and useless for a crawler. Adding a friend by hand is
  -- a rare act -- most arrive through invite links, which do not come through
  -- here at all -- so anyone reaching this ceiling is not adding friends.
  max_attempts constant integer := 20;
  window_length constant interval := interval '1 hour';
  caller uuid := (select auth.uid());
  used integer;
begin
  -- Only ever reachable by an authenticated caller (see the grant below), but
  -- an unattributable call must not be allowed to skip the counter.
  if caller is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  insert into public.handle_lookup_quota as q (user_id, window_started_at, attempts)
  values (caller, now(), 1)
  on conflict (user_id) do update
    set
      -- Window rolled over: start a fresh one rather than accumulating.
      window_started_at = case
        when now() - q.window_started_at >= window_length then now()
        else q.window_started_at
      end,
      attempts = case
        when now() - q.window_started_at >= window_length then 1
        else q.attempts + 1
      end
  returning q.attempts into used;

  -- Worth being exact about what happens past the limit, because the obvious
  -- reading is wrong. The increment above and the raise below are in one
  -- transaction, so a refused attempt rolls its own increment back: the
  -- counter parks at max_attempts rather than climbing. Hammering the endpoint
  -- therefore neither extends the wait nor shortens it.
  --
  -- That is the right outcome, and it is worth saying why rather than leaving
  -- it to look like an oversight. The window is anchored to the *first*
  -- attempt in it and that anchor rolls back too, so a caller cannot hold the
  -- window open by trying constantly, and cannot reset it either. The cap is
  -- what does the work; the counter past it would only be bookkeeping.
  if used > max_attempts then
    raise exception 'Too many lookups. Wait a little while and try again.'
      using errcode = 'P0001';
  end if;

  return query
    select p.id, p.display_name, p.public_uid, p.avatar_url
    from public.profiles p
    where p.email = handle or p.public_uid = handle
    limit 1;
end;
$$;

revoke all on function public.find_user_by_handle(text) from public;
grant execute on function public.find_user_by_handle(text) to authenticated;
