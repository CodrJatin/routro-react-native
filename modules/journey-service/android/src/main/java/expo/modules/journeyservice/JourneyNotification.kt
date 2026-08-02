package expo.modules.journeyservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.view.View
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat

/**
 * Builds the one notification a tracked journey shows.
 *
 * Everything here is rebuilt from scratch on every update rather than mutating
 * a retained Builder: a Builder that outlives an update is a Builder that can
 * carry a stale action or progress bar into the next one, and the whole
 * notification is cheap to construct.
 */
internal object JourneyNotification {
  const val CHANNEL_ID = "routro.journey"
  const val NOTIFICATION_ID = 4817

  /**
   * IMPORTANCE_LOW, and it must stay that way. This notification is replaced
   * every time the user reaches a station; at DEFAULT or above that is a sound
   * and a peek per station for a whole journey, which is how an app gets its
   * notifications switched off. Alerts that genuinely want attention (get off
   * here, change lines) belong on their own channel.
   */
  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return

    val channel = NotificationChannel(
      CHANNEL_ID,
      "Journey progress",
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = "Shown while Routro is following your journey in the background."
      setShowBadge(false)
      enableVibration(false)
      setSound(null, null)
    }
    manager.createNotificationChannel(channel)
  }

  fun build(context: Context, content: JourneyNotificationContent): Notification {
    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(smallIconRes(context))
      .setContentTitle(content.title)
      .setOngoing(true)
      // Without this, every station replaces the notification loudly enough to
      // re-announce itself even on a low-importance channel.
      .setOnlyAlertOnce(true)
      .setSilent(true)
      // A fixed timestamp beside text that moves reads as staleness, and the
      // arrival time is already in the body in the words the user picked it by.
      .setShowWhen(false)
      .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
      // Show immediately instead of after the system's 10s grace period --
      // the user just pressed Start and expects to see it.
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      // Legible on the lock screen, which is where it will mostly be read.
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)

    content.body?.let { builder.setContentText(it) }
    content.subText?.let { builder.setSubText(it) }

    // Tints the small icon and the app name, and nothing else. Deliberately
    // NOT colorized: a whole notification flooded with the line's colour is a
    // different app's design language, and this one is monochrome with the
    // colour used sparingly and only where it means something.
    parseNotificationColor(content.color)?.let { builder.setColor(it) }

    applyMeter(context, builder, content)

    launchIntent(context)?.let { builder.setContentIntent(it) }

    if (content.showStopAction) {
      builder.addAction(
        NotificationCompat.Action.Builder(0, "Stop", stopIntent(context)).build()
      )
    }

    return builder.build()
  }

  /**
   * The journey meter, drawn by hand into the expanded notification.
   *
   * Android's own progress bars -- the plain one and Android 16's segmented
   * tracker alike -- are rounded capsules, and their corner radius is not ours
   * to set. This app has square corners everywhere, so the meter is drawn
   * instead: see JourneyMeter for what it is made of.
   *
   * Only the expanded view is ours. Collapsed stays the platform's standard
   * template -- title and text -- which is already monochrome and already
   * square.
   */
  private fun applyMeter(
    context: Context,
    builder: NotificationCompat.Builder,
    content: JourneyNotificationContent
  ) {
    val meter = JourneyMeter.draw(context, content) ?: return

    val views = RemoteViews(context.packageName, R.layout.journey_notification)
    views.setTextViewText(R.id.journey_title, content.title)
    views.setTextViewText(R.id.journey_body, content.body ?: "")
    views.setViewVisibility(
      R.id.journey_body,
      if (content.body.isNullOrEmpty()) View.GONE else View.VISIBLE
    )
    views.setImageViewBitmap(R.id.journey_meter, meter)
    views.setContentDescription(R.id.journey_meter, JourneyMeter.describe(content))

    builder.setStyle(NotificationCompat.DecoratedCustomViewStyle())
    builder.setCustomBigContentView(views)
  }

  private fun launchIntent(context: Context): PendingIntent? {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: return null
    // SINGLE_TOP so tapping the notification returns to the running app rather
    // than starting a second copy of it on top of itself.
    intent.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
    return PendingIntent.getActivity(
      context,
      REQUEST_LAUNCH,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun stopIntent(context: Context): PendingIntent {
    val intent = Intent(context, JourneyActionReceiver::class.java).apply {
      action = JourneyActionReceiver.ACTION_STOP
      // Explicit package: an implicit broadcast would be dropped on O+.
      `package` = context.packageName
    }
    return PendingIntent.getBroadcast(
      context,
      REQUEST_STOP,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  /**
   * `notification_icon` is generated by the expo-notifications config plugin
   * from the monochrome source image named in app.json. The launcher-icon
   * fallback only applies if that plugin is ever removed, and renders as a
   * solid white square -- Android requires small icons to be monochrome.
   */
  private fun smallIconRes(context: Context): Int {
    val generated = context.resources.getIdentifier(
      "notification_icon",
      "drawable",
      context.packageName
    )
    return if (generated != 0) generated else context.applicationInfo.icon
  }

  private const val REQUEST_LAUNCH = 0
  private const val REQUEST_STOP = 1
}
