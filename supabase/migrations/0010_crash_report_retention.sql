-- Retention for crash_reports, which 0009 deliberately left as a TODO.
--
-- Two limits, not one, because they answer different problems.
--
-- Age is the honest one: a crash report is only useful while the build that
-- produced it is still current, and one from last spring is not evidence, it
-- is just a record of something a person's phone did. Keeping it past the
-- point of usefulness is the whole of the cost and none of the benefit.
--
-- A per-user ceiling is the other, and it is the answer to the note at the
-- bottom of 0009. That file argued against rate-limiting inserts because the
-- exposure is storage rather than disclosure -- which is true, and this is what
-- makes it true: however many reports a modified client writes, only the newest
-- handful survive the next purge. A legitimate client writes at most one per
-- launch, so it will never come close.

-- ---------------------------------------------------------------------------
-- The purge
-- ---------------------------------------------------------------------------

create function public.purge_old_crash_reports()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Long enough to still be looking into something reported a season ago,
  -- short enough that nothing accumulates indefinitely.
  retention constant interval := interval '90 days';
  -- Far more than a real user produces (one per launch, and only when
  -- something actually broke), and a hard ceiling on what a modified one can.
  max_per_user constant integer := 50;
  removed integer;
begin
  with doomed as (
    select id
    from (
      select
        id,
        created_at,
        row_number() over (partition by user_id order by created_at desc) as recency
      from public.crash_reports
    ) ranked
    where ranked.created_at < now() - retention
       or ranked.recency > max_per_user
  )
  delete from public.crash_reports r
  using doomed
  where r.id = doomed.id;

  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- Not executable by users. It runs as the job's owner, which on Supabase is
-- `postgres`, and there is no reason for anyone else to be able to trigger a
-- bulk delete -- SECURITY DEFINER here is about the job being able to see past
-- RLS, not about widening who may call it.
revoke all on function public.purge_old_crash_reports() from public;

-- ---------------------------------------------------------------------------
-- The schedule
-- ---------------------------------------------------------------------------

-- Requires pg_cron, which Supabase ships but does not enable by default. This
-- statement enables it; the Dashboard's Database > Extensions page does the
-- same thing if this migration is applied by a role that may not create
-- extensions. It creates its own `cron` schema, and its worker runs jobs in the
-- `postgres` database.
create extension if not exists pg_cron;

-- Cleared first rather than trusting a re-schedule to replace by name: pg_cron
-- does upsert on the job name in practice, but its own documentation does not
-- say so, and a duplicated purge job would be a second delete racing the first
-- every night. `unschedule` raises rather than returning false when there is no
-- such job, which is the normal case the first time this runs -- hence the
-- block rather than a bare call.
do $$
begin
  perform cron.unschedule('purge-old-crash-reports');
exception
  when others then null;
end;
$$;

-- 21:23 UTC is a few minutes before 03:00 in Delhi, which is the quietest the
-- app ever is -- the metro does not run and nobody is mid-journey. The odd
-- minute is deliberate too: scheduling on the hour is how every job on a
-- shared host ends up starting at once.
select cron.schedule(
  'purge-old-crash-reports',
  '23 21 * * *',
  $$select public.purge_old_crash_reports();$$
);
