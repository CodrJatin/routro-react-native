package expo.modules.journeyservice

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.TypedValue
import androidx.core.content.ContextCompat
import kotlin.math.roundToInt

/**
 * The journey meter: one bitmap, four layers, drawn by hand.
 *
 * It replaced a row of weighted tick views, one per station. That row could
 * only ever move in whole stations -- the marker jumped a slot at a time and
 * the bar's resolution was the journey's own length, so a four-stop hop drew a
 * four-piece bar. Drawing it instead means the geometry is continuous: the same
 * picture at four stops and forty, and a marker that sits wherever the journey
 * actually is rather than in the nearest available slot.
 *
 * Back to front, matching the live journey card on the map:
 *
 *  1. the whole route, in its line colours knocked back to a ghost -- the shape
 *     of the journey, all of it visible from the first second;
 *  2. the part already travelled, the same colours at full strength, so the bar
 *     colours itself in as the journey is ridden;
 *  3. the interchanges, marked on the track in the colour of the line being
 *     changed *to*, and at full strength whether or not they have been reached
 *     -- which platform to look for is worth knowing before you get there;
 *  4. where you are now: a plain upright bar in the shade's own ink, the one
 *     mark on the meter that isn't a line colour, and therefore the one that
 *     can't be mistaken for part of the route.
 *
 * A bitmap rather than nested views because none of layers 2 to 4 can be
 * positioned at a fraction through RemoteViews: layout weights aren't
 * remotable, so anything view-based is back to snapping to station slots.
 */
internal object JourneyMeter {
  /**
   * Draws the meter, or null when there is no fix to draw -- the collapsed
   * template still says everything true in that state, and a meter with no
   * marker on it would be a picture of a journey nobody is on.
   */
  fun draw(context: Context, content: JourneyNotificationContent): Bitmap? {
    val progress = content.progress ?: return null
    if (progress.max <= 0) return null

    val width = meterWidth(context)
    val height = dp(context, HEIGHT_DP)
    if (width <= 0 || height <= 0) return null

    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val travelled = width * (progress.current.toFloat() / progress.max).coerceIn(0f, 1f)

    drawTrack(context, canvas, content, progress.max, width.toFloat(), height, travelled)
    drawInterchanges(context, canvas, content, progress.max, width.toFloat(), height)
    drawPointer(context, canvas, width.toFloat(), height, travelled)

    return bitmap
  }

  /** What a screen reader gets instead of the picture. */
  fun describe(content: JourneyNotificationContent): String {
    val progress = content.progress ?: return ""
    return "Station ${progress.current} of ${progress.max}"
  }

  /** Layers 1 and 2: the ghosted whole, and the travelled part over it. */
  private fun drawTrack(
    context: Context,
    canvas: Canvas,
    content: JourneyNotificationContent,
    max: Int,
    width: Float,
    height: Int,
    travelled: Float
  ) {
    // Deliberately not anti-aliased. Every edge here is axis-aligned, and
    // feathering them would both soften corners this app keeps square and
    // leave a seam of background showing between adjacent legs.
    val paint = Paint()
    val top = (height - dp(context, TRACK_DP)) / 2f
    val bottom = top + dp(context, TRACK_DP)

    for (span in spans(context, content, max, width)) {
      val left = span.left.roundToInt().toFloat()
      val right = span.right.roundToInt().toFloat()
      if (right <= left) continue

      paint.color = ghost(span.color)
      canvas.drawRect(left, top, right, bottom, paint)

      // Clipped per leg rather than by clipping the canvas once: the boundary
      // sweeps across the legs, so each one is drawn only as far as it has
      // been ridden and the leg it stops in keeps its own colour.
      val filled = travelled.coerceIn(left, right)
      if (filled > left) {
        paint.color = span.color
        canvas.drawRect(left, top, filled, bottom, paint)
      }
    }
  }

  /** Layer 3: a square stood on its corner at every change of line. */
  private fun drawInterchanges(
    context: Context,
    canvas: Canvas,
    content: JourneyNotificationContent,
    max: Int,
    width: Float,
    height: Int
  ) {
    if (content.points.isEmpty()) return

    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    val fallback = ContextCompat.getColor(context, R.color.journey_text_primary)
    val half = dp(context, MARKER_DP) / 2f
    val centerY = height / 2f
    val path = Path()

    for (point in content.points) {
      if (point.position < 0 || point.position > max) continue
      // Clamped so a change at either end of the journey is still a whole
      // marker rather than half of one hanging off the edge of the bitmap.
      val centerX = (width * point.position / max).coerceIn(half, width - half)

      path.reset()
      path.moveTo(centerX, centerY - half)
      path.lineTo(centerX + half, centerY)
      path.lineTo(centerX, centerY + half)
      path.lineTo(centerX - half, centerY)
      path.close()

      paint.color = parseNotificationColor(point.color) ?: fallback
      canvas.drawPath(path, paint)
    }
  }

  /** Layer 4: you, on top of everything else. */
  private fun drawPointer(
    context: Context,
    canvas: Canvas,
    width: Float,
    height: Int,
    travelled: Float
  ) {
    val paint = Paint()
    paint.color = ContextCompat.getColor(context, R.color.journey_text_primary)

    val half = dp(context, POINTER_WIDTH_DP) / 2f
    val centerX = travelled.coerceIn(half, width - half)
    val pointerHeight = dp(context, POINTER_HEIGHT_DP)
    val top = (height - pointerHeight) / 2f

    canvas.drawRect(centerX - half, top, centerX + half, top + pointerHeight, paint)
  }

  /**
   * The journey's legs as pixel spans.
   *
   * Segments arrive as lengths in stations, because that is what a bar wants;
   * this lays them out along the bitmap. A leg spans the *gaps* between its
   * stations rather than the stations themselves, so the lengths sum to the
   * last index and the final leg is stretched to the end -- otherwise the
   * destination would sit past the end of the coloured track.
   */
  private fun spans(
    context: Context,
    content: JourneyNotificationContent,
    max: Int,
    width: Float
  ): List<Span> {
    // A leg whose line colour never arrived still has to be visible, and this
    // is the same ink the stations ahead used to be drawn in.
    val fallback = ContextCompat.getColor(context, R.color.journey_text_secondary)

    val spans = ArrayList<Span>(content.segments.size)
    var station = 0
    for (segment in content.segments) {
      if (segment.length <= 0 || station >= max) continue
      val end = (station + segment.length).coerceAtMost(max)
      spans.add(
        Span(
          left = width * station / max,
          right = width * end / max,
          color = parseNotificationColor(segment.color) ?: fallback
        )
      )
      station = end
    }

    if (spans.isEmpty()) return listOf(Span(0f, width, fallback))
    val last = spans.last()
    if (last.right < width) spans[spans.lastIndex] = last.copy(right = width)
    return spans
  }

  /** One leg of the journey, in pixels along the bitmap. */
  private data class Span(val left: Float, val right: Float, val color: Int)

  /**
   * The stretch still ahead: the line's own colour at a fraction of its
   * opacity, rather than a grey. It sits correctly on whatever background the
   * shade happens to use, and the bar reads as one material at two strengths
   * instead of as two different colours.
   */
  private fun ghost(color: Int): Int = Color.argb(
    (Color.alpha(color) * GHOST_ALPHA).roundToInt(),
    Color.red(color),
    Color.green(color),
    Color.blue(color)
  )

  /**
   * How wide to draw, given that a notification never says.
   *
   * The shade insets a notification from the screen and the decorated template
   * insets its content again, so the screen minus both is close enough. The
   * ImageView stretches whatever it gets to the width it actually has, and the
   * closer this estimate is the less that stretch distorts the marker and the
   * pointer -- the only two things here whose proportions matter.
   */
  private fun meterWidth(context: Context): Int {
    val screen = context.resources.displayMetrics.widthPixels
    return (screen - dp(context, INSET_DP * 2))
      .coerceIn(dp(context, MIN_WIDTH_DP), dp(context, MAX_WIDTH_DP))
  }

  private fun dp(context: Context, value: Float): Int = TypedValue.applyDimension(
    TypedValue.COMPLEX_UNIT_DIP,
    value,
    context.resources.displayMetrics
  ).roundToInt()

  /** Matches the live journey card's rail on the map, which ghosts at 0.3. */
  private const val GHOST_ALPHA = 0.3f

  /** Total drawn height, which the layout matches exactly so nothing is
   * scaled vertically. Tall enough for the pointer, which is the tallest
   * thing on it. */
  private const val HEIGHT_DP = 18f
  private const val TRACK_DP = 5f
  private const val MARKER_DP = 11f
  private const val POINTER_WIDTH_DP = 3f
  private const val POINTER_HEIGHT_DP = 14f

  /** 16dp of shade margin plus 16dp of template padding, per side. */
  private const val INSET_DP = 32f
  private const val MIN_WIDTH_DP = 160f

  /** Notifications stop widening well before a tablet does; past this the
   * extra pixels are only memory. */
  private const val MAX_WIDTH_DP = 440f
}

/** `#RRGGBB` or `#AARRGGBB` as sent from JS. A bad colour is a cosmetic
 * problem; refusing to show the notification over it would not be. */
internal fun parseNotificationColor(color: String?): Int? {
  if (color == null) return null
  return try {
    Color.parseColor(color)
  } catch (e: IllegalArgumentException) {
    null
  }
}
