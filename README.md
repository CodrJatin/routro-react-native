# Routro

Never ride the metro alone.

Routro is an Android app for the Delhi Metro, the Airport Express, NCR Metro in
Gurugram and Noida, and the Delhi to Meerut RRTS. It plans your route across all
of them as one network, shows you and your friends moving on a live map, works
out where the two of you should meet, and tells you when to get off while the
phone is in your pocket.

Landing page and downloads: <https://routro.vercel.app>

## What it does

**Plans a route offline.** The whole network is compiled into a graph that ships
inside the app, so search, routing and fares work with no connection at all.
Fares follow the DMRC distance slabs, including the smart card and off-peak
discounts.

**Shows your friends on the map.** Friends you have added appear as live pins,
gliding between fixes rather than jumping, each in its own colour, with the line
they are currently on and an ETA. Sharing happens automatically whenever the app
is open, so nobody has to remember to switch it on.

**Ghost mode when you want it.** One switch that is symmetric on purpose:
nothing goes out and nothing comes in. It resets when you swipe the app away,
because that gesture is the obvious way to say you are done.

**Agrees on where to meet.** Given two journeys, Routro finds the stations both
of you actually pass through, works out who arrives first and how long they wait,
and lets you send a meet request that the other person accepts or declines.

**Tracks your journey in the background.** Starting a journey launches a native
Android foreground service that draws a live notification: a progress tracker
segmented and coloured by line, interchange markers, and alerts telling you when
to change and when to get off. The notification updates with the phone locked.
Swiping the app away ends the journey, deliberately.

**Adds friends by link.** An invite is an https URL that opens the app directly
on a verified install, and a small web page for everyone else.

## How it works

The interesting parts of this codebase are mostly about three constraints.

**The network data is not usable as it comes.** The raw OSM extract in
`resources/` models fourteen interchanges as unconnected per-line nodes, which
splits the network into ten disconnected components, and labels each track way
only with its endpoints rather than with every station it passes. Both are fixed
at build time by the compilers in `scripts/`, which emit the two JSON assets the
app bundles. The app never sees the raw data.

**JS timers stop when the app is backgrounded.** React Native drives
`setTimeout` off a Choreographer frame callback that is removed the instant the
app is paused, so a backgrounded journey cannot use an interval for anything. The
native service emits its own tick instead, and everything periodic hangs off that
or off events arriving from native code. This is what drives the notification
updates and, less obviously, the auth token refresh: private realtime channels
are JWT gated, so without that refresh a long journey silently loses its channels
at token expiry. The Kotlin service in `modules/journey-service/` and the
comments around it are the full write-up.

**A metro ride is a great many reconnects.** Underground, the connection drops
constantly, so the realtime layer treats disconnection as the normal case. Every
channel type shares one rejoin ladder with backoff, reconnects immediately when
the network returns, and retries indefinitely rather than ever giving up. On the
server side, the row level security policies that gate those joins are the
hottest queries in the database, which is why `supabase/migrations/0007` exists.

## Screens

| Tab | What lives there |
| --- | --- |
| Map | The live map: your position, friends, stations, the highlighted route, the connection banner and ghost mode banner. |
| Route | Station search, itineraries with fares and times, saved journeys that start with one tap and flip to offer the return trip. |
| Friends | Your friends sorted live, then active, then inactive, invites, and meet requests. A dot on the tab icon shows when someone is live. |
| Settings | Profile, theme, map style, notification preferences. |

## Stack

- Expo SDK 57 and React Native 0.86, new architecture, with Expo Router for
  navigation
- MapLibre for the map, drawing the metro's own sources and layers over an
  optional CARTO vector basemap
- Supabase for auth (Google only), Postgres with row level security, and
  realtime channels for presence and location broadcast
- Zustand for state, Reanimated 4 for animation
- A small Kotlin Expo module for the Android foreground service
- Vitest for the pure logic, which is most of the logic
- TypeScript throughout

## Project layout

| Path | What it is |
| --- | --- |
| `app/` | Expo Router routes: the tabs, the auth screen, onboarding, the invite handler. |
| `src/engine/` | Offline routing: the compiled graph, Dijkstra, itinerary building, fares, station search. No React. |
| `src/realtime/` | Supabase channels, presence, location broadcast, the rejoin ladder and the network watcher. |
| `src/journey/` | Journey state, alerts, and the notification content the native service renders. |
| `src/map/` | Map style, layers, pin interpolation, station labels, the banners. |
| `src/friends/` | Friendships, invites, meeting station search, meet requests. |
| `src/route/` | Route screen state, saved journeys, origin autofill. |
| `src/location/` | The shared GPS watch options and the position watchers. |
| `src/sharing/` | Ghost mode and the location permission prompt memory. |
| `src/diagnostics/` | Redacted log ring and crash reporting. |
| `src/dialog/` | The in-app dialog queue that replaced `Alert.alert`. |
| `src/updates/` | Over the air update checks on foreground. |
| `modules/journey-service/` | The Kotlin foreground service and its TypeScript interface. |
| `plugins/` | Config plugins: Material 3 theming, per-architecture APK splits. |
| `scripts/` | Data compilers and the release packaging script. |
| `supabase/migrations/` | The schema, RLS policies and functions, in order. |
| `site/` | The landing page and the invite page, deployed separately. |
| `resources/` | Raw OSM extracts. Input to the compilers, not shipped. |

## Getting started

You need Node, an Android device or emulator, and a Supabase project. iOS is not
supported yet: the background journey service is Android only.

Install dependencies.

```bash
npm install
```

Create `.env` from the template and fill in your Supabase URL and anon key. The
anon key belongs in the client; row level security is what actually protects the
data, so never put a service role key here.

```bash
cp .env.example .env
```

Apply the migrations in `supabase/migrations/` in numeric order, through the
Supabase dashboard or the CLI. They are ordinary SQL and they depend on each
other, so order matters.

Because of the native module, this needs a development build rather than Expo
Go. The first run prebuilds and compiles, which takes a while.

```bash
npm run android
```

After that, the dev server on its own is enough.

```bash
npm start
```

## The network data

The two assets in `assets/data/` are generated, not hand-edited. Regenerate them
after changing anything in `resources/`.

```bash
npm run compile-data
```

`compile-graph` merges split interchanges, stitches the remaining disconnected
components when the closest pair is near enough to be a real interchange and
refuses to guess beyond that, repairs implausible ride times, and lints what is
left. `compile-tracks` splits every track way at the stations lying on it, so
route highlighting follows real geometry instead of drawing straight lines
between dots.

## Tests

```bash
npm test
```

Vitest, over `src/**/*.test.ts`. The suite covers the parts worth testing on
their own: routing, fares, meeting station selection, the realtime channels and
their rejoin behaviour, secure storage chunking, session refresh, crash
reporting, update timing, and the small decision functions like origin autofill.
`__DEV__` is pinned to `false` under test, so tests see what a release build
does.

## Releases

Build the release APKs and package them for distribution.

```bash
npm run release:apks -- --build
```

Gradle produces one APK per architecture plus a universal fallback. The script
renames them to `routro-v<version>-<abi>.apk`, writes SHA-256 checksums, and
generates `site/release.json`, which is what the download page reads. Add
`--upload` to attach them to the GitHub release.

One manual step remains on purpose: `site/release.json` has to be committed and
pushed for a new version to appear on the site. Nothing breaks if it is
forgotten, the page simply keeps offering the previous release, which is why the
script prints a reminder.

## The website

`site/` is plain HTML, CSS and JS with no build step, deployed on its own with
the repository root set to that folder. It serves the landing page, the invite
page that a shared link opens, and `.well-known/assetlinks.json`, which is what
lets a verified install skip the page and open the app directly. Its own README
covers the download logic and why the pages read a local `release.json` instead
of calling the GitHub API.

Preview it locally with any static server.

```bash
python -m http.server 4321 --directory site
```

## Further reading

- `RELEASE_NOTES.md` covers what changed in the current release.
- `site/README.md` covers the landing page and the release flow.
- Individual modules carry long comments explaining why they are the shape they
  are. Those are the real documentation.

## Limitations

- Android only. The background journey tracking is a native Android service, and
  the iOS equivalent needs a Live Activity widget extension.
- Distributed as sideloaded APKs, not through the Play Store.
- Swiping the app away from recents ends a journey. That is intended: it is the
  discoverable way to stop everything.
- Native crashes are not reported. A process killed by the OS never runs the JS
  that would record it.

## License

All rights reserved. The source is public to be read, not to be reused: it is
not open source, and no permission to copy, modify, redistribute or build on
it is granted. See `LICENSE` for the exact terms, and ask if you want
something the license does not allow.
