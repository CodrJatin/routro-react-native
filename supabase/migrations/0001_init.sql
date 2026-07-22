-- MetroSync initial schema: profiles + friendships, with RLS.
--
-- Run this in your Supabase project (SQL Editor, or `supabase db push` if
-- using the CLI) after creating the project. Live location is deliberately
-- NOT a table here -- it travels only over Supabase Realtime Broadcast
-- (ephemeral, in-memory fan-out), never persisted. See Phase 5.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables first (friendships references profiles, and a profiles policy below
-- references friendships -- both tables must exist before any policy on
-- either one is created).
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text,
  avatar_url text,
  public_uid text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  created_at timestamptz not null default now()
);

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_no_self_friend check (requester_id <> addressee_id)
);

-- At most one relationship row per unordered pair -- prevents both a
-- duplicate request AND a reverse-direction duplicate (B->A while A->B
-- already exists).
create unique index friendships_unique_unordered_pair
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

-- ---------------------------------------------------------------------------
-- profiles: policies, signup trigger, friend-lookup RPC
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

create policy "profiles: read own"
  on public.profiles for select
  using (auth.uid() = id);

-- A pending OR accepted friendship lets each party read the other's (already
-- limited) profile row -- pending is included so an addressee can see who's
-- requesting them (and a requester can see who they requested).
create policy "profiles: read friends"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.friendships f
      where f.status in ('pending', 'accepted')
        and (
          (f.requester_id = auth.uid() and f.addressee_id = profiles.id)
          or (f.addressee_id = auth.uid() and f.requester_id = profiles.id)
        )
    )
  );

create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-create a profile row when a new auth user signs up (email/password or
-- Google OAuth -- raw_user_meta_data is populated by whichever provider ran).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Least-privilege lookup for "add friend by email or ID": the profiles RLS
-- policies above intentionally do NOT let you read a stranger's row (only
-- your own + accepted friends), so a plain SELECT can't find someone to add.
-- This SECURITY DEFINER function exposes only the 3 fields needed to send a
-- request, for exact email/public_uid matches only (no fuzzy search of the
-- whole user base).
-- TODO: this is still an unthrottled enumeration oracle (any authenticated
-- caller can probe emails/IDs at whatever rate the client allows). Before
-- shipping past internal testing, front it with rate limiting -- e.g. a
-- Supabase Edge Function wrapper with a per-user attempt counter, or a
-- pg_cron-backed throttle table.
create function public.find_user_by_handle(handle text)
returns table (id uuid, display_name text, public_uid text)
language sql
security definer
set search_path = public
as $$
  select id, display_name, public_uid
  from public.profiles
  where email = handle or public_uid = handle
  limit 1;
$$;

revoke all on function public.find_user_by_handle(text) from public;
grant execute on function public.find_user_by_handle(text) to authenticated;

-- ---------------------------------------------------------------------------
-- friendships: updated_at trigger, policies
-- ---------------------------------------------------------------------------

create function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger friendships_touch_updated_at
  before update on public.friendships
  for each row execute function public.touch_updated_at();

alter table public.friendships enable row level security;

create policy "friendships: read own"
  on public.friendships for select
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "friendships: insert as requester"
  on public.friendships for insert
  with check (auth.uid() = requester_id);

-- Only the addressee can accept/block an incoming request.
create policy "friendships: update as addressee"
  on public.friendships for update
  using (auth.uid() = addressee_id)
  with check (auth.uid() = addressee_id);

-- Either party can delete: requester cancels a pending request, either side
-- unfriends an accepted one.
create policy "friendships: delete own"
  on public.friendships for delete
  using (auth.uid() = requester_id or auth.uid() = addressee_id);
