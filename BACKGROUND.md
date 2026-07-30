# Background tracking — plan

Goal: the user starts a journey, puts the phone in their pocket, and MetroSync
keeps working — friends still see them move, a live notification tracks their
progress, and they get told when to get off.

Decisions taken up front (2026-07-30):

- **One notification, via a custom native foreground service.** Not
  expo-location's background API. Reasoning in "Why a native module" below.
- **All four background behaviours** are in scope: broadcast to friends, live
  progress notification, alight/interchange alerts, friend proximity alerts.
- **Explicit "Start journey" button.** Android forbids starting a foreground
  service from the background, so tracking must begin on a user action.
- **Sideloaded APKs for now**, no Play Store review to design around. We still
  declare permissions correctly so the Play path stays open.

Out of scope: the phone being powered off (nothing runs), and iOS Live
Activities (needs a native widget extension — separate project).

**Swiping the app away from recents ends the journey.** That is intended
behaviour, not a limitation to work around — it gives the user an obvious,
discoverable way to stop everything, and it means we never have to keep a
JS runtime alive across activity destruction.

## Committing

Commit at the end of each milestone, one line, imperative, lower case, matching
the existing log style (`show station names when sufficiently zoomed`). No
`Co-Authored-By` trailer. Suggested messages are listed per milestone below.

## Why a native module

Two platform facts drive the whole design.

**1. A `location`-typed foreground service is mandatory.** A backgrounded
Android app receives location a few times *per hour*. An app running such a
service gets full-rate updates and is exempt from Doze.

The useful corollary, confirmed in `expo-location@57.0.6`
(`LocationModule.kt:315-333`): starting location updates *with* a foreground
service does **not** require `ACCESS_BACKGROUND_LOCATION`. So no "Allow all the
time" permission and no Play background-location review — only
`FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_LOCATION`.

**2. expo-location's own notification can't be updated from the background.**
`LocationTaskConsumer.kt:181` returns early when the app isn't foregrounded, so
re-registering the task to change the text is a no-op with the phone in a
pocket. And `expo-notifications` has no progress bar or custom layout. Neither
gets us a Google-Maps-style live surface.

A small native service solves both, and has a large second-order benefit:
**while our foreground service runs, the app counts as foreground for location
purposes for the whole process.** That means the existing
`Location.watchPositionAsync` in `locationChannel.ts` keeps delivering at full
rate in the background, the websocket stays up, timers keep firing, and the
React tree stays mounted. No TaskManager, no headless JS, no re-deriving route
state in a bare runtime. The JS refactor shrinks to almost nothing.

The cost is ~250 lines of Kotlin. It also means nothing restarts the session if
the process dies — which is exactly the behaviour we want, since swiping the app
away is meant to end the journey.

## Constraint: JS timers stop in the background

Found the hard way in M1, and it invalidates the obvious way to write all of
this.

React Native drives `setTimeout`/`setInterval` off a Choreographer frame
callback. `JavaTimerManager.onHostPause` removes that callback the instant the
app is backgrounded:

```kotlin
override fun onHostPause() {
  isPaused.set(true)
  clearFrameCallback()
}
```

So **`setInterval` stops dead when the app is minimised**, foreground service or
not. The service keeps the *process* alive; it does not make React Native's
timer queue run. (`ReactInstance.kt` uses `JavaTimerManager`, so this is the new
architecture's behaviour, not a legacy path.)

What still works while backgrounded: **anything native calling into JS**.
Those are posted to the JS thread's Looper rather than scheduled off a frame —
location fixes from the OS watcher, websocket messages, and the service's own
tick all arrive normally.

Two consequences:

1. **The service emits an `onTick` event** (`tickIntervalMs` on
   `startJourneyService`), driven by a `Handler` on the main Looper. Everything
   periodic subscribes to that instead of using `setInterval`.
2. **Prefer event-driven over periodic anyway.** Notification updates should
   hang off location fixes arriving, which is what the feature wants regardless.

The one escape hatch RN offers is an active HeadlessJsTask, which restores the
frame callback (`clearFrameCallback` no-ops while `hasActiveTasks()`). Not worth
relying on: the Choreographer is driven by display vsync, which stops on many
devices when the screen is off — so it would fix "minimised" without fixing
"pocket", which is the case that matters.

## What exists today

Foreground-only by design, in several places at once:

- `src/realtime/LocationProvider.tsx:70` — AppState `background` →
  `pauseForBackground()`: stops the watcher, untracks presence. You disappear
  from friends' maps.
- `src/realtime/locationChannel.ts:451` — `setBroadcasting` refuses to start
  unless the app is active, and `waitForForeground()` gates several steps.
- `app/(tabs)/index.tsx:177` — the app's only live GPS watcher, gated on
  `isScreenFocused && isAppActive`. Also the only thing feeding
  `selfPositionStore`.
- `getRouteProgress` / `useRouteClock` run as React hooks off screen focus;
  `activeRouteStore` is deliberately not persisted.
- No `expo-notifications`, no `FOREGROUND_SERVICE` permission.

The good news: `src/engine/*` and `src/route/routeProgress.ts`,
`routeClock.ts`, `stationOnRoute.ts` are pure functions already. They port to a
non-React caller unchanged.

## Milestones

### M1 — the native module (`modules/journey-service/`)

`npx create-expo-module --local journey-service`. Module source is committed;
`android/` stays generated and gitignored, regenerated by prebuild.

Its own `AndroidManifest.xml` declares:

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<service android:name=".JourneyForegroundService"
         android:exported="false"
         android:foregroundServiceType="location" />
```

JS API:

| Function | Notes |
|---|---|
| `startAsync(content)` | Starts the FGS with an initial notification. Throws if called while backgrounded — Android 15 hard-blocks it. |
| `updateAsync(content)` | Updates the notification in place. **Works from the background — this is the whole point.** |
| `stopAsync()` | `stopForeground` + `stopSelf`. |
| `isRunningAsync()` | For reconciling JS state after a restart. |
| `onAction` event | Notification button presses back into JS. |

`content` is `{ title, body, progress?: { current, max }, color?, showStopAction }`.

Implementation notes:

- Channel at `IMPORTANCE_LOW` — the ongoing notification must never buzz or
  peek. Alerts get their own high-importance channel (M4).
- `Notification.ProgressStyle` on Android 16+, `NotificationCompat` progress bar
  below, behind an `SDK_INT` check.
- Content intent launches `MainActivity` (the `metrosync://` scheme is already
  registered) deep-linked to the map.
- "Stop" action → `BroadcastReceiver` that emits to JS *and* stops the service
  natively, so it still works if JS is gone.
- `onTaskRemoved` → `stopForeground(true)` + `stopSelf()`. Swiping the app away
  ends the journey and clears the notification, by design. A stale ongoing
  notification pointing at a dead process is the worst outcome here.

**Verified on device:** with the service running, the notification keeps
updating both while the app is minimised and while the phone is locked. That
settles the load-bearing assumption — the process stays alive and native events
reach JS — provided nothing periodic goes through a JS timer.

Commit: `add a foreground service module for background journey tracking`

### M2 — journey session layer (`src/journey/`)

Non-React module singletons. The UI observes; it does not drive.

- **`journeyStore.ts`** — zustand: `status: 'idle' | 'active'`, `originId`,
  `destinationId`, `mode`, `startedAt`. Persisted to AsyncStorage so the next
  launch can reconcile: if the store says a journey was active but
  `isRunningAsync()` says no service is running, the journey ended (swiped away,
  or killed) and the state is cleared rather than resurrected.
  `activeRouteStore` stays session-scoped as it is today.
- **`journeyController.ts`** — the orchestrator:
  - `start({originId, destinationId, mode})` — request FINE location +
    `POST_NOTIFICATIONS`, confirm location services are on (reuse
    `locationChannel`'s existing `hasLocationServices` /
    `promptToEnableLocationServices` logic), start the service, mark the session
    active, turn broadcasting on.
  - `stop(reason)` — reverse, and say why in the UI when it wasn't the user.
  - Owns the location watcher for the journey's duration and writes to
    `selfPositionStore`, so the notification, the map and the planner cannot
    disagree about which station the user is at. (This pulls the
    "one location source" item forward from M3 — it made M2 independently
    testable rather than needing M3 to land before anything moved.)
  - `refresh()` — the single funnel every trigger goes through: recompute
    progress → build content → `updateAsync`. Driven by location fixes *and*
    by the service tick, the latter so a user standing on a platform still has
    their arrival times re-timed rather than quietly going stale.
  - Auto-stop at the destination (after letting "Arrived" sit for 30s), on a
    session older than 4h, or when GPS dies.
- **`notificationContent.ts`** — pure: `(route, progress, clock) → content`.
  e.g. title `"Hauz Khas · 14:32"`, body `"3 stops · next Green Park"`,
  progress `{ current: nearestIndex, max: sequence.length - 1 }`. Unit-tested
  with vitest like the rest of the engine.

Commit: `drive the journey notification from a non-react session controller`

### M3 — let broadcasting survive backgrounding

- `LocationProvider`'s AppState handler: pause on background **only when no
  journey session is active**. Idle behaviour stays exactly as it is today —
  same battery cost, same privacy promise.
- `locationChannel.setBroadcasting`: skip the `waitForForeground()` gates when a
  session is live, otherwise a background resume just times out.
- **Collapse to one location source.** M2 gave the journey controller its own
  watcher, so a running journey now means two: MapLibre's `useCurrentPosition`
  on the map screen and `locationChannel`'s broadcast watcher, plus the
  journey's. Gate the first two on there being no active journey and let
  `locationChannel` broadcast from the fixes the journey already receives.
  Three concurrent GPS watchers is a battery problem.
- **Move every background-critical `setInterval` onto the service tick.** Per
  "Constraint: JS timers stop in the background", these stop the moment the app
  is minimised:

  | Where | Interval | Matters in background? |
  |---|---|---|
  | `locationChannel.startHeartbeat` | 5s | **Yes.** Resends the last fix so a stationary user doesn't go stale on friends' devices at 30s and get dropped at 90s. Without it, standing on a platform makes you vanish — the exact case the heartbeat was written for. |
  | `locationChannel.startServicesWatchdog` | 15s | **Yes.** Otherwise GPS being switched off mid-journey is never noticed. |
  | `locationChannel.waitForOwnChannelJoined` | 150ms poll | **Yes**, on any background rejoin — it would hang until foreground. |
  | supabase-js realtime heartbeat | 30s | **Yes, and it's not our timer.** The server drops the socket without it, so broadcasting dies a minute after backgrounding. Drive `supabase.realtime.sendHeartbeat()` from the tick. Realtime-js's reconnect backoff is also timer-based — a socket that drops while backgrounded may not come back on its own. |
  | `locationStore.subscribeToTick` | 10s | No — it ages friend pins for the UI, which nobody is looking at. |
  | `useRouteClock` | 20s | No — same reason. |

- Update the design comments that currently promise "ephemeral, foreground-only"
  — they'll be wrong, and they're load-bearing documentation.

Commit: `keep broadcasting to friends while a journey is running in the background`

### M4 — alerts

Add `expo-notifications`, used *only* for transient alerts (heads-up, sound,
vibration) on a separate high-importance channel. The ongoing notification stays
owned by the native module.

- `alerts.ts` — pure rules over `RouteProgress`: approaching destination
  (`nearestIndex === last - 1`), interchange next (next station opens a new
  `legIndex`), arrived. Each latched once per journey and persisted, so GPS
  jitter can't re-fire them. `routeProgress.ts` is stateless by design, so the
  latch has to live here.
- `friendAlerts.ts` — subscribes to `locationStore.friendLocations`, reuses
  `friendEta.ts` and `nearestStation.ts`. "Rohit is 2 stops away", "Rohit
  arrived at Rajiv Chowk". Latched per friend + station. Friend channels are
  already alive in the background once the process is protected.
- Notification volume needs tuning. Four alert types firing freely on a long
  journey is enough for someone to long-press the notification and switch
  MetroSync's notifications off in Android settings — after which the alight
  alert, the one genuinely worth having, never arrives either. Conservative
  defaults, and friend alerts off until asked for.

Commit: `alert on alighting, interchanges and friends arriving`

### M5 — UI

- "Start journey" on the route screen (near `RouteSummaryCard`), and a
  persistent journey bar on the map with the current progress and a Stop button.
- A consent moment the first time: this changes the deal from "friends see me
  while I have the app open" to "friends see me until I stop". Needs to be
  explicit, and the notification is always-visible by design, which helps.

Commit: `add start journey and the active journey bar`

### M6 — surviving real Android

- `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` prompt when starting a journey.
- In-app guidance for Xiaomi/HyperOS, Oppo, Vivo, Samsung autostart settings.
  This matters more than anything else in this document for Indian devices —
  see dontkillmyapp.com.
- Device test matrix: screen off, 45-minute ride, Doze, low battery mode, GPS
  toggled mid-journey, tunnel signal loss. Plus one explicit check that swiping
  the app away ends the journey cleanly — notification gone, presence untracked,
  friends see you stop.

Commit: `keep journeys alive through android battery optimisation`

### M7 — iOS (best-effort, later)

`UIBackgroundModes: ['location']` via
`expo-location`'s `isIosBackgroundLocationEnabled`, plus "Always" permission and
`showsBackgroundLocationIndicator`. Gets background fixes and alert
notifications. The live progress surface would be a Live Activity — native
widget extension, not an Expo-only path, deferred.

Commit: `track journeys in the background on ios`

## Risks

| Risk | Mitigation |
|---|---|
| OEM battery managers kill the app mid-journey | M6. Realistically can't be fully solved, only mitigated. The user sees the notification disappear, which at least isn't silent. |
| Stale ongoing notification outliving the process | `onTaskRemoved` stops the service; launch-time reconciliation clears orphaned session state. |
| A `setInterval` added later silently stops working in the background | It fails quietly, which is the dangerous part — nothing errors, the work just stops. Prefer the service tick, and treat any new timer in `src/journey/` or `src/realtime/` as a review point. |
| The realtime socket drops while backgrounded and never reconnects | Realtime-js retries on timers we can't reach. Watch for it in M6 testing; the fallback is to detect a dead socket on the tick and rejoin explicitly. |
| Battery drain | Keep `Accuracy.Balanced` and the existing 15m distance filter; auto-stop at the destination. |
| Alert spam | Per-station latches; conservative defaults; make friend alerts opt-in. |
| Privacy expectations shift | Explicit opt-in, always-visible notification, one-tap stop from the notification. |

## Testing

- **vitest** covers `notificationContent.ts`, `alerts.ts`, `friendAlerts.ts` —
  all pure, same shape as the existing `routeProgress` / `routeClock` tests.
- Everything else is device-only. Budget real time for M6.
