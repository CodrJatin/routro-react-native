package expo.modules.journeyservice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Handles the notification's Stop button.
 *
 * Declared in the manifest rather than registered from JS on purpose: the
 * button has to work even if the JS runtime is gone, and a receiver that only
 * exists while React is mounted would leave a Stop button that silently does
 * nothing. Stopping the service is done here; telling JS about it is
 * best-effort on top.
 */
class JourneyActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION_STOP) return

    // Emitted before the service goes away, so a listening JS layer can tear
    // its own session down rather than discovering the service missing later.
    JourneyServiceBus.emit(JourneyForegroundService.ACTION_STOPPED_BY_USER)

    val service = JourneyForegroundService.instance
    if (service != null) {
      service.stopJourney()
    } else {
      // No live instance to ask -- the service is mid-teardown, or this is a
      // notification left over from a process that has since died. Telling the
      // system to stop it is harmless either way.
      context.stopService(Intent(context, JourneyForegroundService::class.java))
    }
  }

  companion object {
    const val ACTION_STOP = "expo.modules.journeyservice.STOP"
  }
}
