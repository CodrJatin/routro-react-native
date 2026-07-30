package expo.modules.journeyservice

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

  fun emit(action: String) {
    listener?.invoke(action)
  }

  fun emitTick(at: Long) {
    tickListener?.invoke(at)
  }
}
