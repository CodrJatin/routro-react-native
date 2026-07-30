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

    Events("onAction", "onTick")

    OnCreate {
      JourneyServiceBus.listener = { action ->
        sendEvent("onAction", mapOf("action" to action))
      }
      JourneyServiceBus.tickListener = { at ->
        sendEvent("onTick", mapOf("at" to at))
      }
    }

    OnDestroy {
      JourneyServiceBus.listener = null
      JourneyServiceBus.tickListener = null
    }

    /**
     * Must be called while the app is in the foreground -- Android 12+ blocks
     * starting a foreground service from the background, with no way to ask
     * for an exemption. That constraint is why journeys begin on an explicit
     * "Start journey" tap rather than starting themselves.
     */
    AsyncFunction("startAsync") { content: JourneyNotificationContent, tickIntervalMs: Long ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      JourneyNotification.ensureChannel(context)

      val intent = Intent(context, JourneyForegroundService::class.java).apply {
        action = JourneyForegroundService.ACTION_START
        content.writeTo(this)
        putExtra(JourneyForegroundService.EXTRA_TICK_INTERVAL_MS, tickIntervalMs)
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

    Function("isRunning") {
      JourneyForegroundService.instance != null
    }
  }
}
