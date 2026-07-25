# MetroSync — Expo / Build / Deploy Guide

Practical reference for running, building, and shipping this app. Written so
future-you (or a collaborator) doesn't have to rediscover the gotchas we hit
while building it.

## Project facts

- Expo SDK 57, Expo Router, dev client (not Expo Go compatible — MapLibre and
  other native modules require a custom dev client / full build).
- EAS project: `jatinexpos-team/metrosync` (id `c7f6f3a8-a41e-4180-af37-8d477c7afc20`).
- Supabase project ref `wwvczkqtadcwwmmcitgr` — Postgres schema + RLS live in
  `supabase/migrations/`.
- Android package: `com.metrosync.app`.

## First-time setup (new machine / new clone)

```
npm install
cp .env.example .env        # fill in EXPO_PUBLIC_SUPABASE_URL / ANON_KEY
npm run compile-data        # builds assets/data/metro-graph.json + tracks.json from /resources
```

`assets/data/*.json` are checked into git (the app imports them directly at
build time), but they're *generated* — if you ever edit the raw files under
`/resources`, re-run `npm run compile-data` and commit the regenerated output.
Never hand-edit files in `assets/data/`.

## Local development

```
npm run android   # expo run:android -- builds native + installs + starts Metro
npm test           # vitest -- the offline pathfinding engine's test suite
npx tsc --noEmit    # type-check
```

Needs a connected device or emulator, plus `ANDROID_HOME` and a working JDK.
**Known gotcha:** on this machine, the ambient `JAVA_HOME` sometimes points at
a stale/invalid Android Studio JBR path (`ERROR: JAVA_HOME is set to an
invalid directory`). If a Gradle build fails with that error, override it
before building:

```
export JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-21.0.9.10-hotspot"
export ANDROID_HOME="C:\Users\<you>\AppData\Local\Android\Sdk"
```

**Known gotcha #2:** on first launch after install, the dev client sometimes
opens to its own "couldn't connect" error screen before Metro has finished
binding port 8081 — this is a timing race, not a bug. Wait a few seconds and
reload (shake device → Reload, or tap the localhost entry on the dev
launcher's home screen).

First build on a machine takes ~40+ minutes (NDK download + full native
compile). Subsequent builds reuse the Gradle cache and take under a minute
for JS-only changes.

## Supabase

Schema changes live as numbered SQL files in `supabase/migrations/`. Apply a
new one via the Supabase SQL Editor (paste and run), or with the CLI:

```
npx supabase db push --db-url "postgresql://postgres:<db-password>@db.wwvczkqtadcwwmmcitgr.supabase.co:5432/postgres" --include-all
```

Note: `supabase db query` chokes on multi-statement files ("cannot insert
multiple commands into a prepared statement") — always use `db push` for
migration files, not `db query -f`.

**Migration ordering matters:** both tables (`profiles`, `friendships`) must
exist before *either* one's RLS policies are created, since `profiles`' "read
friends" policy references `friendships`. `db push` runs each migration in a
transaction, so a failed migration rolls back cleanly — safe to fix and
re-run.

**Still outstanding / follow-ups documented as TODOs in the migration files:**
- `find_user_by_handle` (the add-friend-by-email/ID lookup) has no rate
  limiting — fine for now, would need a throttle before wider release.
- Google OAuth sign-in needs the Google provider enabled in Supabase's Auth
  settings (Authentication → Providers → Google), plus
  `metrosync://auth/callback` added to the allowed redirect URLs. The app-side
  code is already wired for it (`src/auth/AuthProvider.tsx`); this is a
  one-time dashboard step only you can do.

Live location never touches a table — it's Realtime Broadcast/Presence only,
authorized via RLS on `realtime.messages` (`0002_realtime_authorization.sql`).

## EAS Build (producing installable builds)

Auth: either `eas login` interactively in your own terminal, or generate a
personal access token at expo.dev/settings/access-tokens and export it:

```
export EXPO_TOKEN="<token>"
npx eas-cli@latest whoami   # confirms auth
```

Three build profiles in `eas.json`:

| Profile | Output | Use for |
|---|---|---|
| `development` | dev client | Local development (what `expo run:android` uses) |
| `preview` | installable `.apk` | **Sharing with friends** — sideload directly, no store needed |
| `production` | `.aab` | Play Store submission only — **cannot be sideloaded directly** |

To build a new version to share:

```
npx eas-cli@latest build --platform android --profile preview --non-interactive --no-wait
```

`--no-wait` returns immediately after queuing; check status with:

```
npx eas-cli@latest build:view <build-id>
```

or watch the "Logs" URL it prints. When `status` is `finished`, the
`Application Archive URL` is the direct `.apk` download link — send that (or
the downloaded file) to friends. Both `preview` and `production` have
`autoIncrement: true`, so each new build gets a fresh version code
automatically and installs as an update over the previous one — don't turn
that off, or repeat installs will fail with a version conflict.

**Signing:** EAS auto-generated and now manages the Android keystore for this
project (`preview`/`production` share it via `distribution: internal` +
remote credentials). Don't run `eas credentials` to reset/delete it — that
would break updates for anyone who already has a build installed.

**Env vars in EAS builds:** cloud builds don't see your local `.env` (it's
gitignored, so it's never uploaded). `EXPO_PUBLIC_SUPABASE_URL` /
`EXPO_PUBLIC_SUPABASE_ANON_KEY` are instead baked directly into `eas.json`'s
`preview`/`production` profiles. This is intentionally safe to commit — the
anon key is designed to be public in client apps (any decompiled APK exposes
it regardless); real access control is the RLS policies in
`supabase/migrations/`, not keeping this key secret. If you ever add a
genuinely secret key (not `EXPO_PUBLIC_*`), do **not** put it in `eas.json` —
use `eas env:create` instead, which stores it server-side.

## Should you connect Expo to GitHub?

Optional, not required for what you're doing today. The GitHub integration
(expo.dev → Project Settings → GitHub) lets EAS auto-trigger builds on push/PR
and post build-status checks back to GitHub — genuinely useful once you're
iterating fast or have collaborators pushing regularly, since it replaces the
manual `eas build` command with "push to a branch and a build appears." For a
solo project doing occasional builds to share with a few friends, it adds
setup overhead (installing the GitHub App, granting repo access) for not much
gained over just running the one `eas build` command above when you actually
have something new to share. Reasonable to skip for now and add later if the
manual step starts feeling repetitive.
