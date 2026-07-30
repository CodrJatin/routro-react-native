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

  fun emit(action: String) {
    listener?.invoke(action)
  }
}
