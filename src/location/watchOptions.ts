import * as Location from 'expo-location';

/**
 * The one set of GPS options every watcher in this app uses.
 *
 * There are three of them -- the map screen's, the broadcast manager's and the
 * journey controller's -- and only ever one running at a time, chosen by what
 * is already awake rather than by what the screen wants (see `selfPosition.ts`).
 * They all write to the same store, so the user's position must not change
 * character depending on which one happens to be the live one.
 *
 * A fourth source reads these same numbers without going through this file:
 * on Android the journey's fixes come from the foreground service's own
 * location client (`JourneyLocationUpdates.kt`), which cannot use an
 * expo-location watch because that module tears its watches down whenever the
 * activity is backgrounded. `journeyController` hands it `LOCATION_INTERVAL_MS`
 * and the Kotlin mirrors the accuracy and the distance filter, so a journey
 * fix is the same fix by a different route -- change one of these and change
 * that too.
 *
 * It did. Each file carried its own copy of these numbers and they drifted:
 * the map's watcher filtered at 0 metres while the other two filtered at 15,
 * so turning sharing on -- or starting a journey -- silently swapped the live
 * feed for a coarser one and the pin froze. Defining them once is the fix, and
 * the reason this module exists at all.
 */

/**
 * How often the OS may deliver a fix. Android only; iOS has no equivalent
 * option and simply delivers what the accuracy setting produces.
 *
 * Also the journey service's tick interval, deliberately -- see
 * `TICK_INTERVAL_MS` in `journeyController.ts` for what else hangs off it --
 * and the interval that same service requests its own location updates at.
 */
export const LOCATION_INTERVAL_MS = 5000;

/**
 * Zero, meaning "deliver every fix you compute".
 *
 * `distanceInterval` is a hard filter inside the OS, not a hint. Android maps
 * it to `setMinUpdateDistanceMeters` and iOS to `CLLocationManager.distanceFilter`,
 * and neither delivers anything at all until the device has moved that far --
 * `timeInterval` does not override it, and iOS ignores that option entirely.
 *
 * At the 15 metres two of these watchers used to carry, a user standing on a
 * platform produced no fixes whatsoever. That is indistinguishable from a dead
 * watcher: their own pin aged out to stale (`SELF_POSITION_STALE_AFTER_MS`)
 * and the journey notification's arrival times quietly went off, all for the
 * offence of standing still -- which is precisely what people do on platforms.
 *
 * Turning the filter off costs no extra power. The provider is already running
 * at `LOCATION_INTERVAL_MS` and has already computed the fix; the filter only
 * decides whether the result is handed over or thrown away. Rate-limiting that
 * genuinely does cost something -- putting a fix on the network -- belongs in
 * JS where it can be applied per-consumer, and lives in `locationChannel.ts`.
 */
export const LOCATION_DISTANCE_METERS = 0;

/**
 * Accurate to within ~10 metres, per the expo-location docs for SDK 57.
 *
 * Previously `Balanced`, which the same docs put at ~100 metres and which
 * Android serves from wifi and cell towers without necessarily powering up
 * GPS at all. That is not enough to run this app on: Delhi Metro stations sit
 * about a kilometre apart, `AT_STATION_METERS` is 300 and
 * `MAX_ON_ROUTE_DISTANCE_METERS` is 1500, so a 100-metre error budget was
 * already eating a third of the window used to decide which station someone is
 * standing at -- and underground, where cell fixes snap to a tower centroid
 * and barely move, it read as the position being frozen entirely.
 *
 * The cost is real and is the honest price of the feature: this engages GPS
 * properly. It is bounded, though -- a watcher only runs while the map is open,
 * while sharing is on, or while a journey is being followed, never at rest.
 */
export const LOCATION_ACCURACY = Location.Accuracy.High;

/**
 * @param mayShowUserSettingsDialog Off everywhere by default, and every caller
 * currently leaves it off. expo-location defaults it to true, which lets a
 * watcher open Play services' "turn on location?" dialog by itself -- including
 * from paths the user never tapped anything to reach, such as a background
 * resume or the map simply coming into view, and repeatedly, since these
 * watchers retry. Asking to switch location on belongs to the moment the user
 * asks for something that needs it, which is handled in `locationChannel.ts`
 * and `journeyController.ts`.
 */
export function watchOptions(
  overrides: Partial<Location.LocationOptions> = {},
): Location.LocationOptions {
  return {
    accuracy: LOCATION_ACCURACY,
    timeInterval: LOCATION_INTERVAL_MS,
    distanceInterval: LOCATION_DISTANCE_METERS,
    mayShowUserSettingsDialog: false,
    ...overrides,
  };
}

/** How often to log a fix's own accuracy. Every fix would be a line every five
 * seconds for a whole journey, which buries everything else in the log; one a
 * minute is enough to see what the provider is actually giving us and how it
 * changes between a platform, a tunnel and an elevated section. */
const ACCURACY_LOG_INTERVAL_MS = 60_000;

let lastAccuracyLogAt = 0;

/**
 * Logs the radius of uncertainty the OS reports on a fix, occasionally.
 *
 * The one number that settles what is actually wrong when tracking misbehaves,
 * and nothing was recording it. "The pin is frozen" has at least three causes
 * that look identical from the outside -- a coarse permission grant, a
 * provider serving cell-tower fixes, and genuinely no signal -- and they want
 * opposite fixes. The reported accuracy tells them apart immediately: ~10m is
 * GPS working, ~100m is a network fix, ~1000m or worse means the fix is
 * useless for deciding which station someone is standing at, whatever the app
 * does with it.
 *
 * Called from all three watchers, so whichever one is live produces the same
 * evidence. Cheap enough to leave in permanently at this interval, and worth
 * far more than reasoning about a ride after the fact.
 */
export function logFixAccuracy(source: string, accuracy: number | null | undefined): void {
  const now = Date.now();
  if (now - lastAccuracyLogAt < ACCURACY_LOG_INTERVAL_MS) return;
  lastAccuracyLogAt = now;
  // Undefined as well as null: the type says `number | null`, but a provider
  // that simply omits it would otherwise log `NaNm`, which reads as a value
  // rather than as an absence and is the opposite of what this is for.
  const reading = typeof accuracy === 'number' ? `${Math.round(accuracy)}m` : 'unknown';
  console.warn(`[location] ${source} fix accuracy: ${reading}`);
}

/**
 * Whether Android handed back only "Approximate" location.
 *
 * Android 12 added a Precise/Approximate choice to the permission dialog, and
 * `status === 'granted'` is true for both. Approximate is roughly 1-3km of
 * uncertainty, derived from cell towers, and it updates rarely and snaps
 * between the same handful of points -- so every distance test in this app
 * fails or answers wrongly, the pin appears stuck, and no amount of accuracy
 * or interval tuning can recover it, because the OS is deliberately degrading
 * the fix before we ever see it.
 *
 * It is worth reporting for exactly one reason: it is invisible. It looks
 * identical to a bug in this app, it survives reinstalls of the JS bundle, and
 * the only fix is the user changing it in system settings -- which they will
 * never think to do unless told.
 *
 * iOS has the same idea (`accuracy: 'full' | 'reduced'`) but exposes it under
 * `ios`, and Routro does not yet ask for temporary full accuracy there, so
 * this deliberately only speaks for Android.
 */
export function isCoarseAndroidGrant(
  permissions: Pick<Location.LocationPermissionResponse, 'android'>,
): boolean {
  return permissions.android?.accuracy === 'coarse';
}

/** What to tell the user about a coarse grant. One sentence, actionable, and
 * naming the setting as Android labels it so it can actually be found. */
export const COARSE_GRANT_MESSAGE =
  'Routro only has approximate location, which is accurate to about a kilometre — not enough to tell which station you are at. Turn on "Use precise location" for Routro in Android settings.';
