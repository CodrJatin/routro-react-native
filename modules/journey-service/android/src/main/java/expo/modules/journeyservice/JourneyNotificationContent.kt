package expo.modules.journeyservice

import android.content.Intent
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** How far along the journey the progress bar sits, in stations. */
class JourneyProgress : Record {
  @Field var current: Int = 0

  @Field var max: Int = 0
}

/**
 * Everything the ongoing notification renders.
 *
 * Deliberately dumb: it carries finished strings, not a route. What the
 * notification *says* is decided in JS, where the route, the clock and the
 * user's position already live -- duplicating that reasoning in Kotlin would
 * give us two sources of truth for the same sentence.
 */
class JourneyNotificationContent : Record {
  @Field var title: String = ""

  @Field var body: String? = null

  @Field var progress: JourneyProgress? = null

  /** `#RRGGBB` or `#AARRGGBB`. Tints the notification -- the metro line's
   * colour, so the notification reads as belonging to the journey. */
  @Field var color: String? = null

  @Field var showStopAction: Boolean = true

  /**
   * Flattened into primitives rather than sent as a Serializable, because the
   * only consumer is our own service in our own process and a handful of
   * extras is cheaper to reason about than a serialization contract.
   */
  fun writeTo(intent: Intent) {
    intent.putExtra(EXTRA_TITLE, title)
    intent.putExtra(EXTRA_BODY, body)
    intent.putExtra(EXTRA_COLOR, color)
    intent.putExtra(EXTRA_SHOW_STOP_ACTION, showStopAction)
    // -1 rather than a separate "hasProgress" flag: a max of 0 would be a
    // legitimate-looking but undrawable bar, so absence needs its own value.
    intent.putExtra(EXTRA_PROGRESS_CURRENT, progress?.current ?: -1)
    intent.putExtra(EXTRA_PROGRESS_MAX, progress?.max ?: -1)
  }

  companion object {
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_BODY = "body"
    private const val EXTRA_COLOR = "color"
    private const val EXTRA_SHOW_STOP_ACTION = "showStopAction"
    private const val EXTRA_PROGRESS_CURRENT = "progressCurrent"
    private const val EXTRA_PROGRESS_MAX = "progressMax"

    fun fromIntent(intent: Intent): JourneyNotificationContent {
      val content = JourneyNotificationContent()
      content.title = intent.getStringExtra(EXTRA_TITLE) ?: ""
      content.body = intent.getStringExtra(EXTRA_BODY)
      content.color = intent.getStringExtra(EXTRA_COLOR)
      content.showStopAction = intent.getBooleanExtra(EXTRA_SHOW_STOP_ACTION, true)

      val current = intent.getIntExtra(EXTRA_PROGRESS_CURRENT, -1)
      val max = intent.getIntExtra(EXTRA_PROGRESS_MAX, -1)
      if (current >= 0 && max > 0) {
        content.progress = JourneyProgress().also {
          it.current = current
          it.max = max
        }
      }

      return content
    }
  }
}
