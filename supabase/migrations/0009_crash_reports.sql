-- Crash reports, kept in this project's own database rather than sent to a
-- third party.
--
-- The diagnostics ring added alongside this (src/diagnostics/logBuffer.ts) only
-- helps when the user thinks to open Settings and copy it, which is exactly
-- what someone whose app just died is least likely to do. This is the other
-- half: the crash is written to disk as it happens and uploaded on the next
-- launch, so an unattended failure is still recorded.
--
-- Everything stored here has already been through the client's redaction (see
-- `redact` in logBuffer.ts) -- bearer tokens removed, user ids shortened to
-- eight characters -- so a report about a crash while talking to a friend does
-- not carry that friend's identifier.
--
-- What this deliberately does NOT cover: native crashes. A process killed by
-- the OS never runs the JS that would record it. Catching those needs a native
-- crash handler, which is the thing a third-party SDK is actually for.

create table public.crash_reports (
  id uuid primary key default gen_random_uuid(),
  -- Cascades from profiles, which cascades from auth.users: deleting an
  -- account takes its crash reports with it, with no separate cleanup to
  -- remember. The reports are about the app, but they are the user's data.
  user_id uuid not null references public.profiles (id) on delete cascade,
  /** When the row landed. */
  created_at timestamptz not null default now(),
  /** When the crash actually happened -- earlier than `created_at` by however
   * long the app stayed shut, which is itself worth knowing. From the client's
   * clock, so it is only ever read as approximate. */
  occurred_at timestamptz not null,
  /** False for a render error the boundary caught and offered a retry for;
   * true for one that took the process down. Both are worth having and they
   * are very different bugs. */
  is_fatal boolean not null default false,
  message text not null,
  /** The recent warnings and errors leading up to it. Nullable: a crash during
   * start-up may genuinely have nothing before it. */
  logs text,
  app_version text,
  runtime_version text,
  update_id text,
  platform text,

  -- Size caps, because this is a table authenticated users write into
  -- directly. The client sends a bounded ring and a single message, so a
  -- legitimate report is nowhere near these -- they exist so a modified client
  -- cannot use the table as free storage.
  constraint crash_reports_message_length check (char_length(message) <= 2000),
  constraint crash_reports_logs_length check (logs is null or char_length(logs) <= 40000)
);

-- The only access pattern: this user's reports, newest first.
create index crash_reports_user_created_idx
  on public.crash_reports (user_id, created_at desc);

alter table public.crash_reports enable row level security;

-- Insert is the point of the table, and only ever for yourself. `(select
-- auth.uid())` for the InitPlan reason given in 0007.
create policy "crash_reports: insert own"
  on public.crash_reports for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- Readable by the person it is about. They cannot do anything actionable with
-- it, but a store of automatically-uploaded reports that its subject cannot
-- inspect is not something this app should have.
create policy "crash_reports: read own"
  on public.crash_reports for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- And retractable, for the same reason.
create policy "crash_reports: delete own"
  on public.crash_reports for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Deliberately no update policy: a report is a record of a moment, and there
-- is nothing about it that should later be edited.

-- TODO: retention. Nothing here expires, and crash reports are only useful
-- while the build that produced them is still current. A pg_cron job deleting
-- rows older than, say, 90 days is the obvious follow-up -- left out here
-- because scheduling belongs to the project's configuration rather than its
-- schema.
--
-- Note also what is deliberately not rate-limited, unlike the handle lookup in
-- 0008. That one was throttled because it read *other people's* data; this
-- only ever writes a row about the caller, into the caller's own rows, under
-- the size caps above. The exposure is storage, not disclosure, and the
-- retention job above is the proportionate answer to it.
