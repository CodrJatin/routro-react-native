import { supabase } from '../lib/supabase';

/**
 * Renewing the access token from the journey service's tick, because nothing
 * else can while the app is backgrounded.
 *
 * supabase-js refreshes on a `setInterval`, and `AuthProvider` stops that
 * refresher outright when the app leaves the foreground -- both of which are
 * correct for the ordinary case, and both of which leave exactly one gap: a
 * tracked journey, where a foreground service holds the process open for hours
 * with no JS timer running. See BACKGROUND.md.
 *
 * What that gap cost is worth stating plainly, because it is invisible from
 * the outside. Realtime channels here are private and JWT-gated, so an expired
 * token does not present as an auth problem -- the server closes the channels,
 * the reconnect ladder rejoins with the very same dead token, and it does so
 * indefinitely (there is no give-up state, by design). The user is left with a
 * sharing toggle that is lit, a banner that says it is reconnecting, and
 * friends who stopped seeing them an hour into the ride.
 *
 * A successful refresh needs no rejoin: supabase-js hands the new token to
 * `realtime.setAuth`, which pushes it to every joined channel.
 *
 * That push has a second effect worth knowing before anyone tunes the margin
 * below. Realtime caches each channel's authorization for the life of the
 * connection and only recalculates it when a new JWT arrives on the
 * `access_token` message -- so a token refresh is also the moment a revoked
 * friendship stops being readable by a peer who never voluntarily left the
 * channel. Refreshing less often would widen that window as well as risking
 * the disconnect this exists to prevent. See supabase/migrations/0006.
 */

/**
 * How long before expiry to start refreshing.
 *
 * Deliberately much wider than auth-js's own 90-second margin, which is what
 * `getSession()` refreshes inside. That number is sized for a foreground tab
 * with a 30-second timer behind it. This one is sized for a phone in a pocket
 * underground: ten minutes of runway is roughly ten attempts at
 * `RETRY_AFTER_MS`, so the token still gets renewed across a stretch of no
 * signal that a tighter margin would lose the session to.
 *
 * The cost of being early is one extra refresh round trip per hour of journey.
 */
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

/** How long to wait after a failed refresh before trying again. A tunnel is
 * the expected reason for one, so this is a pause rather than a backoff --
 * backing off would make recovery slowest exactly when the margin above is
 * running out. */
const RETRY_AFTER_MS = 60_000;

/** When the current access token expires, in ms on this device's clock. Zero
 * when there is no session, which disables everything here. */
let expiresAtMs = 0;
/** Earliest time a further attempt may be made, after a failure. */
let nextAttemptAt = 0;
/** In-flight guard. The tick fires every 5s and a refresh takes longer than
 * that on a bad connection, so without this a single slow attempt would spawn
 * a queue of duplicates behind it. */
let inFlight: Promise<void> | null = null;

/**
 * Tells this module when the current token expires.
 *
 * Pushed in by `AuthProvider` from the session it already holds, rather than
 * read from storage here: reading it would mean a chunked SecureStore round
 * trip (see `secureStorage.ts`) on every tick just to answer a question the
 * auth layer already knows the answer to.
 *
 * Null for signed out, which stops all refreshing -- there is nothing to
 * renew, and a retry left running would belong to a session that has ended.
 */
export function setSessionExpiry(expiresAtSeconds: number | null | undefined): void {
  expiresAtMs = expiresAtSeconds ? expiresAtSeconds * 1000 : 0;
  // A new token clears any pending retry: whatever the last failure was, it
  // was about the token this one just replaced.
  nextAttemptAt = 0;
}

/**
 * Refreshes the access token if it is close enough to expiring, and does
 * nothing at all otherwise.
 *
 * Idempotent and cheap on the normal path -- two number comparisons -- which
 * is what lets the 5-second tick call it unconditionally without needing to
 * know anything about token lifetimes.
 *
 * `refreshSession()` rather than `getSession()`, deliberately. The latter only
 * refreshes inside auth-js's own 90-second margin, so asking it early would be
 * a storage read that returns the same soon-to-expire token, every tick, for
 * the whole of `REFRESH_MARGIN_MS`. This asks for exactly what it wants, once.
 *
 * Never rejects: the returned promise is for tests and for callers that want
 * to await the attempt, not an error channel.
 */
export function refreshSessionIfDue(): Promise<void> {
  if (inFlight) return inFlight;
  if (expiresAtMs === 0) return Promise.resolve();

  const now = Date.now();
  if (now < nextAttemptAt) return Promise.resolve();
  if (now < expiresAtMs - REFRESH_MARGIN_MS) return Promise.resolve();

  const attempt = (async () => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) {
        // Offline is the overwhelmingly likely reason, and it is not worth
        // distinguishing from a genuinely dead refresh token here: a revoked
        // one signs the user out, which clears the expiry above and stops
        // this on its own.
        nextAttemptAt = Date.now() + RETRY_AFTER_MS;
        console.warn(`[auth] background token refresh failed: ${error?.message ?? 'no session'}`);
        return;
      }
      // Recorded here as well as through the auth event `AuthProvider` will
      // relay, so this does not depend on a React render landing -- which is
      // the one thing that cannot be relied on while the app is backgrounded.
      setSessionExpiry(data.session.expires_at);
    } catch (error) {
      nextAttemptAt = Date.now() + RETRY_AFTER_MS;
      console.warn('[auth] background token refresh threw', error);
    } finally {
      inFlight = null;
    }
  })();

  inFlight = attempt;
  return attempt;
}
