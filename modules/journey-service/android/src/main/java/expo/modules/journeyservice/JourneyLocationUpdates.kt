package expo.modules.journeyservice

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

/**
 * The journey's GPS feed, owned by the foreground service.
 *
 * Why this exists rather than expo-location's `watchPositionAsync`, which is
 * what the app used to use: that module removes every active watch from
 * `OnActivityEntersBackground` and re-requests them on
 * `OnActivityEntersForeground`. The teardown is driven purely by the
 * activity's lifecycle -- it knows nothing about foreground services -- so a
 * journey went silent the moment the phone went in a pocket, with no error
 * anywhere, and came back to life when the app was reopened. Android's
 * permission model was never the problem: a `location`-typed foreground
 * service does grant the whole process while-in-use access, exactly as
 * designed. The problem was a watch owned by the wrong component.
 *
 * Requesting the updates here fixes that by construction, and keeps fixing it:
 * this client belongs to the service that is holding the process open in the
 * first place, so no future change to how the activity handles pause/resume
 * can reach it.
 *
 * Same provider expo-location uses (`FusedLocationProviderClient`) with the
 * same request shape the app already asked for, so a fix from here is the
 * fix the app would have got anyway -- see `watchOptions.ts`, which is where
 * the interval and accuracy are decided.
 */
internal class JourneyLocationUpdates(private val context: Context) {
  private val client: FusedLocationProviderClient =
    LocationServices.getFusedLocationProviderClient(context)

  private val callback = object : LocationCallback() {
    override fun onLocationResult(result: LocationResult) {
      // `lastLocation` rather than the whole batch: this request is not
      // batched, and where the provider does coalesce, only the newest fix
      // says anything about where the user is now.
      val location = result.lastLocation ?: return
      JourneyServiceBus.emitLocation(
        JourneyFix(
          latitude = location.latitude,
          longitude = location.longitude,
          accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else null,
          at = location.time,
        )
      )
    }
  }

  private var isRequesting = false

  /**
   * Starts (or restarts) delivery at `intervalMs`.
   *
   * Idempotent by way of stopping first, so the JS retry ladder can call this
   * as often as it likes without stacking up requests on the same callback.
   *
   * Returns null on success, or why it failed -- no permission, or Play
   * services refusing the request -- which JS turns into the same
   * retry-then-end path a dead provider takes. Deliberately a return value
   * rather than an event: the caller is already awaiting this, and two ways of
   * hearing about one failure is two ways of counting it.
   *
   * The alternative, reporting success and simply never delivering, is the
   * exact failure mode this class was written to get rid of.
   */
  @SuppressLint("MissingPermission")
  fun start(intervalMs: Long): String? {
    stop()

    // Checked rather than assumed: the app asks for location before starting a
    // journey, but a grant can be withdrawn from system settings mid-ride, and
    // `requestLocationUpdates` answers that with a SecurityException the
    // service would otherwise die on.
    if (!hasLocationPermission()) return PERMISSION_LOST

    val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
      // No distance filter, matching `LOCATION_DISTANCE_METERS` in JS. It is a
      // hard filter inside the OS, not a hint: at anything above zero a user
      // standing on a platform produces no fixes at all, which is
      // indistinguishable from a dead provider. Thinning what actually costs
      // something -- a websocket frame -- is done per-consumer in JS.
      .setMinUpdateDistanceMeters(0f)
      // The first fix should arrive as soon as there is one, even if it is
      // coarse. Waiting for an accurate one delays the opening notification by
      // however long a cold GPS lock takes, and the fixes after it are the
      // ones the journey is actually steered by.
      .setWaitForAccurateLocation(false)
      .build()

    return try {
      client.requestLocationUpdates(request, callback, Looper.getMainLooper())
      isRequesting = true
      null
    } catch (e: SecurityException) {
      Log.e(TAG, "Location updates rejected", e)
      PERMISSION_LOST
    } catch (e: Exception) {
      Log.e(TAG, "Could not request location updates", e)
      "Couldn't start GPS for this journey."
    }
  }

  fun stop() {
    if (!isRequesting) return
    isRequesting = false
    client.removeLocationUpdates(callback)
  }

  private fun hasLocationPermission(): Boolean {
    val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
    val coarse =
      ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION)
    return fine == PackageManager.PERMISSION_GRANTED || coarse == PackageManager.PERMISSION_GRANTED
  }

  companion object {
    private const val TAG = "JourneyLocation"
    private const val PERMISSION_LOST = "Location permission is no longer granted."
  }
}
