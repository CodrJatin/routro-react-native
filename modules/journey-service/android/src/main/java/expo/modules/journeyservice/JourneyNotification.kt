package expo.modules.journeyservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
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
  const val CHANNEL_ID = "metrosync.journey"
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
      description = "Shown while MetroSync is following your journey in the background."
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
      // Off unless a countdown replaces it below: a fixed timestamp beside
      // text that moves reads as staleness.
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
    parseColor(content.color)?.let { builder.setColor(it) }

    // The one thing on this notification that stays alive between our updates.
    // Stations are minutes apart, so without it the whole surface is frozen
    // for minutes at a time; with it the arrival counts itself down every
    // second, drawn by the system at no cost to a sleeping process.
    content.countdownToMs?.let {
      builder
        .setWhen(it.toLong())
        .setShowWhen(true)
        .setUsesChronometer(true)
        .setChronometerCountDown(true)
    }

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
   * The station meter, drawn by hand into the expanded notification.
   *
   * Android's own progress bars -- the plain one and Android 16's segmented
   * tracker alike -- are rounded capsules, and their corner radius is not
   * ours to set. This app has square corners everywhere, so the meter is built
   * from flat weighted ticks instead: one per station, the ones behind you
   * filled in their line's colour, the ones ahead left as faint ink, and the
   * itinerary's diamond standing where you are now. The bar therefore colours
   * itself in as the journey is travelled.
   *
   * Only the expanded view is ours. Collapsed stays the platform's standard
   * template -- title, text and the countdown -- which is already monochrome
   * and already square.
   */
  private fun applyMeter(
    context: Context,
    builder: NotificationCompat.Builder,
    content: JourneyNotificationContent
  ) {
    val progress = content.progress ?: return
    // No segments means no fix, and a meter with no marker on it would be a
    // picture of a journey nobody is on. The collapsed template still says
    // everything true in that state.
    if (content.segments.isEmpty()) return

    val views = RemoteViews(context.packageName, R.layout.journey_notification)
    views.setTextViewText(R.id.journey_title, content.title)
    views.setTextViewText(R.id.journey_body, content.body ?: "")
    views.setViewVisibility(
      R.id.journey_body,
      if (content.body.isNullOrEmpty()) View.GONE else View.VISIBLE
    )

    val stationColors = stationColors(content, progress.max)
    val interchanges = content.points.associate { it.position to parseColor(it.color) }

    for (index in 0..progress.max) {
      views.addView(R.id.journey_meter, tickFor(context, content, index, stationColors, interchanges))
    }

    builder.setStyle(NotificationCompat.DecoratedCustomViewStyle())
    builder.setCustomBigContentView(views)
  }

  private fun tickFor(
    context: Context,
    content: JourneyNotificationContent,
    index: Int,
    stationColors: IntArray,
    interchanges: Map<Int, Int?>
  ): RemoteViews {
    val current = content.progress?.current ?: -1

    if (index == current) {
      val tick = RemoteViews(context.packageName, R.layout.journey_tick_current)
      // The whole slot, not half of it: the track runs under the marker in one
      // colour and simply stops there. Splitting it left the leg being ridden
      // looking like it ended a marker's width short of where the user is.
      if (stationColors[index] != NO_COLOR) {
        tick.setInt(R.id.journey_tick_track, "setBackgroundColor", stationColors[index])
      }
      // A change under the marker shows as a square beneath it. This is the
      // only colour allowed past the diamond, and it is contained by the
      // square rather than running on down the bar.
      interchanges[index]?.let {
        tick.setViewVisibility(R.id.journey_tick_change, View.VISIBLE)
        tick.setInt(R.id.journey_tick_change, "setBackgroundColor", it)
      }
      return tick
    }

    if (interchanges.containsKey(index)) {
      val tick = RemoteViews(context.packageName, R.layout.journey_tick_interchange)
      // Coloured whether or not it is behind you: which platform to look for
      // is worth knowing before you get there, not only after.
      interchanges[index]?.let { tick.setInt(R.id.journey_tick, "setBackgroundColor", it) }
      return tick
    }

    val tick = RemoteViews(context.packageName, R.layout.journey_tick)
    if (index < current && stationColors[index] != NO_COLOR) {
      tick.setInt(R.id.journey_tick, "setBackgroundColor", stationColors[index])
    }
    return tick
  }

  /**
   * The line colour each station belongs to, by index along the journey.
   *
   * Segments arrive as lengths rather than as per-station colours, because that
   * is what a bar wants; this unrolls them. Their lengths sum to the last
   * index rather than to the station count -- a segment spans the gaps between
   * stations, not the stations themselves -- so the destination takes the
   * colour of the leg that reaches it.
   */
  private fun stationColors(content: JourneyNotificationContent, max: Int): IntArray {
    val colors = IntArray(max + 1) { NO_COLOR }
    var index = 0
    for (segment in content.segments) {
      val color = parseColor(segment.color) ?: NO_COLOR
      repeat(segment.length) {
        if (index <= max) colors[index++] = color
      }
    }
    if (max >= 0 && colors[max] == NO_COLOR && index > 0) colors[max] = colors[index - 1]
    return colors
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

  private fun parseColor(color: String?): Int? {
    if (color == null) return null
    return try {
      Color.parseColor(color)
    } catch (e: IllegalArgumentException) {
      // A bad colour is a cosmetic problem; refusing to show the notification
      // over it would not be.
      null
    }
  }

  private const val REQUEST_LAUNCH = 0
  private const val REQUEST_STOP = 1

  /** No colour was sent for this station. Not `Color.TRANSPARENT`, which is a
   * colour someone could legitimately mean. */
  private const val NO_COLOR = 1
}
