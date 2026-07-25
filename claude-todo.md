# MetroSync — Audit Backlog

Findings from a full-codebase audit (typecheck clean, 22/22 engine tests passing at
time of writing). Ordered by severity. Each item carries the exact problem, the
intended fix, and a ready-to-use commit message.

Commit messages below use conventional-commit format (`fix(scope): …`) because it
makes this list self-documenting. The repo's existing history is looser
(`add logo`, `google Oauth support`) — adapt if you'd rather stay consistent with that.

**Suggested order of attack:** L1–L5 are one coherent pass over the same two files
and should land together. L6 and B1 are independent one-sitting fixes. Everything
else can be picked off individually.

---

## Checklist

**P0 — live location correctness & privacy**
- [x] L1 — Broadcasting silently dies after backgrounding (iOS) [done: dc94b7d]
- [x] L2 — Broadcast can start while app is backgrounded; watcher leak [done: dc94b7d]
- [x] L3 — Reconnect downgrades an active broadcaster to "online" [done: dc94b7d]
- [x] L4 — Stale friend pins never leave the map [done: dc94b7d]
- [x] L5 — Staleness computed against the sender's device clock [done: dc94b7d]
- [x] L6 — Friendship list never updates; new friends don't go live [done: c5b62ff]

**P1 — high**
- [x] L7 — Broadcasts fall back to per-fix HTTP POSTs when channel isn't joined [done: dc94b7d]
- [x] L8 — No error handling anywhere in the realtime pipeline [done: dc94b7d]
- [x] M1 — MapLibre runs a second GPS watcher that is never stopped [done: fe7b2a9]
- [x] M2 — Camera hijack on every location tick; `focusUserId` is dead code [done: fe7b2a9]
- [x] L9 — Unvalidated broadcast payload reaches the native GeoJSON layer [done: dc94b7d]
- [x] B1 — `npm run compile-data` is broken (reads `data/`, files live in `resources/`) — done in `aae8be3`

**P2 — medium**
- [x] A1 — Auth session stored unencrypted despite SecureStore being installed [done: 15ef405]
- [x] A2 — Session race in AuthProvider; profile refetched on every token refresh [done: 15ef405]
- [x] F1 — Errors swallowed throughout the friendships layer [done: c5b62ff]
- [x] M3 — "Center on me" fails silently; permission prompt fired blind on mount [done: fe7b2a9]
- [~] S1 — RLS: sending a request reveals the target's profile without consent — **skipped by decision**: keeps outgoing requests showing the target's name; the one-way profile read remains
- [x] S2 — `blocked` friendship status is schema-only [done: e4a895d]

**Improvements**
- [x] I1 — Friend pins are anonymous, identical green dots [done: a5ef1fb]
- [x] I2 — Pins teleport every 5s; `heading` is captured but unused [done: c4a0102]
- [x] I3 — Three components define "is this friend live?" independently [done: dc94b7d]
- [x] I4 — No path from the Friends tab to the map [done: e4a895d]
- [x] I5 — "Current line" attribution is a coin flip at interchanges [done: 75899b8]
- [x] I6 — Show distance / ETA between you and a friend [done: 75899b8]
- [x] I7 — `findNearestStation` is a linear scan per friend per tick [done: 1071821]
- [x] I8 — No connection-state indicator [done: 8bb35b4]

**Minor / code health**
- [x] C1 — `useFonts` error is ignored; app renders blank forever on failure — done in `47676a8`
- [x] C2 — Computed route metrics unused; interchange count recomputed [done: d8b7e54]
- [x] C3 — Itinerary clock times drift on a long-open screen [done: d8b7e54]
- [x] C4 — `router.push` to a tab route grows the stack [done: d8b7e54]
- [x] C5 — Typo: "Choose a origin" [done: d8b7e54]
- [x] C6 — Dead email/password auth methods [done: 15ef405]
- [x] C7 — `cleanupOwnChannel` has no mutex [done: dc94b7d]
- [x] C8 — `stopLocationWatcher` is needlessly `async` [done: dc94b7d]
- [x] C9 — No tests for the location channel state machine [done: c4a0102]

---

# P0 — Critical

## L1 — Broadcasting silently dies after backgrounding (iOS)

**Files:** `src/realtime/LocationProvider.tsx:54-64`

### Problem
```js
if (next === 'background' || next === 'inactive') {
  wasBroadcastingBeforeBackground.current = await locationChannelManager.pauseForBackground();
}
```
iOS emits `active → inactive → background` as two separate AppState events. The
first call captures `true` and sets `isBroadcasting = false`. The second call reads
the already-cleared flag and **overwrites the ref with `false`**. On return to
foreground, `resumeForForeground(false)` only tracks `'online'`, so broadcasting is
off and the button flips to inactive with no explanation.

Backgrounding the app a single time permanently stops location sharing until the
user notices and re-toggles.

### Fix
Only capture the flag on a genuine foreground → background transition. Track the
previous AppState in a ref and ignore repeat pause events, or use `||=` on the ref
and clear it explicitly in the `active` branch after resuming. Prefer the former —
it keeps the ref's meaning unambiguous.

### Commit
```
fix(location): keep broadcasting state across the iOS inactive→background pair

AppState fires inactive then background on iOS, so the second pause overwrote
the saved "was broadcasting" flag with false and sharing never resumed.
```

---

## L2 — Broadcast can start while app is backgrounded; watcher leak

**Files:** `src/realtime/locationChannel.ts:108-145`

### Problem
`setBroadcasting(true)` awaits `requestForegroundPermissionsAsync()` and then
installs the watcher unconditionally. Presenting the iOS permission alert drives
AppState to `inactive`, which runs `pauseForBackground()` and clears state — then
the permission promise resolves and `track('broadcasting')` + `watchPositionAsync`
install anyway. The app is now transmitting live coordinates from the background,
which the file's own header comment (`locationChannel.ts:38-48`,
`LocationProvider.tsx:9-14`) explicitly states must never happen.

Separately, nothing guards re-entry: a second `setBroadcasting(true)` overwrites
`this.locationSubscription` without removing the previous one. The orphaned watcher
keeps firing and keeps calling `send()` forever, with no handle left to stop it.

### Fix
Apply the same generation guard `joinOwn` already uses:
- Capture `const myGeneration = ++this.generation` at entry (or add a dedicated
  broadcast generation so it doesn't fight channel teardown).
- After every `await`, bail if `myGeneration !== this.generation`, removing any
  subscription that was created in the meantime.
- Early-return if already broadcasting, and always `await this.stopLocationWatcher()`
  before assigning a new subscription.
- Also re-check `AppState.currentState === 'active'` after the permission await.

### Commit
```
fix(location): guard setBroadcasting against re-entry and backgrounding

A permission prompt backgrounds the app, so the pause ran before
watchPositionAsync resolved and the watcher installed anyway — broadcasting
from the background. Re-entry also leaked the previous watcher permanently.
```

---

## L3 — Reconnect downgrades an active broadcaster to "online"

**Files:** `src/realtime/locationChannel.ts:75-79`

### Problem
```js
channel.subscribe(async (status) => {
  if (status === 'SUBSCRIBED' && myGeneration === this.generation) {
    await channel.track({ status: 'online' satisfies PresenceStatus });
  }
});
```
`track()` in realtime-js is a one-shot send with no automatic re-track on rejoin,
and this callback fires again on **every** reconnect. Any network blip while
broadcasting resets presence to `'online'` permanently — while location pings keep
flowing, because the expo-location watcher survives the socket drop.

This produces a split-brain UI: `app/(tabs)/friends.tsx:97` keys Active/Inactive off
presence and moves the friend to **Inactive**, while `src/map/FriendsLayer.tsx` keys
off timestamp staleness and keeps their **live pin on the map**. Two screens
disagree about the same friend, and neither is wrong given its own inputs.

### Fix
Track the manager's real current status rather than a literal:
```js
await channel.track({ status: this.isBroadcasting ? 'broadcasting' : 'online' });
```
Fixing L3 plus I3 (single derived status model) removes this class of disagreement
structurally rather than per-screen.

### Commit
```
fix(location): re-track the real presence status on channel rejoin

The subscribe callback fires on every reconnect and always tracked 'online',
so a network blip dropped an actively-broadcasting user to Inactive on the
Friends tab while their live pin stayed on the map.
```

---

## L4 — Stale friend pins never leave the map

**Files:** `src/map/FriendsLayer.tsx:22,50-59`, `src/realtime/locationStore.ts:35-52`

### Problem
When a friend stops broadcasting, presence flips but their last location stays in
`friendLocations` forever. `FriendsLayer` never reads `friendPresence` at all — it
only dims the circle to 35% opacity via the `isStale` property. A friend who stopped
sharing an hour ago is still a faint dot at their last known position, indefinitely.

`removeFriend` is only called on unfriend and on teardown, never on "stopped
broadcasting".

### Fix
- In `LocationProvider`'s `onFriendPresence` handler (or in the store itself), clear
  the stored location when presence leaves `'broadcasting'`.
- In `buildGeoJSON`, drop features past a hard TTL instead of only dimming them, so
  a friend who goes offline without a presence event (force-quit, dead battery) also
  disappears.
- Keep a short dimmed window (~30s) as the "signal lost" affordance, then remove.

### Commit
```
fix(map): drop friend pins when they stop broadcasting

Locations were only ever dimmed, never removed, so a friend who stopped
sharing stayed on the map indefinitely at their last known position.
```

---

## L5 — Staleness computed against the sender's device clock

**Files:** `src/realtime/locationChannel.ts:139`, `src/realtime/locationStore.ts:5-12`,
`src/map/FriendsLayer.tsx:22`, `src/map/FriendFocusStack.tsx:70`,
`app/(tabs)/friends.tsx:413,475`

### Problem
`ts: position.timestamp` is the **sender's** epoch milliseconds, and every consumer
computes `Date.now() - loc.ts` against the **receiver's** clock. A friend whose phone
clock runs a few minutes fast reads "just now" forever and never goes stale; a few
minutes slow and they are permanently stale or invisible. Android devices with
automatic time disabled drift by minutes routinely.

`formatRelativeTime`'s `Math.max(0, …)` masks the forward-drift case rather than
surfacing it.

### Fix
Stamp arrival time on receipt and drive all staleness and "updated Xs ago" text off
it:
```ts
export interface FriendLocation {
  userId: string; lat: number; lon: number; heading: number | null;
  /** sender's clock — ordering/dedup only */ ts: number;
  /** receiver's clock — the only value safe to compare against Date.now() */ receivedAt: number;
}
```
Set `receivedAt: Date.now()` in `upsertFriendLocation`. Keep `ts` for detecting
out-of-order delivery.

### Commit
```
fix(location): measure staleness against arrival time, not the sender's clock

Friend freshness compared a sender-stamped timestamp to the local clock, so
device clock drift made friends permanently fresh or permanently stale.
```

---

## L6 — Friendship list never updates; new friends don't go live

**Files:** `src/friends/useFriendships.ts:43-45`

### Problem
There is no `postgres_changes` subscription on `friendships`. Rows load once on
mount and only refresh via pull-to-refresh or app restart. Consequences:

1. **The core social loop silently doesn't work.** A accepts B's request; B never
   subscribes to A's channel, so B cannot see A on the map until B manually pulls to
   refresh the Friends tab.
2. Incoming friend requests never appear without a manual refresh.
3. **Privacy:** on unfriend, the removed side keeps its already-joined channel.
   Realtime authorizes on join, so they may keep receiving locations until the
   channel rejoins or the access token refreshes — potentially up to an hour.

### Fix
Subscribe to `postgres_changes` on `public.friendships` for INSERT/UPDATE/DELETE and
call `refetch()` on any event. The `friendships: read own` RLS policy already scopes
what the user can see, so no schema change is needed — but Realtime replication must
be enabled for the table (`alter publication supabase_realtime add table
public.friendships;`) as a new migration.

`LocationProvider`'s existing `syncFriendSubscriptions` effect then reconciles
channels automatically, which also closes the unfriend leak.

### Commit
```
feat(friends): keep the friendship list live over realtime

Rows were fetched once on mount, so accepting a request never propagated to
the other device — they could not see the new friend until a manual refresh —
and an unfriended peer kept receiving location until their channel rejoined.
```

---

# P1 — High

## L7 — Broadcasts fall back to per-fix HTTP POSTs when channel isn't joined

**Files:** `src/realtime/locationChannel.ts:141`, `:65-88`

### Problem
`joinOwn()` is fire-and-forget and `setBroadcasting` never waits for `SUBSCRIBED`.
Confirmed in `@supabase/realtime-js@2.110.8`: `send()` with `type: 'broadcast'` on a
channel that cannot push silently performs a **REST POST per message** plus a
deprecation `console.warn`. Tapping Broadcast right after app open — or during any
reconnect — turns every GPS fix into an individual HTTP round-trip.

The return value is also discarded, so `'error'` and `'timed out'` are
indistinguishable from success anywhere in the app.

### Fix
- Have `joinOwn` expose a promise that resolves on `SUBSCRIBED`, and have
  `setBroadcasting(true)` await it before installing the watcher.
- Skip the send outright while the channel isn't joined (a dropped fix during a
  reconnect is cheaper and more honest than a REST POST).
- Inspect the `send()` result and surface repeated failures via
  `onBroadcastingChange` / a new error handler.

### Commit
```
fix(location): don't broadcast before the channel has joined

realtime-js silently falls back to one REST POST per message when the channel
can't push, so every GPS fix became an HTTP round-trip during join/reconnect.
```

---

## L8 — No error handling anywhere in the realtime pipeline

**Files:** `src/realtime/locationChannel.ts:75-79,195`

### Problem
`CHANNEL_ERROR`, `TIMED_OUT` and `CLOSED` are ignored on both the own channel and
every friend channel. If the join is denied — expired token, friendship not yet
accepted server-side, migration `0002_realtime_authorization.sql` not applied — the
user sees a green pulsing broadcast button while **nothing is transmitting**, and
friend channels sit silently dead. Nothing, not even a log line, ever reveals this.

### Fix
Handle the full status union in both `subscribe` callbacks. Add
`onChannelError(scope, status)` to `LocationManagerHandlers`, store a
`connectionState` in the location store, and surface it (see I8). Reset
`isBroadcasting` to false on own-channel failure so the button reflects reality.

### Commit
```
fix(location): handle CHANNEL_ERROR/TIMED_OUT on realtime subscriptions

A denied or failed join left the broadcast button lit green while nothing was
transmitting, with no signal to the user or the logs.
```

---

## M1 — MapLibre runs a second GPS watcher that is never stopped

**Files:** `app/(tabs)/index.tsx:60`, `src/map/UserLocationPin.tsx:15`

### Problem
`useCurrentPosition()` starts MapLibre's **native** LocationManager
(`node_modules/@maplibre/maplibre-react-native/.../LocationManager.js` — `addListener`
calls `start()`). Expo Router tabs stay mounted after first visit, so once the Map
tab is opened this watcher runs for the rest of the process lifetime, including while
the app is backgrounded, and concurrently with expo-location's watcher when
broadcasting.

Two independent GPS subscriptions, one of which directly contradicts the
"foreground-only, no background location" design claim in `LocationProvider.tsx:9-14`.

### Fix
- Pass `enabled` to `useCurrentPosition`, driven by AppState (`active`) and tab focus
  (`useIsFocused` from `@react-navigation/native`).
- Call it in exactly one place and pass the position down, rather than in both
  `MapScreen` and `UserLocationPin`.
- Consider feeding the pin from the expo-location watcher while broadcasting so only
  one provider is ever active.

### Commit
```
perf(map): stop the MapLibre location watcher when the map isn't visible

useCurrentPosition starts a native GPS watcher that kept running on other tabs
and in the background, alongside expo-location's own watcher.
```

---

## M2 — Camera hijack on every location tick; `focusUserId` is dead code

**Files:** `app/(tabs)/index.tsx:62-100`

### Problem
```js
useEffect(() => {
  if (!focusFriendLocation) return;
  cameraRef.current?.flyTo({ center: [focusFriendLocation.lon, focusFriendLocation.lat], … });
}, [focusFriendLocation]);
```
`focusFriendLocation` is a **new object every 5 seconds** (the store replaces it on
each broadcast), so the camera yanks back to that friend on every tick and the user
can never pan away. The param is never cleared, so it persists across navigations.

Worse: `focusUserId` is **dead code**. Nothing in the tree ever navigates with it —
the feature it was written for (tap a friend, see them on the map) doesn't exist.

### Fix
- Depend on `params.focusUserId` (a string) rather than the location object, and read
  the coordinates imperatively from `useLocationStore.getState()` inside the effect —
  fly once per focus request, not per tick.
- Clear the param after flying (`router.setParams({ focusUserId: undefined })`) so a
  later return to the tab doesn't re-hijack the camera.
- Wire up the entry point (see I4), or delete `focusUserId` entirely.

### Commit
```
fix(map): fly to a focused friend once instead of on every location tick

The effect depended on the location object, which is replaced every broadcast,
so the camera snapped back every 5s and the user could never pan away.
```

---

## L9 — Unvalidated broadcast payload reaches the native GeoJSON layer

**Files:** `src/realtime/locationChannel.ts:186-189`

### Problem
```js
const loc = payload as LocPayload;   // blind cast, no validation
this.handlers.onFriendLocation({ userId: friendId, ...loc });
```
This flows straight into `coordinates: [loc.lon, loc.lat]` in `FriendsLayer`. An
`undefined` or `NaN` value propagates into the native map layer. Only an accepted
friend can publish to their own topic so the blast radius is small, but a client
version mismatch is enough to trigger it.

### Fix
Add a narrow validator before the handler call: `Number.isFinite` on `lat`/`lon`/`ts`,
range-check `lat ∈ [-90, 90]` and `lon ∈ [-180, 180]`, coerce `heading` to
`number | null`. Drop the message otherwise. Cheap, and it makes the payload contract
explicit at the trust boundary.

### Commit
```
fix(location): validate incoming broadcast payloads before storing them

An unchecked cast let malformed coordinates reach the native GeoJSON layer.
```

---

## B1 — `npm run compile-data` is broken

**Files:** `scripts/compile-graph.ts:41`, `scripts/compile-tracks.ts:13`

### Problem
Both scripts read from `<root>/data`, but the source files were moved to `resources/`
in commit `e193b92` ("add resources folder") without updating them. Verified:
```
ENOENT: D:\Projects\metrosync-react-native\data\osm-stations.json
```
The documented first-time-setup step in `EXPO.md` fails on a fresh clone, and the
compiled graph can no longer be regenerated from source.

### Fix
Change `const DATA_DIR = resolve(ROOT, 'data')` to `resolve(ROOT, 'resources')` in
both scripts, run `npm run compile-data`, and confirm `assets/data/*.json` regenerate
byte-identically (they should — only the input path changed). Update the `/data`
references in `EXPO.md` and in `scripts/compile-graph.ts`'s header comment.

### Commit
```
fix(scripts): read source data from resources/ after the folder move

compile-graph and compile-tracks still pointed at data/, so npm run
compile-data failed on a fresh clone and the graph could not be regenerated.
```

---

# P2 — Medium

## A1 — Auth session stored unencrypted despite SecureStore being installed

**Files:** `src/lib/supabase.ts:13-24`, `app.json` (plugins)

### Problem
Refresh tokens go into `AsyncStorage`, which is plaintext on disk.
`expo-secure-store` is installed **and registered as an Expo plugin**, but is never
imported anywhere in `src/` or `app/` — the intent was there, the wiring never landed.

### Fix
Implement a SecureStore-backed storage adapter for the Supabase auth client. Note
SecureStore's ~2 KB per-value limit — Supabase sessions exceed it, so chunk the value
across numbered keys (the standard Expo/Supabase recipe). Fall back to AsyncStorage on
web. Migrate any existing AsyncStorage session on first run so users aren't signed out.

### Commit
```
feat(auth): store the Supabase session in SecureStore instead of AsyncStorage

expo-secure-store was already installed and registered as a plugin but never
used; refresh tokens sat in plaintext on disk.
```

---

## A2 — Session race in AuthProvider; profile refetched on every token refresh

**Files:** `src/auth/AuthProvider.tsx:65-78,96-113`

### Problem
`getSession().then(setSession)` runs concurrently with `onAuthStateChange`. If an
OAuth deep link resolves first, the slower `getSession` resolves with the older value
and clobbers the newer session.

Separately, the profile effect depends on `[session?.user]` — a fresh object on every
token refresh — so the profile is re-fetched roughly hourly for no reason.

### Fix
- Ignore the `getSession` result if `onAuthStateChange` has already delivered a
  session (a `hasResolved` ref, or skip `getSession` entirely and rely on the
  `INITIAL_SESSION` event).
- Change the profile effect dependency to `[session?.user?.id]`.

### Commit
```
fix(auth): stop getSession from clobbering a newer session, key profile by id

An OAuth deep link could install a session before getSession resolved, and the
profile effect refetched on every hourly token refresh.
```

---

## F1 — Errors swallowed throughout the friendships layer

**Files:** `src/friends/useFriendships.ts:25-79`

### Problem
`acceptRequest` and `removeFriendship` discard the Supabase error entirely — a failed
accept is indistinguishable from a successful one (the row simply reappears after
refetch). `refetch` also ignores its error and sets `isLoading` on every call, so
pull-to-refresh flashes the whole list.

Also: `.or(\`requester_id.eq.${selfUserId},addressee_id.eq.${selfUserId}\`)`
interpolates directly into PostgREST filter syntax. The value is a session UUID so it
isn't exploitable today, but it's the wrong pattern to leave in place.

### Fix
- Return `{ error }` from `acceptRequest`/`removeFriendship` like `sendRequest` does,
  and surface it on the Friends screen.
- Add an `error` field to the hook's return for `refetch` failures; distinguish
  initial load from refresh so pull-to-refresh doesn't blank the list.
- Optimistically update on accept/remove, then reconcile.

### Commit
```
fix(friends): surface errors from accept/remove/refetch instead of swallowing them

A failed accept looked identical to a successful one, and refetch failures were
invisible.
```

---

## M3 — "Center on me" fails silently; permission prompt fired blind on mount

**Files:** `app/(tabs)/index.tsx:77-79,112-119`

### Problem
`handleCenterOnMyLocation` starts with `if (!currentPosition) return;` — with
permission denied or no fix yet, the button does nothing at all, forever, with no
feedback.

`LocationManager.requestPermissions()` at `:77` is a floating promise whose result is
never read, fired on mount — so the user gets a location prompt before they've asked
for anything location-related. It also duplicates expo-location's permission flow used
in `setBroadcasting` (`PermissionsAndroid` vs `expo-location`).

### Fix
- Track permission/fix state and give the button a distinct disabled or
  "grant permission" state; on denial, deep-link to app settings.
- Await `requestPermissions()` and store the result; consider deferring the prompt to
  first actual use (tapping locate or broadcast).
- Standardise on one permission API — expo-location is already a dependency and is
  what the broadcast path uses.

### Commit
```
fix(map): give the locate button real state instead of silently no-oping

With permission denied or no fix yet, the button did nothing with no feedback,
and the permission prompt fired unprompted on mount.
```

---

## S1 — RLS: sending a request reveals the target's profile without consent

**Files:** `supabase/migrations/0001_init.sql:54-66`

### Problem
The `profiles: read friends` policy matches `status in ('pending','accepted')` in
**both** directions. Anyone who knows your email can send a request and immediately
read your `display_name`, `avatar_url` and `public_uid` — no acceptance needed. The
comment justifies pending access so an addressee can see who's requesting them, but
the policy grants it symmetrically, so the requester gains access purely by asking.
Cancelling the request doesn't help: they've already read it.

Related and still open (already TODO'd at `0001_init.sql:107-111`):
`find_user_by_handle` remains an unthrottled enumeration oracle.

### Fix
Split the pending case so it only grants the addressee visibility:
```sql
(f.status = 'accepted' and (…either direction…))
or (f.status = 'pending' and f.addressee_id = auth.uid() and f.requester_id = profiles.id)
```
Write as a new migration (`0003_…`), don't edit `0001` in place. Verify the outgoing
"Request sent" row in the Friends UI degrades gracefully — it will need to fall back
to the handle the user typed rather than a joined profile.

### Commit
```
fix(db): stop a pending request from exposing the target's profile

The pending branch of the read policy applied in both directions, so anyone who
knew your email could read your profile just by sending a request.
```

---

## S2 — `blocked` friendship status is schema-only

**Files:** `supabase/migrations/0001_init.sql:29`, `src/friends/useFriendships.ts:5`

### Problem
`status` accepts `'blocked'` and the TypeScript union includes it, but no UI ever sets
it and no query treats it differently from any other non-accepted row. A blocked user
is simply filtered out of `accepted` — the block carries no meaning.

### Fix
Either implement it (a Block action in `FriendMenuButton`, plus a policy preventing
the blocked party from re-requesting) or drop `'blocked'` from the CHECK constraint
and the type so it can't be set out-of-band.

### Commit
```
chore(friends): implement or remove the unused 'blocked' status
```

---

# Improvements

## I1 — Friend pins are anonymous, identical green dots

**Files:** `src/map/FriendsLayer.tsx:50-59`

**Problem:** every friend renders as the same 10px `colors.success` circle. With two
or more friends broadcasting there is no way to tell who is who — the map answers
"someone is here" but never "who".

**Fix:** highest-value map change. Add a `symbol` layer above the circles with
`text-field: ['get', 'name']` (a `text-offset` of `[0, 1.2]` keeps it clear of the
dot), and give each pin a stable per-friend color — hash the userId into the palette,
or reuse the metro line color of their nearest station. Avatar images would need
`Images`/icon registration; the text label alone captures most of the benefit at a
fraction of the work. Requires threading display names from `FriendshipsProvider` into
the layer, which `FriendFocusStack` already demonstrates.

```
feat(map): label friend pins with names and per-friend colors
```

---

## I2 — Pins teleport every 5s; `heading` is captured but unused

**Files:** `src/map/FriendsLayer.tsx:28-33`, `src/realtime/locationStore.ts:9`

**Problem:** the existing comment rejects per-friend Reanimated views — correct call —
but concludes that discrete jumps are the only option. There's a cheaper third way it
doesn't consider. Also, `heading` is transmitted on every payload and read by nothing.

**Fix:** keep the single GeoJSON source and interpolate the **coordinates** in JS
between the last two fixes on a ~60ms tick. One source update per frame, no extra
views, and movement reads as motion instead of teleportation. Store the previous fix
alongside the current one to interpolate against. With `heading` already available,
swap the circle for a directional arrow icon when speed is non-zero.

```
feat(map): interpolate friend pin movement between broadcasts
```

---

## I3 — Three components define "is this friend live?" independently

**Files:** `src/map/FriendsLayer.tsx:6-7`, `src/map/FriendFocusStack.tsx:15-16`,
`app/(tabs)/friends.tsx:30`

**Problem:** `STALE_AFTER_MS` / `STALE_CHECK_INTERVAL_MS` are duplicated verbatim in
two files, and the Friends screen uses a **third, different model** (presence). Each
also runs its own `setInterval` ticking `Date.now()` into state, so two independent
10s timers re-render map subtrees. This duplication is the root cause of L3's
split-brain symptom.

**Fix:** consolidate into one derived selector in the location store —
`useFriendStatus(userId) → 'live' | 'stale' | 'online' | 'offline'` — combining
presence and arrival-time freshness (see L5). Have all three screens read it, and run
a single shared clock tick. Fixes the Active/Inactive disagreement structurally rather
than per-screen, and is a prerequisite for making L3/L4 stay fixed.

```
refactor(location): derive friend status from one shared selector
```

---

## I4 — No path from the Friends tab to the map

**Files:** `app/(tabs)/friends.tsx:213-223`

**Problem:** `ActiveFriendCard` isn't tappable. The map's `focusUserId` handling
(M2) is the receiving half of a feature whose entry point was never built.

**Fix:** add `onPress` → `router.navigate({ pathname: '/(tabs)', params: { focusUserId: profile.id } })`.
Land together with M2 so the camera flies once rather than every tick.

```
feat(friends): tap an active friend to focus them on the map
```

---

## I5 — "Current line" attribution is a coin flip at interchanges

**Files:** `app/(tabs)/friends.tsx:399-408`, `src/friends/nearestStation.ts:16`

**Problem:** `nearest.lines[0]` takes an arbitrary line. At Kashmere Gate that's one
of three, picked by array order. The line badge — the thing that makes this a *metro*
app rather than a generic dot-on-a-map — is frequently just wrong.

**Fix:** you retain the previous fix (after I2), so infer the line from the movement
vector: of the nearest station's lines, pick the one whose adjacent-station bearing
best matches the friend's direction of travel. The compiled graph already has the
adjacency and coordinates needed. Fall back to `lines[0]` when stationary.

```
feat(friends): infer a friend's current line from their direction of travel
```

---

## I6 — Show distance / ETA between you and a friend

**Files:** `app/(tabs)/friends.tsx`, `src/engine/graph.ts`

**Problem:** the app shows a friend's distance to *a station*, but never their
distance to **you** — arguably the single most compelling thing it could display.

**Fix:** everything needed is already in place: both positions, `findNearestStation`,
and `findRoute`. Compute the route between the two nearest stations and render
"4 stops away · ~11 min" on the active friend card. Memoize per friend and recompute
only when the nearest station changes, not on every fix.

```
feat(friends): show stops and ETA between you and an active friend
```

---

## I7 — `findNearestStation` is a linear scan per friend per tick

**Files:** `src/friends/nearestStation.ts:11-20`

**Problem:** ~280 haversines per friend per broadcast. Fine at today's scale; becomes
the hot path the moment I5/I6 land.

**Fix:** bucket stations into a coarse lat/lon grid (~0.01°) once at module load and
search the target cell plus its neighbours, widening only if empty.

```
perf(friends): index stations by grid cell for nearest-station lookup
```

---

## I8 — No connection-state indicator

**Problem:** if the realtime socket drops, "no friends are sharing" and "we lost the
connection" look identical.

**Fix:** expose socket/channel state in the location store (feeds off L8's error
handling) and show a subtle banner or a desaturated broadcast button when
disconnected.

```
feat(ui): surface realtime connection state
```

---

# Minor / code health

## C1 — `useFonts` error ignored
`app/_layout.tsx:45-55` — only the first tuple element is read. If font loading fails,
`fontsLoaded` stays false and the app renders `null` forever with no recovery path.
Destructure the error and render the app with system fonts on failure.
```
fix(app): render with system fonts when font loading fails
```

## C2 — Computed route metrics unused
`route.distanceMeters` and `route.stationsPassed` are computed in
`src/engine/itinerary.ts:55-66` and never displayed. `RouteSummaryCard.tsx:26`
recomputes the interchange count as `legs.length - 1` instead of using
`route.interchanges`. Display them or drop the computation; use the engine's value.
```
chore(route): use the engine's interchange count, drop unused metrics
```

## C3 — Itinerary clock times drift
`app/(tabs)/route.tsx:48` — `useMemo(() => Date.now(), [route])`. Leave the screen open
for an hour and the "if you left now" times are an hour stale. Refresh on focus.
```
fix(route): refresh itinerary start time when the screen regains focus
```

## C4 — `router.push` to a tab route
`app/(tabs)/route.tsx:69` — pushing a tab route grows the navigation stack instead of
switching tabs. Use `router.navigate`.
```
fix(route): navigate to the map tab instead of pushing onto the stack
```

## C5 — Typo
`app/(tabs)/route.tsx:176` — "Choose a origin and destination station" → "an origin".
```
fix(route): typo in the empty-state copy
```

## C6 — Dead email/password auth
`src/auth/AuthProvider.tsx:122-130` — `signInWithEmail`/`signUpWithEmail` remain on the
context after commit `8795047` removed the UI. Dead code with a live auth surface.
```
chore(auth): drop the unused email/password methods
```

## C7 — `cleanupOwnChannel` has no mutex
`src/realtime/locationChannel.ts:98-106` — a fast sign-out/sign-in can interleave two
calls; the stale one's `this.ownUserId = null` lands after the new `joinOwn` set it,
leaving `ownChannel` set with a null owner id. Serialise on a shared in-flight promise.
```
fix(location): serialise own-channel cleanup against concurrent joins
```

## C8 — `stopLocationWatcher` needlessly `async`
`src/realtime/locationChannel.ts:152-155` — nothing inside awaits. Making it sync
removes several misleading `await`s at call sites.
```
chore(location): make stopLocationWatcher synchronous
```

## C9 — No tests for the location channel state machine
`src/realtime/locationChannel.ts` is the buggiest file in the repo (L1–L9 above) and
has zero coverage, while `src/engine` — the most correct code — has 22 tests. It's pure
logic with two injectable seams (`supabase.channel`, `Location.watchPositionAsync`) and
mocks cleanly under the existing vitest setup. Note `vitest.config.ts` only includes
`src/**/*.test.ts`, while the engine tests live in `src/engine/__tests__/*.test.ts` —
that glob does match, but confirm any new location tests are picked up.

Cover at minimum: the inactive→background pair (L1), permission-await backgrounding
(L2), reconnect re-track (L3), and re-entrant `setBroadcasting` (L2 watcher leak).
```
test(location): cover the broadcast state machine's background and reconnect paths
```
