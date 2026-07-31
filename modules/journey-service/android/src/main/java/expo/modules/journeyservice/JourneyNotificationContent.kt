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
 * One stretch of the tracker, drawn in its own colour.
 *
 * A journey's segments are its legs, and `length` is that leg's share of the
 * whole bar in stations -- so the tracker is the route's own line colours in
 * their real proportions rather than a generic blue bar. Lengths must sum to
 * the journey's station count, since the platform derives the bar's maximum
 * from them rather than taking one.
 */
class JourneyTrackerSegment : Record {
  @Field var length: Int = 0

  /** `#RRGGBB`. Omitted leaves the platform default. */
  @Field var color: String? = null
}

/** A marker sitting *on* the tracker at `position` stations in -- an
 * interchange, coloured with the line being changed to. */
class JourneyTrackerPoint : Record {
  @Field var position: Int = 0

  @Field var color: String? = null
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

  /** Sits in the notification's header line, beside the app name. */
  @Field var subText: String? = null

  @Field var progress: JourneyProgress? = null

  /** Drawn as the Android 16 segmented tracker where that exists, and ignored
   * on older versions, which fall back to `progress`'s plain bar. */
  @Field var segments: List<JourneyTrackerSegment> = emptyList()

  @Field var points: List<JourneyTrackerPoint> = emptyList()

  /** Epoch ms of arrival. Turns the notification's timestamp into a countdown
   * the system ticks down by itself -- the one part of this that stays live
   * between our updates rather than because of them. */
  @Field var countdownToMs: Double? = null

  /** `#RRGGBB` or `#AARRGGBB`. Tints the notification -- the metro line's
   * colour, so the notification reads as belonging to the journey. */
  @Field var color: String? = null

  @Field var showStopAction: Boolean = true

  /**
   * Flattened into primitives rather than sent as a Serializable, because the
   * only consumer is our own service in our own process and a handful of
   * extras is cheaper to reason about than a serialization contract. Segments
   * and points travel as parallel arrays for the same reason -- an empty
   * string stands in for "no colour", which is not a colour anyone can send.
   */
  fun writeTo(intent: Intent) {
    intent.putExtra(EXTRA_TITLE, title)
    intent.putExtra(EXTRA_BODY, body)
    intent.putExtra(EXTRA_SUB_TEXT, subText)
    intent.putExtra(EXTRA_COLOR, color)
    intent.putExtra(EXTRA_SHOW_STOP_ACTION, showStopAction)
    // -1 rather than a separate "hasProgress" flag: a max of 0 would be a
    // legitimate-looking but undrawable bar, so absence needs its own value.
    intent.putExtra(EXTRA_PROGRESS_CURRENT, progress?.current ?: -1)
    intent.putExtra(EXTRA_PROGRESS_MAX, progress?.max ?: -1)
    intent.putExtra(EXTRA_COUNTDOWN_TO_MS, countdownToMs ?: 0.0)
    intent.putExtra(EXTRA_SEGMENT_LENGTHS, segments.map { it.length }.toIntArray())
    intent.putExtra(EXTRA_SEGMENT_COLORS, segments.map { it.color ?: "" }.toTypedArray())
    intent.putExtra(EXTRA_POINT_POSITIONS, points.map { it.position }.toIntArray())
    intent.putExtra(EXTRA_POINT_COLORS, points.map { it.color ?: "" }.toTypedArray())
  }

  companion object {
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_BODY = "body"
    private const val EXTRA_SUB_TEXT = "subText"
    private const val EXTRA_COLOR = "color"
    private const val EXTRA_SHOW_STOP_ACTION = "showStopAction"
    private const val EXTRA_PROGRESS_CURRENT = "progressCurrent"
    private const val EXTRA_PROGRESS_MAX = "progressMax"
    private const val EXTRA_COUNTDOWN_TO_MS = "countdownToMs"
    private const val EXTRA_SEGMENT_LENGTHS = "segmentLengths"
    private const val EXTRA_SEGMENT_COLORS = "segmentColors"
    private const val EXTRA_POINT_POSITIONS = "pointPositions"
    private const val EXTRA_POINT_COLORS = "pointColors"

    fun fromIntent(intent: Intent): JourneyNotificationContent {
      val content = JourneyNotificationContent()
      content.title = intent.getStringExtra(EXTRA_TITLE) ?: ""
      content.body = intent.getStringExtra(EXTRA_BODY)
      content.subText = intent.getStringExtra(EXTRA_SUB_TEXT)
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

      val countdown = intent.getDoubleExtra(EXTRA_COUNTDOWN_TO_MS, 0.0)
      if (countdown > 0.0) content.countdownToMs = countdown

      val segmentLengths = intent.getIntArrayExtra(EXTRA_SEGMENT_LENGTHS) ?: IntArray(0)
      val segmentColors = intent.getStringArrayExtra(EXTRA_SEGMENT_COLORS) ?: emptyArray()
      content.segments = segmentLengths.mapIndexed { index, length ->
        JourneyTrackerSegment().also {
          it.length = length
          it.color = segmentColors.getOrNull(index)?.ifEmpty { null }
        }
      }

      val pointPositions = intent.getIntArrayExtra(EXTRA_POINT_POSITIONS) ?: IntArray(0)
      val pointColors = intent.getStringArrayExtra(EXTRA_POINT_COLORS) ?: emptyArray()
      content.points = pointPositions.mapIndexed { index, position ->
        JourneyTrackerPoint().also {
          it.position = position
          it.color = pointColors.getOrNull(index)?.ifEmpty { null }
        }
      }

      return content
    }
  }
}
