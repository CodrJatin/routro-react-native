-- Make the friendship lookups that every policy depends on cheap.
--
-- Two changes, both about the same table, and the second is worth much more
-- once the first has landed.
--
-- 1. friendships had no index that could serve a lookup by either party.
--    It had two, and neither helps: the primary key is on `id`, and the
--    unique index is on (least(requester_id, addressee_id), greatest(...)),
--    which enforces the one-row-per-pair rule and cannot answer
--    "requester_id = X" at all -- an expression index is only usable for that
--    same expression. So every read of the table was a sequential scan.
--
--    That is not merely the friends list being slow. The table is the
--    authorization backstop for the whole app: "profiles: read friends"
--    consults it per profile row, and -- the expensive one -- the
--    realtime.messages policies in 0002 and 0006 consult it on every channel
--    join, which is every location topic and every meet topic, on every
--    reconnect. A metro ride is a great many reconnects.
--
-- 2. auth.uid() and realtime.topic() were being re-evaluated per row inside
--    those same policy subqueries. Wrapping a function call in a scalar
--    subquery makes Postgres hoist it to an InitPlan, evaluated once per
--    statement instead of once per candidate row. This is Supabase's own
--    documented RLS advice and it compounds with the indexes above: the
--    InitPlan produces a parameter, and a parameter is what an index scan
--    needs on the other side of the equality.
--
-- Nothing here changes who can see what. Every policy below is the same
-- predicate it was, re-expressed.

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Composite rather than plain columns, because status is in the predicate
-- everywhere it matters -- both realtime policies filter on 'accepted', and
-- "profiles: read friends" on ('pending', 'accepted'). The leading column is
-- what makes these usable by the friends list too, which filters on neither:
-- an index on (requester_id, status) serves a bare requester_id lookup exactly
-- as well as one on (requester_id) alone.
--
-- Two of them, not one, because a row is relevant if the user is on *either*
-- side of it -- the same reason the client needs two realtime bindings (see
-- 0003). The OR across both columns is served by a bitmap OR of the two.
create index if not exists friendships_requester_status_idx
  on public.friendships (requester_id, status);

create index if not exists friendships_addressee_status_idx
  on public.friendships (addressee_id, status);

-- ---------------------------------------------------------------------------
-- profiles policies (from 0001)
-- ---------------------------------------------------------------------------

drop policy "profiles: read own" on public.profiles;

create policy "profiles: read own"
  on public.profiles for select
  using ((select auth.uid()) = id);

-- The one with the most to gain, because it is the only nested case: the
-- subquery runs once per profile row being considered, and each of those runs
-- re-evaluated auth.uid() twice per row of a sequential scan of friendships.
drop policy "profiles: read friends" on public.profiles;

create policy "profiles: read friends"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.friendships f
      where f.status in ('pending', 'accepted')
        and (
          (f.requester_id = (select auth.uid()) and f.addressee_id = profiles.id)
          or (f.addressee_id = (select auth.uid()) and f.requester_id = profiles.id)
        )
    )
  );

drop policy "profiles: update own" on public.profiles;

create policy "profiles: update own"
  on public.profiles for update
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ---------------------------------------------------------------------------
-- friendships policies (from 0001)
-- ---------------------------------------------------------------------------

drop policy "friendships: read own" on public.friendships;

create policy "friendships: read own"
  on public.friendships for select
  using ((select auth.uid()) = requester_id or (select auth.uid()) = addressee_id);

drop policy "friendships: insert as requester" on public.friendships;

create policy "friendships: insert as requester"
  on public.friendships for insert
  with check ((select auth.uid()) = requester_id);

drop policy "friendships: update as addressee" on public.friendships;

create policy "friendships: update as addressee"
  on public.friendships for update
  using ((select auth.uid()) = addressee_id)
  with check ((select auth.uid()) = addressee_id);

drop policy "friendships: delete own" on public.friendships;

create policy "friendships: delete own"
  on public.friendships for delete
  using ((select auth.uid()) = requester_id or (select auth.uid()) = addressee_id);

-- ---------------------------------------------------------------------------
-- Realtime authorization for location channels (from 0002)
-- ---------------------------------------------------------------------------

-- realtime.topic() is wrapped for the same reason as auth.uid(): inside the
-- exists() below it was being re-read per candidate row, and it does not vary
-- within a statement any more than the caller's identity does.
--
-- The topic comparisons stay as string concatenations, deliberately. They
-- cannot use an index in that form, but they no longer need to: the
-- requester_id/addressee_id equality on the same row now seeks straight to
-- the handful of rows belonging to this user, and the string test only has to
-- filter those. Extracting a uuid out of the topic to make it a two-column
-- seek would trade that for a cast that throws on a malformed topic.
drop policy "realtime: read own or accepted friend's location channel" on realtime.messages;

create policy "realtime: read own or accepted friend's location channel"
  on realtime.messages for select
  to authenticated
  using (
    (select realtime.topic()) like 'user-location:%'
    and (
      (select realtime.topic()) = 'user-location:' || (select auth.uid())::text
      or exists (
        select 1
        from public.friendships f
        where f.status = 'accepted'
          and (
            (f.requester_id = (select auth.uid())
              and 'user-location:' || f.addressee_id::text = (select realtime.topic()))
            or (f.addressee_id = (select auth.uid())
              and 'user-location:' || f.requester_id::text = (select realtime.topic()))
          )
      )
    )
  );

drop policy "realtime: broadcast only to own location channel" on realtime.messages;

create policy "realtime: broadcast only to own location channel"
  on realtime.messages for insert
  to authenticated
  with check (
    (select realtime.topic()) = 'user-location:' || (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- Realtime authorization for meet channels (from 0006)
-- ---------------------------------------------------------------------------

drop policy "realtime: read meet channel shared with an accepted friend" on realtime.messages;

create policy "realtime: read meet channel shared with an accepted friend"
  on realtime.messages for select
  to authenticated
  using (
    (select realtime.topic()) like 'meet:%'
    and exists (
      select 1
      from public.friendships f
      where f.status = 'accepted'
        and (f.requester_id = (select auth.uid()) or f.addressee_id = (select auth.uid()))
        and (select realtime.topic()) in (
          'meet:' || f.requester_id::text || ':' || f.addressee_id::text,
          'meet:' || f.addressee_id::text || ':' || f.requester_id::text
        )
    )
  );

drop policy "realtime: publish to meet channel shared with an accepted friend" on realtime.messages;

create policy "realtime: publish to meet channel shared with an accepted friend"
  on realtime.messages for insert
  to authenticated
  with check (
    (select realtime.topic()) like 'meet:%'
    and exists (
      select 1
      from public.friendships f
      where f.status = 'accepted'
        and (f.requester_id = (select auth.uid()) or f.addressee_id = (select auth.uid()))
        and (select realtime.topic()) in (
          'meet:' || f.requester_id::text || ':' || f.addressee_id::text,
          'meet:' || f.addressee_id::text || ':' || f.requester_id::text
        )
    )
  );
