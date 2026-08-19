package expo.modules.journeyservice

import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Android refused to start the service. Overwhelmingly this means the call
 * came from the background, which the platform blocks outright from Android 12
 * -- so it is reported as its own failure rather than an unexpected error. */
class ForegroundServiceStartException(cause: Throwable) :
  CodedException(
    "Couldn't start the journey foreground service. It can only be started while the app is in the foreground.",
    cause
  )

class JourneyServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("JourneyService")

    Events("onAction", "onTick", "onLocation")

    OnCreate {
      JourneyServiceBus.listener = { action ->
        sendEvent("onAction", mapOf("action" to action))
      }
      JourneyServiceBus.tickListener = { at ->
        sendEvent("onTick", mapOf("at" to at))
      }
      JourneyServiceBus.locationListener = { fix ->
        sendEvent(
          "onLocation",
          mapOf(
            "lat" to fix.latitude,
            "lon" to fix.longitude,
            "accuracy" to fix.accuracy,
            "at" to fix.at
          )
        )
      }
    }

    OnDestroy {
      JourneyServiceBus.listener = null
      JourneyServiceBus.tickListener = null
      JourneyServiceBus.locationListener = null
    }

    /**
     * Must be called while the app is in the foreground -- Android 12+ blocks
     * starting a foreground service from the background, with no way to ask
     * for an exemption. That constraint is why journeys begin on an explicit
     * "Start journey" tap rather than starting themselves.
     */
    AsyncFunction("startAsync") {
        content: JourneyNotificationContent,
        tickIntervalMs: Long,
        locationIntervalMs: Long ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      JourneyNotification.ensureChannel(context)

      val intent = Intent(context, JourneyForegroundService::class.java).apply {
        action = JourneyForegroundService.ACTION_START
        content.writeTo(this)
        putExtra(JourneyForegroundService.EXTRA_TICK_INTERVAL_MS, tickIntervalMs)
        putExtra(JourneyForegroundService.EXTRA_LOCATION_INTERVAL_MS, locationIntervalMs)
      }

      try {
        ContextCompat.startForegroundService(context, intent)
      } catch (e: Exception) {
        throw ForegroundServiceStartException(e)
      }
    }

    /** Returns false when no journey is running, so the caller can reconcile
     * instead of assuming the notification it just rendered is on screen. */
    AsyncFunction("updateAsync") { content: JourneyNotificationContent ->
      val service = JourneyForegroundService.instance ?: return@AsyncFunction false
      service.update(content)
      true
    }

    AsyncFunction("stopAsync") {
      val service = JourneyForegroundService.instance
      if (service != null) {
        service.stopJourney()
      } else {
        // Nothing running in this process, but a notification can outlive one
        // -- ask the system to stop the service regardless.
        val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
        context.stopService(Intent(context, JourneyForegroundService::class.java))
      }
    }

    /**
     * Starts (or restarts) the journey's GPS feed, at the same interval the
     * app's other watchers use.
     *
     * Separate from `startAsync` on purpose: this is also the retry, so a
     * provider that stopped mid-journey is rebuilt through exactly the call
     * that built it in the first place.
     *
     * Resolves to null once updates are running, or to why they are not -- the
     * caller retries a few times and then ends the journey rather than
     * following one it cannot see.
     */
    AsyncFunction("startLocationUpdatesAsync") { intervalMs: Long ->
      val service = JourneyForegroundService.instance
        ?: return@AsyncFunction "The journey notification is no longer running."
      service.startLocationUpdates(intervalMs)
    }

    Function("isRunning") {
      JourneyForegroundService.instance != null
    }
  }
}
