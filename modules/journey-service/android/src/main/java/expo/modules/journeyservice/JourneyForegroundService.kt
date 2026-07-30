package expo.modules.journeyservice

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.ServiceCompat

/**
 * A `location`-typed foreground service, which is the only way an Android app
 * keeps receiving location at full rate once it is backgrounded. Everything
 * else in this feature -- broadcasting to friends, journey progress, arrival
 * alerts -- works in the background because this is running, not because those
 * parts do anything special.
 *
 * It does not itself request location. The app's existing watcher keeps
 * running; while this service is up, the whole process counts as foreground
 * for location purposes.
 */
class JourneyForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_START) {
      showNotification(JourneyNotificationContent.fromIntent(intent))
      startTicking(intent.getLongExtra(EXTRA_TICK_INTERVAL_MS, 0L))
    }
    // NOT sticky. A journey the user is no longer on is worse than no journey,
    // and a restarted service would have no route, no position and no way to
    // get either -- see onTaskRemoved.
    return START_NOT_STICKY
  }

  /**
   * Replaces the notification in place.
   *
   * Calls `startForeground` again rather than posting through
   * NotificationManager, which matters for two reasons: it needs no
   * POST_NOTIFICATIONS permission, and it is not a service *start*, so it is
   * allowed from the background. Updating the notification with the phone
   * locked in someone's pocket is the entire point of this module.
   */
  fun update(content: JourneyNotificationContent) {
    if (instance !== this) return
    showNotification(content)
  }

  fun stopJourney() {
    stopTicking()
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  /**
   * Ticks on the main Looper, which keeps running while the app is
   * backgrounded and the screen is off -- unlike React Native's JS timers, and
   * unlike anything driven off the Choreographer, whose frame callbacks stop
   * with the display. See JourneyServiceBus.tickListener.
   */
  private fun startTicking(intervalMs: Long) {
    stopTicking()
    if (intervalMs <= 0L) return
    tickIntervalMs = intervalMs
    tickHandler.postDelayed(tickRunnable, intervalMs)
  }

  private fun stopTicking() {
    tickHandler.removeCallbacks(tickRunnable)
  }

  /**
   * Swiping the app out of recents ends the journey. That is intended: it
   * gives the user an obvious way to stop everything, and it means we never
   * have to keep a JS runtime alive across the activity being destroyed.
   *
   * The notification must go with it -- an ongoing notification still claiming
   * to track a journey, backed by a process that no longer exists, is the
   * worst outcome available here.
   */
  override fun onTaskRemoved(rootIntent: Intent?) {
    JourneyServiceBus.emit(ACTION_TASK_REMOVED)
    stopJourney()
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    stopTicking()
    // Guarded: a fast stop/start can construct the new service before the old
    // one is destroyed, and clearing unconditionally would null out the live
    // one's reference.
    if (instance === this) instance = null
    super.onDestroy()
  }

  private val tickHandler = Handler(Looper.getMainLooper())
  private var tickIntervalMs = 0L

  // Reschedules itself rather than using a fixed-rate timer, so a slow tick
  // can't queue up a backlog of them behind it.
  private val tickRunnable = object : Runnable {
    override fun run() {
      JourneyServiceBus.emitTick(System.currentTimeMillis())
      tickHandler.postDelayed(this, tickIntervalMs)
    }
  }

  private fun showNotification(content: JourneyNotificationContent) {
    JourneyNotification.ensureChannel(this)
    ServiceCompat.startForeground(
      this,
      JourneyNotification.NOTIFICATION_ID,
      JourneyNotification.build(this, content),
      ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
    )
  }

  companion object {
    const val ACTION_START = "expo.modules.journeyservice.START"
    const val EXTRA_TICK_INTERVAL_MS = "tickIntervalMs"
    const val ACTION_STOPPED_BY_USER = "stop"
    const val ACTION_TASK_REMOVED = "taskRemoved"

    /**
     * Same process as the Expo module, so a direct reference is how updates
     * reach the running service. Deliberately not a started-intent round trip:
     * `startForegroundService` from the background throws on Android 12+, which
     * is exactly when we most need to update the notification.
     */
    @Volatile
    var instance: JourneyForegroundService? = null
      private set
  }
}
