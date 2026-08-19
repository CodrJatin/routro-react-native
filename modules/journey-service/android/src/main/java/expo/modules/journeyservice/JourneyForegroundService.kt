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
 * It also owns the journey's GPS feed -- see `JourneyLocationUpdates` for why
 * that is not left to expo-location. Everything that keeps working while the
 * phone is in a pocket hangs off this one component: the location fixes, the
 * tick that drives every periodic job in JS, and the notification itself.
 */
class JourneyForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    locationUpdates = JourneyLocationUpdates(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_START) {
      showNotification(JourneyNotificationContent.fromIntent(intent))
      startTicking(intent.getLongExtra(EXTRA_TICK_INTERVAL_MS, 0L))
      // Here rather than only on JS's request, because `startForegroundService`
      // returns before the system has actually created this service -- so the
      // journey controller's own call can arrive while `instance` is still
      // null and be answered with a failure for a journey that is starting
      // perfectly well. Starting from inside the service is the one moment
      // that cannot race. JS asserts it again immediately afterwards, which is
      // a restart of a feed that is already running and costs nothing.
      //
      // After `showNotification`, never before: from Android 14 a service may
      // only request location once it has declared itself foreground with
      // FOREGROUND_SERVICE_TYPE_LOCATION.
      startLocationUpdates(intent.getLongExtra(EXTRA_LOCATION_INTERVAL_MS, 0L))
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

  /**
   * Starts (or restarts) the journey's location updates at `intervalMs`.
   *
   * Also the retry: the journey controller's `startWatcher` calls this both
   * to start the feed and to rebuild one that failed, so a provider that died
   * mid-journey and one that never started take the same route back.
   *
   * Safe to call from the background, unlike starting the service itself:
   * requesting location from a service that is already in the foreground with
   * `FOREGROUND_SERVICE_TYPE_LOCATION` is not a service start.
   *
   * Null means the updates are running; anything else is why they are not.
   * Note that null is also what `start` returns on success, so the missing-
   * client case has to be its own early return -- folding the two together
   * with an elvis reports every successful start as a failure.
   */
  fun startLocationUpdates(intervalMs: Long): String? {
    if (instance !== this || intervalMs <= 0L) {
      return "The journey notification is no longer running."
    }
    val updates = locationUpdates ?: return "This device can't follow a journey."
    return updates.start(intervalMs)
  }

  fun stopJourney() {
    stopTicking()
    locationUpdates?.stop()
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
    locationUpdates?.stop()
    // Guarded: a fast stop/start can construct the new service before the old
    // one is destroyed, and clearing unconditionally would null out the live
    // one's reference.
    if (instance === this) instance = null
    super.onDestroy()
  }

  private val tickHandler = Handler(Looper.getMainLooper())
  private var tickIntervalMs = 0L
  private var locationUpdates: JourneyLocationUpdates? = null

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
    const val EXTRA_LOCATION_INTERVAL_MS = "locationIntervalMs"
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
