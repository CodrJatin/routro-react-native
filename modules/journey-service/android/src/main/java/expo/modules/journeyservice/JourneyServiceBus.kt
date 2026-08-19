package expo.modules.journeyservice

/**
 * One GPS fix, on its way from the service to JS.
 *
 * Deliberately not an `android.location.Location`: the module turns this into
 * a JS object and has no use for the twenty other fields on that class, and
 * keeping the seam narrow means the service and the module agree on exactly
 * what a fix is.
 */
internal data class JourneyFix(
  val latitude: Double,
  val longitude: Double,
  /** Radius of uncertainty in metres, or null where the provider omits it.
   * JS logs this to tell a real GPS fix (~10m) apart from a cell-tower one
   * (~100m) and from an Approximate permission grant (~1km). */
  val accuracy: Double?,
  /** When the fix was taken, ms since epoch on the device clock. */
  val at: Long,
)

/**
 * The one seam between the service/receiver and the Expo module.
 *
 * The notification's Stop button has to work whether or not JS is alive, so the
 * receiver that handles it is declared in the manifest and knows nothing about
 * React. This is how it tells JS about it *when* JS happens to be listening --
 * a null listener is the normal, expected case, not an error.
 */
internal object JourneyServiceBus {
  @Volatile
  var listener: ((String) -> Unit)? = null

  /**
   * The service's native heartbeat.
   *
   * React Native drives `setInterval`/`setTimeout` off a Choreographer frame
   * callback, and `JavaTimerManager.onHostPause` removes that callback the
   * moment the app is backgrounded -- so JS timers simply stop, foreground
   * service or not. Native callbacks into JS are unaffected, because they are
   * posted to the JS thread's Looper rather than scheduled off a frame. This
   * tick is how anything periodic keeps running in the background.
   */
  @Volatile
  var tickListener: ((Long) -> Unit)? = null

  /**
   * The journey's GPS fixes.
   *
   * Same reasoning as the tick, and learned the same way. expo-location's
   * Android module tears every `watchPositionAsync` watch down from
   * `OnActivityEntersBackground` (since 57.0.10 -- before that the same code
   * existed but was never wired up, which is why this app relied on it), so a
   * watcher owned by the activity stops delivering the instant the phone goes
   * in a pocket. This one belongs to the foreground service, which is the
   * component actually holding the process open, and nothing about the
   * activity's lifecycle can reach it.
   */
  @Volatile
  var locationListener: ((JourneyFix) -> Unit)? = null

  fun emit(action: String) {
    listener?.invoke(action)
  }

  fun emitTick(at: Long) {
    tickListener?.invoke(at)
  }

  fun emitLocation(fix: JourneyFix) {
    locationListener?.invoke(fix)
  }
}
