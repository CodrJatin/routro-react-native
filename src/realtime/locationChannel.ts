import * as Location from 'expo-location';
import { AppState, Platform } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useSelfPositionStore } from '../location/selfPosition';
import { haversineMeters } from '../engine/geo';
import {
  COARSE_GRANT_MESSAGE,
  isCoarseAndroidGrant,
  logFixAccuracy,
  watchOptions,
} from '../location/watchOptions';
import type {
  ConnectionState,
  FriendLocation,
  LocationNotice,
  PresenceStatus,
} from './locationStore';
import { parseSharedJourney, type SharedJourney } from './sharedJourney';

/**
 * How far the user must move before a fix is put on the wire.
 *
 * Applied here in JS, deliberately, rather than as the watcher's
 * `distanceInterval` -- which is where it used to live and was the wrong
 * place for it. That option is a hard filter inside the OS: below the
 * threshold nothing is delivered to the app at all, so filtering there did not
 * merely rate-limit the network, it blinded the whole device. The user's own
 * pin, the journey notification and every distance test in the app went dark
 * together, because all three read the same fixes this one consumer wanted
 * fewer of. See `LOCATION_DISTANCE_METERS` in `watchOptions.ts`.
 *
 * Filtering here instead keeps the saving where the cost actually is -- a
 * websocket frame and the radio wakeup behind it -- and leaves every local
 * consumer with the full-rate feed it was always supposed to have. The traffic
 * a friend receives is unchanged.
 */
const BROADCAST_DISTANCE_METERS = 15;
/** How long a fix may go un-transmitted before the last one is simply sent
 * again.
 *
 * Someone standing still -- waiting on a platform, which is precisely when a
 * friend is looking for them -- moves less than `BROADCAST_DISTANCE_METERS`
 * and so transmits nothing. Without this they went stale on the receiver at
 * 30s and were dropped off the map entirely at 90s while still actively
 * sharing. */
const HEARTBEAT_RESEND_AFTER_MS = 15_000;
/** How often the heartbeat checks. Deliberately shorter than the resend
 * window above, so the worst-case silence is ~20s and stays comfortably
 * inside the receiver's 30s staleness threshold. */
const HEARTBEAT_TICK_MS = 5000;
/** How often to confirm the device still has location switched on while
 * broadcasting. */
const SERVICES_CHECK_INTERVAL_MS = 15_000;
/**
 * How often to send the realtime socket's own keepalive from `tick()`.
 *
 * supabase-js schedules that heartbeat on a JS timer, and React Native stops
 * running those the moment the app is backgrounded -- so the socket goes
 * silent, the server drops it after its own timeout, and broadcasting dies
 * roughly a minute after the app leaves the screen. Slightly under
 * supabase-js's 30s so ours lands first rather than racing it.
 */
const SUPABASE_HEARTBEAT_MS = 25_000;
/** How long to give the location providers to come up after the user accepts
 * the system enable dialog, and how often to look. */
const SERVICES_ENABLE_WAIT_MS = 6000;
const SERVICES_ENABLE_POLL_MS = 300;
/** How long to wait on a freshly recreated channel. Longer than the first
 * wait: this one starts from a cold join, not a possibly-recovering one. */
const REJOIN_WAIT_MS = 8000;
/** A system location prompt can send the user into Settings for a while, so
 * the wait for the app to come back has to be generous -- 5s timed out
 * before someone could realistically flip the toggle and return. */
const FOREGROUND_WAIT_MS = 90_000;

/**
 * A dropped connection is retried for as long as the user is signed in. There
 * is no attempt limit and no give-up state.
 *
 * The original behaviour was the opposite extreme: the first `CLOSED` tore the
 * watcher down and cleared `isBroadcasting`. `CLOSED` is not an error -- it is
 * the ordinary lifecycle event for a socket drop, and realtime-js rejoins on
 * its own -- so a metro ride, which is nothing but tunnels, ended sharing
 * within the first minute. Worse, it ended it *invisibly*: the rejoin
 * succeeded, `SUBSCRIBED` fired, and presence was re-tracked from an
 * `isBroadcasting` that had already been set false, so the user was announced
 * to their friends as merely 'online' by a device whose GPS watcher was gone.
 *
 * A bounded ladder was the first attempt at a fix and was still wrong, just
 * more slowly: a tunnel longer than the budget ended sharing anyway, and the
 * user had to notice and re-enable it. The argument for a limit was that a lit
 * toggle over a dead connection is a lie -- but the banner already says the
 * connection is down, so nothing is being hidden, and the honest thing is to
 * keep trying and recover the moment there is signal.
 *
 * Fixes continue to be collected throughout. `sendFix` drops what it cannot
 * transmit, which is cheaper and more honest than realtime-js's silent
 * per-message REST fallback, so a long outage costs nothing but the retries
 * themselves.
 */
const RECONNECT_DELAYS_MS = [3000, 8000];

/**
 * The steady interval the retries settle into once the quick attempts above
 * are used up.
 *
 * The ramp exists only to catch a momentary blip -- the gap between two
 * carriages of signal -- in seconds rather than making the user wait out a
 * full interval for something that was already over. Past that it is a real
 * outage, and there is nothing to be gained by backing off further: a longer
 * tunnel would only mean a slower recovery, which is precisely backwards. At
 * four service ticks apart this costs effectively nothing, and it is the same
 * whether or not a journey is running.
 */
const RECONNECT_INTERVAL_MS = 20_000;

function topicFor(userId: string): string {
  return `user-location:${userId}`;
}

interface LocPayload {
  lat: number;
  lon: number;
  ts: number;
}

/** Narrows an untrusted realtime broadcast payload down to a `LocPayload`,
 * or null if it doesn't look like one. This is the trust boundary: only an
 * accepted friend can publish to their own topic, but a client version
 * mismatch is enough to send something malformed, and this flows straight
 * into the native GeoJSON layer's `coordinates` if let through unchecked. */
function parseLocPayload(payload: unknown): LocPayload | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { lat, lon, ts } = payload as Record<string, unknown>;

  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) return null;
  // Malformed-input guard only. Deliberately NOT a "is this close to now?"
  // window: `ts` is the sender's clock, and rejecting on how far it sits
  // from ours would make a friend whose device clock is wrong permanently
  // invisible -- the exact cross-device comparison the rest of this file
  // goes out of its way to avoid. A skewed-but-plausible ts is harmless,
  // since it is only ever compared against that same sender's previous one.
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return null;

  return { lat, lon, ts };
}

/** What this device puts on its own presence entry. `status` has always been
 * here; `journey` is absent whenever there is nothing to share, which is the
 * normal case. */
interface PresencePayload {
  status: PresenceStatus;
  journey?: SharedJourney;
}

/** Callbacks the manager reports through instead of writing to app state
 * directly -- it owns Realtime channels and the location watcher, nothing
 * about where that data ends up. The one real caller (LocationProvider)
 * wires these straight into the Zustand store. */
export interface LocationManagerHandlers {
  onBroadcastingChange(enabled: boolean): void;
  /** Deliberately excludes `receivedAt`, `movedAt` and `previous` -- all
   * three are derived by the store's `upsertFriendLocation`, not by the
   * sender. Stamping the clocks here would put staleness back on the
   * sender's clock, and `previous` only exists relative to what this device
   * already held. */
  onFriendLocation(loc: Omit<FriendLocation, 'receivedAt' | 'movedAt' | 'previous'>): void;
  onFriendPresence(userId: string, status: PresenceStatus): void;
  /** The journey a friend is travelling, or null when they aren't sharing one.
   * Reported from the same presence sync as `onFriendPresence`, so the two can
   * never describe different moments. */
  onFriendJourney(userId: string, journey: SharedJourney | null): void;
  onFriendRemoved(userId: string): void;
  onConnectionChange(state: ConnectionState): void;
  /** Broadcasting stopped on its own -- GPS switched off, provider error --
   * rather than because the user toggled it. The UI needs to say so, since
   * the alternative is the button quietly staying lit while nothing is
   * actually being shared. */
  onBroadcastInterrupted(reason: string): void;
  /** Something the user should know about location that did *not* stop
   * sharing. Kept apart from `onBroadcastInterrupted` so a warning can never
   * be announced under a "sharing stopped" heading that isn't true. */
  onLocationNotice(notice: LocationNotice): void;
}

/** Why a broadcast toggle didn't take effect, so the UI can say so instead
 * of just failing to light up. `ok` is also true for benign no-ops (the call
 * was superseded, or the app backgrounded mid-flight). */
export type BroadcastResult = { ok: true } | { ok: false; reason: string };

const noopHandlers: LocationManagerHandlers = {
  onBroadcastingChange() {},
  onFriendLocation() {},
  onFriendPresence() {},
  onFriendJourney() {},
  onFriendRemoved() {},
  onConnectionChange() {},
  onBroadcastInterrupted() {},
  onLocationNotice() {},
};

/**
 * Owns every Realtime channel this device holds: one channel for the signed-
 * in user's own presence + location broadcast, plus one per accepted friend
 * to receive theirs. Authorization is enforced server-side (see
 * supabase/migrations/0002_realtime_authorization.sql) -- this class does
 * not itself decide who is allowed to see what, it just reflects whatever
 * the server lets through.
 *
 * Nothing broadcast here is ever written to a table; it's in-memory fan-out
 * only, gone the moment no one is subscribed to receive it.
 */
class LocationChannelManager {
  private handlers: LocationManagerHandlers = noopHandlers;
  private ownUserId: string | null = null;
  private ownChannel: RealtimeChannel | null = null;
  /** Message from the last CHANNEL_ERROR, so a refused broadcast can tell
   * the user *why* rather than just failing to turn green. Cleared on a
   * successful join. */
  private lastChannelError: string | null = null;
  /**
   * Set while a journey is being tracked, which means a foreground service is
   * holding the process open and location flowing. Backgrounding then stops
   * being a reason to go quiet: the whole point of a tracked journey is that
   * friends keep seeing you while the phone is in your pocket.
   *
   * False is the app's normal state, and there the original foreground-only
   * behaviour is preserved exactly -- no service, no notification, so
   * broadcasting from the background would be both undiscoverable and a
   * battery drain nobody agreed to.
   */
  private backgroundAllowed = false;
  /** Set while the journey controller's watcher is the one producing fixes.
   * See `setExternalFixSource`. */
  private usesExternalFixes = false;
  /**
   * The journey to advertise on presence, or null for none. Handed in by the
   * journey controller; see `setSharedJourney`.
   *
   * Held on the manager rather than read from a store at track time for the
   * same reason `isBroadcasting` is: presence is re-tracked from several
   * places, including the reconnect path, and every one of them has to send
   * the same answer.
   */
  private sharedJourney: SharedJourney | null = null;
  /** Last time `tick()` sent the realtime keepalive. */
  private lastSupabaseHeartbeatAt = 0;
  /** Set while the app is backgrounded. Checked after the location watcher
   * is created, so an enable that was in flight across a backgrounding tears
   * its watcher back down -- without cancelling enables that merely paused
   * behind a permission dialog. */
  private isPausedForBackground = false;
  /** Whether broadcasting was live when the app most recently went to the
   * background, so foregrounding knows whether to restart it. Held here
   * rather than by the caller so that pausing can be idempotent: a repeat
   * background event must return what the first one captured, not overwrite
   * it with the `false` that pausing itself just produced. */
  private wasBroadcastingBeforeBackground = false;
  private servicesWatchdog: ReturnType<typeof setInterval> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  /** The last fix actually put on the wire, kept so the heartbeat can repeat
   * it verbatim. Its `ts` stays at the original reading's time rather than
   * being restamped: it describes when the position was taken, not when it
   * was last transmitted, and the receiver uses that identity to tell a
   * repeat apart from real movement. */
  private lastSentFix: LocPayload | null = null;
  private lastSentAt = 0;
  /** Which reconnect attempt has been made, 0 when the connection is healthy
   * Never reset by giving up -- only by recovering. See `RECONNECT_DELAYS_MS`. */
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the pending attempt is due, so `tick()` can run it if the JS timer
   * above never fires -- which is exactly what happens in the background, per
   * BACKGROUND.md. Zero when nothing is pending. */
  private reconnectDueAt = 0;
  private friendChannels = new Map<string, RealtimeChannel>();
  private locationSubscription: Location.LocationSubscription | null = null;
  private isBroadcasting = false;
  /** Bumped on every joinOwn/teardown call so a stale async call that
   * finishes after a newer one started can detect it's obsolete and bail
   * out instead of clobbering state a subsequent call already set up. */
  private generation = 0;
  /** Same idea as `generation`, but dedicated to `setBroadcasting` re-entry
   * -- kept separate so starting/stopping the GPS watcher never fights with
   * channel join/teardown bumping the same counter. */
  private broadcastGeneration = 0;
  /** Serialises `cleanupOwnChannel` calls so a fast sign-out/sign-in can't
   * interleave two cleanups and have the stale one's `this.ownUserId = null`
   * land after the newer joinOwn already set it. */
  private cleanupInFlight: Promise<void> = Promise.resolve();

  setHandlers(handlers: LocationManagerHandlers): void {
    this.handlers = handlers;
  }

  /**
   * The single exit point for presence, the way `sendFix` is for locations.
   *
   * Every call site used to pass its own `{ status: ... }` literal, and the
   * comment on the reconnect path records what that cost: a literal there
   * silently downgraded a live broadcaster to 'online' on every network blip.
   * A second field multiplies that hazard -- a journey update written as a
   * literal would drop `status`, and a status update would drop the journey.
   * So the payload is built here, once, from manager state.
   *
   * @param options.status Overrides the state-derived status, for the one
   * caller that tracks *before* flipping `isBroadcasting` (see
   * `setBroadcasting`, which only commits that flag once the watcher is up).
   * @param options.channel The channel to track on, for the subscribe callback
   * -- it runs before `this.ownChannel` has been assigned.
   */
  private trackPresence(
    options: { status?: PresenceStatus; channel?: RealtimeChannel } = {},
  ): Promise<unknown> {
    const channel = options.channel ?? this.ownChannel;
    if (!channel) return Promise.resolve();

    const status: PresenceStatus =
      options.status ?? (this.isBroadcasting ? 'broadcasting' : 'online');

    const payload: PresencePayload = { status };
    // Deliberately gated on actually broadcasting, not merely on having a
    // journey. Where you are headed is more revealing than where you are, and
    // tying the two together makes the rule one sentence the user can hold in
    // their head: sharing your location during a journey shares the journey.
    // Stop sharing and the destination goes with the dot.
    if (status === 'broadcasting' && this.sharedJourney) {
      payload.journey = this.sharedJourney;
    }

    return channel.track(payload);
  }

  /**
   * Sets (or clears) the journey advertised to friends, and re-tracks presence
   * so they see the change now rather than at the next reconnect.
   *
   * Takes a plain record rather than reading the journey store, so this layer
   * keeps knowing nothing about journeys -- same arrangement as
   * `setBackgroundAllowed`. The journey controller owns when to call it, which
   * is also where the user's sharing preference is applied.
   */
  async setSharedJourney(journey: SharedJourney | null): Promise<void> {
    const isSame =
      this.sharedJourney === journey ||
      (this.sharedJourney !== null &&
        journey !== null &&
        this.sharedJourney.originId === journey.originId &&
        this.sharedJourney.destinationId === journey.destinationId &&
        this.sharedJourney.mode === journey.mode &&
        this.sharedJourney.startedAt === journey.startedAt);
    if (isSame) return;

    this.sharedJourney = journey;
    // Best-effort, exactly like the courtesy untrack in `setBroadcasting`: with
    // no joined channel there is nothing to say, and the next successful join
    // re-tracks from this same state anyway.
    if (this.ownChannel?.state === 'joined') await this.trackPresence();
  }

  /**
   * @param options.keepBroadcasting Forwarded to the cleanup below. Only the
   * reconnect path sets it -- see `cleanupOwnChannel`. It has to be threaded
   * through here rather than handled entirely in `rejoinOwnChannel`, because
   * this method runs a cleanup of its own: without it, a rejoin cleaned up
   * carefully, preserved the session, and then had it cleared a line later by
   * the very call it made to rebuild the channel.
   */
  async joinOwn(userId: string, options: { keepBroadcasting?: boolean } = {}): Promise<void> {
    if (this.ownChannel && this.ownUserId === userId) return;
    const myGeneration = ++this.generation;
    await this.cleanupOwnChannel(options);
    if (myGeneration !== this.generation) return; // superseded while awaiting cleanup

    this.ownUserId = userId;
    const channel = supabase.channel(topicFor(userId), {
      config: { private: true, presence: { key: userId } },
    });
    // 'connecting' only for a genuine first join. A rejoin that is itself part
    // of a retry must keep saying 'reconnecting', or the banner -- which
    // renders nothing for 'connecting' -- would blink off and back on with
    // every attempt, and read as the connection recovering each time it was in
    // fact failing again.
    this.handlers.onConnectionChange(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');

    channel.subscribe(async (status, error) => {
      if (myGeneration !== this.generation) return; // superseded

      if (status === 'SUBSCRIBED') {
        // Re-tracked from the manager's real current state, not a literal --
        // this callback also fires on every reconnect, and a network blip
        // must not silently downgrade an active broadcaster to 'online' or
        // drop the journey they are advertising. Tracked on the local
        // `channel`, which this callback has before `this.ownChannel` does.
        await this.trackPresence({ channel });
        this.lastChannelError = null;
        this.clearReconnect();
        this.handlers.onConnectionChange('connected');
        // A fix held back while the channel was down is now worth sending, and
        // waiting up to HEARTBEAT_TICK_MS to notice would leave the user
        // missing from their friends' maps for no reason.
        this.resendHeartbeatIfDue();
        return;
      }

      // Everything below is the connection being down. None of it is fatal --
      // see `RECONNECT_DELAYS_MS` for why the first one used to be, and what
      // that cost. The error message is still kept, because `setBroadcasting`
      // reports it when a *user-initiated* start can't reach the service.
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        this.lastChannelError = error?.message ?? status;
        this.handleConnectionLost();
        return;
      }

      if (status === 'CLOSED') {
        // CLOSED is a normal lifecycle event (socket drop, rejoin, leave), not
        // an error, and realtime-js rejoins on its own. Retried like the rest
        // so that a rejoin which never lands is still eventually repaired.
        this.handleConnectionLost();
      }
    });

    if (myGeneration !== this.generation) {
      // Superseded between creating and assigning the channel -- discard it
      // rather than leaving it referenced nowhere but still connected.
      supabase.removeChannel(channel);
      return;
    }
    this.ownChannel = channel;
  }

  /** Tears the own channel down and joins a fresh one for the same user.
   * `joinOwn` alone is a no-op when a channel for that user already exists,
   * which is precisely the stuck case this exists for. Deliberately does not
   * touch `broadcastGeneration`: a `setBroadcasting` call that asked for this
   * rejoin must survive it. */
  private async rejoinOwnChannel(options: { keepBroadcasting?: boolean } = {}): Promise<void> {
    const userId = this.ownUserId;
    if (!userId) return;
    await this.cleanupOwnChannel(options); // clears ownUserId, hence the capture above
    await this.joinOwn(userId, options);
  }

  /**
   * The connection went down. Retry it rather than giving sharing up on the
   * spot -- see `RECONNECT_DELAYS_MS` for what the old behaviour cost.
   *
   * The ladder is self-driving: each attempt calls `rejoinOwnChannel`, whose
   * subscribe callback lands back here on failure with the counter one higher,
   * or clears the whole thing via `clearReconnect` on success. Nothing else
   * has to sequence it.
   *
   * The GPS watcher is deliberately left running throughout. It is the app's
   * live position as well as the broadcast source, so tearing it down for a
   * network problem froze the user's own pin over a fault that had nothing to
   * do with location. `sendFix` drops what it cannot transmit, so the fixes
   * arriving meanwhile cost nothing and the first one after a successful
   * rejoin goes out immediately.
   */
  private handleConnectionLost(): void {
    // An attempt is already pending -- realtime-js emits several of these per
    // drop, and each must not push the ramp along a rung on its own.
    if (this.reconnectTimer !== null || this.reconnectDueAt !== 0) return;

    const attempt = ++this.reconnectAttempt;
    const delay = RECONNECT_DELAYS_MS[attempt - 1] ?? RECONNECT_INTERVAL_MS;
    console.warn(`[location] connection lost, retry ${attempt} in ${delay}ms`);

    this.reconnectDueAt = Date.now() + delay;
    this.handlers.onConnectionChange('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.runReconnectAttempt();
    }, delay);
  }

  /** Runs the pending attempt. Safe to call from both the JS timer and
   * `tick()`: the first one through clears `reconnectDueAt`, and the other
   * finds nothing to do. */
  private async runReconnectAttempt(): Promise<void> {
    if (this.reconnectDueAt === 0) return;
    this.reconnectDueAt = 0;
    this.clearReconnectTimer();
    if (!this.ownUserId) return;

    // Recovered on its own while the delay was running -- realtime-js rejoins
    // by itself and often wins this race. Nothing to rebuild.
    if (this.ownChannel?.state === 'joined') {
      this.clearReconnect();
      this.handlers.onConnectionChange('connected');
      return;
    }

    // Broadcasting is preserved across the teardown here, unlike every other
    // caller: this rejoin is repairing the transport under a session the user
    // never asked to end.
    await this.rejoinOwnChannel({ keepBroadcasting: true });
  }

  /** Called from `tick()`, because the JS timer above does not run while the
   * app is backgrounded (BACKGROUND.md) -- which is precisely when a phone in
   * a pocket crosses a tunnel and drops the socket. */
  private runReconnectIfDue(): void {
    if (this.reconnectDueAt === 0 || Date.now() < this.reconnectDueAt) return;
    void this.runReconnectAttempt();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** Back to a healthy connection, or done trying. Resets the counter so the
   * next drop gets a full ladder of its own rather than inheriting a spent one. */
  private clearReconnect(): void {
    this.clearReconnectTimer();
    this.reconnectDueAt = 0;
    this.reconnectAttempt = 0;
  }

  /** Public exit point -- bumps generation so any in-flight joinOwn call
   * detects it's been superseded and discards its work instead of
   * clobbering the (now torn-down) state. Also bumps broadcastGeneration so
   * an in-flight setBroadcasting(true) call can't install a watcher after
   * the user has signed out. */
  async leaveOwn(): Promise<void> {
    ++this.generation;
    ++this.broadcastGeneration;
    // The session is over, so the backgrounding state captured during it must
    // not outlive it: a retained "was broadcasting" would have the next
    // foreground resume sharing on behalf of whoever signs in next, and a
    // retained paused flag would make every later attempt refuse as
    // 'backgrounded-late'.
    this.isPausedForBackground = false;
    this.wasBroadcastingBeforeBackground = false;
    // Same reasoning as the two flags above: a journey retained across a
    // sign-out would be advertised on behalf of whoever signs in next.
    // Deliberately not in `cleanupOwnChannel`, which `rejoinOwnChannel` also
    // runs -- a rejoin mid-journey must not drop what it is rejoining with.
    this.sharedJourney = null;
    // Here for the same reason, and load-bearing for the same reason: a
    // pending retry that outlived the session would rejoin a channel for a
    // user who has signed out.
    this.clearReconnect();
    await this.cleanupOwnChannel();
  }

  /**
   * @param options.keepBroadcasting Leaves the watcher and the broadcasting
   * flag alone. For the reconnect path only, where the channel underneath a
   * session is being replaced and the session itself is meant to survive --
   * every other caller is genuinely ending it. Note what this relies on: the
   * subscribe callback re-tracks presence from `isBroadcasting`, so preserving
   * the flag is exactly what makes the rejoined channel re-announce the user
   * as still sharing.
   */
  private cleanupOwnChannel(options: { keepBroadcasting?: boolean } = {}): Promise<void> {
    const run = async () => {
      if (!options.keepBroadcasting) {
        this.stopLocationWatcher();
        // Must clear the flag too, not just the watcher: it is what the
        // subscribe callback re-tracks presence from, so leaving it set meant
        // signing out while broadcasting and back in advertised the new
        // session as 'broadcasting' with no watcher actually running.
        this.setIsBroadcasting(false);
      }
      const channel = this.ownChannel;
      this.ownChannel = null;
      this.lastChannelError = null;
      this.ownUserId = null;
      if (channel) {
        // Both steps are best-effort and independently guarded. A throwing
        // untrack used to skip removeChannel entirely, leaving a channel
        // referenced nowhere but still joined -- still receiving, still
        // holding the socket, with no handle left to close it. It also
        // rejected out through joinOwn/teardown, neither of which is awaited
        // by the provider, so it surfaced as an unhandled rejection.
        try {
          await channel.untrack();
        } catch (error) {
          console.warn('[location] untrack failed during cleanup', error);
        }
        try {
          await supabase.removeChannel(channel);
        } catch (error) {
          console.warn('[location] removeChannel failed during cleanup', error);
        }
      }
    };
    // Chain onto whatever cleanup is already in flight so two overlapping
    // calls (e.g. a fast sign-out/sign-in) always run start-to-finish in
    // order, rather than interleaving their awaits.
    const next = this.cleanupInFlight.then(run, run);
    this.cleanupInFlight = next.catch(() => {});
    return next;
  }

  /** Resolves true once the own channel is actually joined, false if it
   * hasn't got there within `timeoutMs`.
   *
   * Deliberately polls the channel's *current* state on every call rather
   * than awaiting a promise settled once at join time: a one-shot promise
   * latched a transient failure forever, so after a single early
   * disconnect every later broadcast attempt was refused even once the
   * channel had long since recovered. */
  private waitForOwnChannelJoined(timeoutMs = 6000): Promise<boolean> {
    const channel = this.ownChannel;
    if (!channel) return Promise.resolve(false);
    if (channel.state === 'joined') return Promise.resolve(true);

    return new Promise((resolve) => {
      const startedAt = Date.now();
      const poll = () => {
        // Channel was replaced (sign-out, rejoin) -- this wait is moot.
        if (this.ownChannel !== channel) return resolve(false);
        if (channel.state === 'joined') return resolve(true);
        if (Date.now() - startedAt >= timeoutMs) return resolve(false);
        setTimeout(poll, 150);
      };
      setTimeout(poll, 150);
    });
  }

  /** Every path that ends without broadcasting reports itself, with a short
   * code in the log and a plain-English reason for the user. A toggle that
   * spins and then silently does nothing is impossible to diagnose from
   * either side of the screen. */
  private refuse(code: string, reason: string): BroadcastResult {
    console.warn(`[broadcast] refused (${code})`);
    this.setIsBroadcasting(false);
    return { ok: false, reason };
  }

  /** A newer call took over while this one was awaiting.
   *
   * Deliberately touches nothing. Routing these through `refuse` meant a
   * losing call flipped `isBroadcasting` to false *after* the winning call
   * had genuinely started -- which is the precise outcome the generation
   * counter exists to prevent. The damage went past a dark button: the
   * reconnect handler re-tracks presence from that flag (so friends were
   * told 'online' by a device that was still transmitting) and the services
   * watchdog short-circuits on it.
   *
   * Reported as ok, per `BroadcastResult`: being superseded is a benign
   * no-op, not a refusal, and alerting the user about an attempt that a
   * newer one has already taken over is just noise. */
  private superseded(code: string): BroadcastResult {
    console.warn(`[broadcast] superseded (${code})`);
    return { ok: true };
  }

  /** Resolves once the app is in the foreground again, or false on timeout.
   *
   * Asking for location permission opens a system dialog that backgrounds
   * the app, so immediately after that await the app is legitimately not
   * active yet -- refusing there rejected the very flow that just succeeded.
   * Waiting for the dialog to close is the correct behaviour; a real
   * backgrounding simply never returns and times out. */
  private waitForForeground(timeoutMs = FOREGROUND_WAIT_MS): Promise<boolean> {
    if (AppState.currentState === 'active') return Promise.resolve(true);
    return new Promise((resolve) => {
      const subscription = AppState.addEventListener('change', (next) => {
        if (next === 'active') {
          clearTimeout(timer);
          subscription.remove();
          resolve(true);
        }
      });
      const timer = setTimeout(() => {
        subscription.remove();
        resolve(false);
      }, timeoutMs);
    });
  }

  /**
   * @param options.prompt Whether this attempt is allowed to open the system
   * permission dialog. True for a user tapping the toggle -- they asked, so
   * asking back is the whole point. False for anything the app decides on its
   * own; see `resumeForForeground`.
   */
  async setBroadcasting(
    enabled: boolean,
    options: { prompt?: boolean } = {},
  ): Promise<BroadcastResult> {
    const canPrompt = options.prompt ?? true;
    const myBroadcastGeneration = ++this.broadcastGeneration;

    // Stopping is handled before any connectivity check, and cannot fail.
    // Everything that actually stops transmission is local -- kill the
    // watcher, drop the flag -- so refusing it when the channel happened to
    // be down answered "stop sharing" with "Couldn't start sharing: you're
    // not connected", for an action that had in fact already taken effect.
    // Being unsure whether your location is still going out is the worst
    // state this screen can leave someone in.
    if (!enabled) {
      // Set together with the watcher teardown, not after an await: these
      // two must never be observed disagreeing.
      this.stopLocationWatcher();
      this.setIsBroadcasting(false);
      // Best-effort courtesy so friends see it immediately. With no channel
      // they find out when presence times out instead, and the important
      // half -- that nothing more is being sent -- is already true.
      if (myBroadcastGeneration === this.broadcastGeneration) {
        await this.trackPresence();
      }
      return { ok: true };
    }

    if (!this.ownChannel) {
      return this.refuse('no-channel', "You're not connected to the location service yet.");
    }

    // Already broadcasting with fixes arriving from somewhere -- nothing to do,
    // and re-requesting permission/re-tracking would be redundant. During a
    // journey there is no subscription of our own to check, because the
    // journey's watcher is the source.
    if (this.isBroadcasting && (this.locationSubscription || this.usesExternalFixes)) {
      return { ok: true };
    }

    console.warn(
      `[broadcast] starting appState=${String(AppState.currentState)} channelState=${this.ownChannel.state}`,
    );

    // Only a tap may open the system dialog. Android revokes a one-time
    // ("Only this time") grant as soon as the app leaves the foreground, so a
    // resume that asks would put a permission dialog in front of the user on
    // every return to the app -- one they never tapped for, and one that
    // reappears immediately after they dismiss it, since dismissing it is
    // itself a foreground event. Android also denies the permission
    // permanently after the second refusal, so those unasked-for prompts spend
    // a decision the user never chose to make. Checking silently instead ends
    // sharing with an explanation they can act on when they want to.
    const permissions = canPrompt
      ? await Location.requestForegroundPermissionsAsync()
      : await Location.getForegroundPermissionsAsync();
    const { status } = permissions;
    if (myBroadcastGeneration !== this.broadcastGeneration) {
      return this.superseded('permission');
    }
    if (status !== 'granted') {
      return this.refuse(
        'permission-denied',
        canPrompt
          ? 'Location permission is needed to share your location.'
          : 'Location access was withdrawn while you were away, so sharing stopped. Turn sharing back on to allow it again.',
      );
    }
    // Granted, but only approximately -- which Android 12+ offers right
    // alongside precise in the same dialog, and which `status` cannot tell
    // apart. Sharing still proceeds: a friend seeing you within a kilometre
    // beats seeing nothing, and refusing here would be turning a working (if
    // blunt) feature off over something the user can fix. But it is said out
    // loud, because it is otherwise indistinguishable from the app being
    // broken -- and it is the one cause of a frozen pin that no amount of
    // accuracy or interval tuning on our side can reach.
    if (isCoarseAndroidGrant(permissions)) {
      console.warn('[broadcast] approximate location only -- fixes will be ~1-3km');
      this.handlers.onLocationNotice({
        title: 'Approximate location only',
        message: COARSE_GRANT_MESSAGE,
      });
    }
    // The permission dialog itself backgrounds the app, so wait for it to
    // hand focus back rather than treating "not active right now" as a
    // failure.
    if (!(await this.waitForForeground())) {
      return this.refuse(
        `not-active:${String(AppState.currentState)}`,
        'The app left the foreground before sharing could start. Try again.',
      );
    }
    if (myBroadcastGeneration !== this.broadcastGeneration) {
      return this.superseded('foreground');
    }

    // Permission granted is not the same as GPS being switched on. Without
    // this, broadcasting "started" happily and then never produced a single
    // fix, leaving the button lit while nothing was shared.
    if (!(await this.hasLocationServices())) {
      // Same rule as the permission dialog above: only a tap may open one.
      // A resume that asked would put Play's "turn on location?" dialog in
      // front of the user every time they returned to the app.
      if (!canPrompt) {
        return this.refuse(
          'services-disabled-silent',
          'Location is turned off on this device, so sharing stopped. Switch it on and turn sharing back on.',
        );
      }
      // Android can offer to switch location on right here, without sending
      // the user off to Settings -- so ask, rather than telling them to go do
      // it themselves and come back.
      const accepted = await this.promptToEnableLocationServices();
      if (myBroadcastGeneration !== this.broadcastGeneration) {
        return this.superseded('services-prompt');
      }
      // The dialog hands focus away; wait for it back before deciding
      // anything, same as after the permission prompt.
      if (!(await this.waitForForeground())) {
        return this.refuse(
          `not-active-after-services:${String(AppState.currentState)}`,
          'The app left the foreground before sharing could start. Try again.',
        );
      }
      if (myBroadcastGeneration !== this.broadcastGeneration) {
        return this.superseded('services-foreground');
      }
      // Accepting the dialog resolves as soon as the *setting* flips, which
      // is before the providers report themselves as up -- checking once
      // right here said "still off" and refused the attempt the user had
      // just approved. Give it a moment to come up. A declined dialog gets
      // the single check instead, so "no" is answered immediately.
      const servicesOn = accepted
        ? await this.waitForLocationServices()
        : await this.hasLocationServices();
      if (myBroadcastGeneration !== this.broadcastGeneration) {
        return this.superseded('services-wait');
      }
      if (!servicesOn) {
        return this.refuse(
          'services-disabled',
          'Location is turned off on this device. Switch it on, then try again.',
        );
      }
    }

    // Wait for the channel to have actually joined before installing the
    // watcher -- sending while still joining/reconnecting makes realtime-js
    // silently fall back to one REST POST per message.
    let joined = await this.waitForOwnChannelJoined();
    if (myBroadcastGeneration !== this.broadcastGeneration) {
      return this.superseded('join');
    }
    if (!joined) {
      // A channel can be left sitting closed after the socket dropped --
      // most often right after a system dialog backgrounded the app, which
      // is exactly when the user comes back and taps share. Waiting longer
      // does nothing for a channel nothing is rejoining, so recreate it once
      // before giving up.
      console.warn(`[broadcast] channel not joined (${this.ownChannel?.state ?? 'gone'}), rejoining`);
      // Rejoining clears the last channel error, and a fresh channel that
      // merely times out never sets a new one -- so keep the old message to
      // fall back on, or the refusal below loses the only real diagnostic
      // (an auth/RLS rejection, typically) it had.
      const priorError = this.lastChannelError;
      await this.rejoinOwnChannel();
      this.lastChannelError ??= priorError;
      if (myBroadcastGeneration !== this.broadcastGeneration) {
        return this.superseded('rejoin');
      }
      joined = await this.waitForOwnChannelJoined(REJOIN_WAIT_MS);
      if (myBroadcastGeneration !== this.broadcastGeneration) {
        return this.superseded('rejoin-wait');
      }
    }
    if (!joined || !this.ownChannel) {
      return this.refuse(
        'not-joined',
        this.lastChannelError
          ? `Couldn't connect to the location service: ${this.lastChannelError}`
          : "Couldn't reach the location service. Check your connection and try again.",
      );
    }
    // Explicit status: `isBroadcasting` is only committed at the end of this
    // method, once the watcher is actually up, so the derived value would
    // still read 'online' here.
    await this.trackPresence({ status: 'broadcasting' });
    if (myBroadcastGeneration !== this.broadcastGeneration) return this.superseded('track');

    // Belt-and-suspenders: guarantee any previous watcher is gone before
    // assigning a new one, however it might have gotten there.
    this.stopLocationWatcher();

    // A journey already has a watcher running; a second one on the same device
    // is pure battery cost for the same fixes. Its fixes arrive via
    // `submitFix` instead.
    if (!this.usesExternalFixes) {
      let subscription: Location.LocationSubscription;
      try {
        subscription = await this.watchPosition();
      } catch (error) {
        return this.refuse(
          'watcher-failed',
          error instanceof Error
            ? `Couldn't start GPS: ${error.message}`
            : "Couldn't start GPS on this device.",
        );
      }

      if (myBroadcastGeneration !== this.broadcastGeneration) {
        // Superseded while awaiting watchPositionAsync -- remove what was just
        // created instead of leaking a watcher with no handle left to stop it.
        subscription.remove();
        return this.superseded('watcher');
      }
      // The app backgrounded while the watcher was being created. This is the
      // window pauseForBackground() can't cover on its own, and the reason it
      // no longer needs to cancel the whole attempt to stay safe. A tracked
      // journey is exempt: backgrounding is expected there, not a departure.
      if (this.isPausedForBackground && !this.backgroundAllowed) {
        subscription.remove();
        return this.refuse(
          'backgrounded-late',
          'The app left the foreground before sharing could start. Try again.',
        );
      }

      this.locationSubscription = subscription;
    }

    this.startServicesWatchdog();
    this.setIsBroadcasting(true);
    // After setIsBroadcasting: the heartbeat checks that flag before sending.
    this.startHeartbeat();
    return { ok: true };
  }

  private watchPosition(): Promise<Location.LocationSubscription> {
    return Location.watchPositionAsync(
      // Shared with the map and journey watchers -- see `watchOptions.ts`. In
      // particular the distance filter is NOT set here any more: it moved into
      // `shouldSendFix` below, so that thinning the network traffic stops
      // blinding every local consumer of the same fixes.
      //
      // `mayShowUserSettingsDialog` stays off (the shared default):
      // `setBroadcasting` has already checked location services and, if they
      // were off, offered to switch them on at the moment the user asked to
      // share. Expo's default of true meant this could open a second "turn on
      // location?" dialog by itself -- including from the silent resume path,
      // where the user tapped nothing at all.
      watchOptions(),
      (position) => {
        logFixAccuracy('broadcast', position.coords.accuracy);
        // This watcher is the app's live position while it's the one running,
        // exactly as the journey controller's is while a journey is tracked.
        // Writing it to the shared store is what lets the map screen stand its
        // own watcher down instead of running a second GPS consumer -- and
        // what keeps the user's pin moving whether they are sharing or not.
        useSelfPositionStore
          .getState()
          .setLive(position.coords.latitude, position.coords.longitude);
        this.offerFix({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          ts: position.timestamp,
        });
      },
      // Third argument, previously omitted: the provider reporting a problem
      // (GPS switched off mid-session being the obvious one) used to go
      // nowhere, so sharing looked healthy while no fix would ever arrive.
      (reason) => this.interruptBroadcast(reason),
    );
  }

  /**
   * Whether this fix is worth the radio, given what was last transmitted.
   *
   * This is the OS `distanceInterval` that used to sit on the watcher, moved
   * into JS and applied to the one consumer that actually wanted it. Same
   * threshold, same resulting traffic -- but the fixes it declines to send are
   * still delivered to the app, so the user's pin, the journey notification
   * and every station test keep running at full rate. That split is the whole
   * point; see `BROADCAST_DISTANCE_METERS`.
   *
   * The time clause is not a duplicate of the heartbeat. The heartbeat repeats
   * the last fix verbatim to prove the sender is alive; this one lets a *new*
   * position through once it has been a while, so slow drift below the
   * distance threshold still eventually reaches friends as movement rather
   * than as a repeat of somewhere the user no longer is.
   */
  private shouldSendFix(payload: LocPayload): boolean {
    const last = this.lastSentFix;
    if (!last) return true;
    if (Date.now() - this.lastSentAt >= HEARTBEAT_RESEND_AFTER_MS) return true;
    return haversineMeters(last.lat, last.lon, payload.lat, payload.lon) >= BROADCAST_DISTANCE_METERS;
  }

  /**
   * A fix from whichever watcher is running, offered for transmission.
   *
   * The single place `shouldSendFix` is applied, so the own watcher and the
   * journey's (via `submitFix`) thin their traffic identically -- the
   * arrangement `sendFix` already has with the heartbeat, one layer up.
   */
  private offerFix(payload: LocPayload): void {
    if (!this.shouldSendFix(payload)) return;
    this.sendFix(payload);
  }

  /** The single exit point for outbound fixes, shared by the GPS watcher and
   * the heartbeat so the two can't drift apart on what counts as sent. */
  private sendFix(payload: LocPayload): void {
    // Dropping a fix during a reconnect is cheaper and more honest than
    // realtime-js's silent per-message REST fallback.
    const channel = this.ownChannel;
    if (!channel || channel.state !== 'joined') return;
    this.lastSentFix = payload;
    this.lastSentAt = Date.now();
    void channel.send({ type: 'broadcast', event: 'loc', payload }).then((result) => {
      if (result !== 'ok') {
        console.warn(`[location] broadcast send did not succeed: ${result}`);
      }
    });
  }

  /** Repeats the last fix when the watcher has gone quiet -- see
   * `HEARTBEAT_RESEND_AFTER_MS`. Sends nothing until there is a fix to
   * repeat, and nothing while the channel is mid-reconnect (`sendFix`
   * drops those), so a stalled connection doesn't accumulate anything. */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => this.resendHeartbeatIfDue(), HEARTBEAT_TICK_MS);
  }

  /** Idempotent by construction -- it does nothing until the resend window has
   * actually elapsed. That is what lets the JS interval and `tick()` both call
   * it without either needing to know whether the other is running. */
  private resendHeartbeatIfDue(): void {
    const fix = this.lastSentFix;
    if (!fix || !this.isBroadcasting) return;
    if (Date.now() - this.lastSentAt < HEARTBEAT_RESEND_AFTER_MS) return;
    this.sendFix(fix);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    // Cleared with the watcher: a fix from a finished session must never be
    // repeated into a later one.
    this.lastSentFix = null;
    this.lastSentAt = 0;
  }

  private async hasLocationServices(): Promise<boolean> {
    try {
      return await Location.hasServicesEnabledAsync();
    } catch {
      // Can't tell -- don't block the user on a failed capability check.
      return true;
    }
  }

  /** Shows Android's own "turn on location?" resolution dialog (Play
   * services). Returns whether the user accepted -- not whether location is
   * actually up yet, which the caller confirms separately. iOS has no
   * equivalent API (the toggle lives in Settings), so there this is a no-op
   * and the caller falls back to explaining. */
  private async promptToEnableLocationServices(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    try {
      await Location.enableNetworkProviderAsync();
      return true;
    } catch {
      // Declined, or no Play services to ask with.
      return false;
    }
  }

  /** Polls until location services report themselves on, up to a short
   * budget. Used right after the user accepts the enable dialog, where the
   * providers reliably take a beat to actually come up. */
  private async waitForLocationServices(
    timeoutMs = SERVICES_ENABLE_WAIT_MS,
    intervalMs = SERVICES_ENABLE_POLL_MS,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await this.hasLocationServices()) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  /** Android can simply stop delivering fixes when location is switched off,
   * without ever invoking the watcher's error handler. This polls so that
   * case still surfaces instead of leaving the button lit forever. */
  private startServicesWatchdog(): void {
    this.stopServicesWatchdog();
    this.servicesWatchdog = setInterval(
      () => void this.checkServicesStillOn(),
      SERVICES_CHECK_INTERVAL_MS,
    );
  }

  private async checkServicesStillOn(): Promise<void> {
    if (!this.isBroadcasting) return;
    if (!(await this.hasLocationServices())) {
      this.interruptBroadcast('Location was turned off on this device.');
    }
  }

  private stopServicesWatchdog(): void {
    if (this.servicesWatchdog !== null) {
      clearInterval(this.servicesWatchdog);
      this.servicesWatchdog = null;
    }
  }

  /** Broadcasting stopped for a reason the user didn't choose. Tear it down
   * properly and say so, rather than leaving a green button over a dead
   * watcher. */
  private interruptBroadcast(reason: string): void {
    if (!this.isBroadcasting) return;
    console.warn(`[broadcast] interrupted: ${reason}`);
    this.stopLocationWatcher();
    this.setIsBroadcasting(false);
    void this.trackPresence();
    this.handlers.onBroadcastInterrupted(reason);
  }

  private setIsBroadcasting(enabled: boolean): void {
    this.isBroadcasting = enabled;
    this.handlers.onBroadcastingChange(enabled);
  }

  private stopLocationWatcher(): void {
    this.stopServicesWatchdog();
    this.stopHeartbeat();
    this.locationSubscription?.remove();
    this.locationSubscription = null;
  }

  /**
   * Everything periodic that has to survive backgrounding, driven by the
   * journey service's native tick rather than a JS timer.
   *
   * React Native removes the Choreographer frame callback its timers run on as
   * soon as the app is backgrounded, so `setInterval` stops dead -- including
   * the broadcast heartbeat, without which someone standing on a platform goes
   * stale on their friends' devices at 30s and is dropped entirely at 90s.
   * That is precisely the moment a friend is looking for them.
   *
   * Every step is idempotent and self-scheduling, so this running alongside
   * the JS intervals in the foreground costs nothing.
   */
  tick(): void {
    this.resendHeartbeatIfDue();
    void this.checkServicesStillOn();
    this.sendSupabaseHeartbeatIfDue();
    // Last, and the reason this matters: a socket that drops while the phone
    // is in a pocket has no working JS timer to schedule its own recovery, so
    // without this the retry ladder would simply stall until the user next
    // looked at the screen -- during the exact stretch of a journey they are
    // least able to notice and most want to be visible for.
    this.runReconnectIfDue();
  }

  /** Keeps the realtime socket from being dropped by the server. See
   * SUPABASE_HEARTBEAT_MS -- supabase-js's own keepalive is a JS timer and
   * stops with everything else when the app backgrounds. */
  private sendSupabaseHeartbeatIfDue(): void {
    if (!this.ownChannel) return;
    if (Date.now() - this.lastSupabaseHeartbeatAt < SUPABASE_HEARTBEAT_MS) return;
    this.lastSupabaseHeartbeatAt = Date.now();
    void supabase.realtime.sendHeartbeat().catch((error: unknown) => {
      // realtime-js tears the socket down itself when a heartbeat goes
      // unanswered, so there is nothing to do here but say so.
      console.warn('[location] realtime heartbeat failed', error);
    });
  }

  /**
   * Tells the manager a foreground service is holding the app open, so
   * backgrounding should no longer stop broadcasting.
   *
   * Driven by the journey controller rather than read from a store, so the
   * realtime layer keeps knowing nothing about journeys -- it only knows
   * whether something is currently keeping the process alive.
   */
  setBackgroundAllowed(allowed: boolean): void {
    this.backgroundAllowed = allowed;
  }

  /**
   * Hands fix production over to the journey controller's watcher, or takes it
   * back. Two GPS watchers on one device produce the same fixes twice at twice
   * the cost.
   */
  async setExternalFixSource(enabled: boolean): Promise<void> {
    if (this.usesExternalFixes === enabled) return;
    this.usesExternalFixes = enabled;
    if (!this.isBroadcasting) return;

    if (enabled) {
      // Drop only the subscription: the heartbeat and services watchdog are
      // still ours to run, and stopLocationWatcher would take them too.
      this.locationSubscription?.remove();
      this.locationSubscription = null;
      return;
    }

    // The journey ended while sharing stayed on -- take the watcher back, or
    // nothing would be transmitted again until the user toggled sharing.
    try {
      this.locationSubscription = await this.watchPosition();
    } catch (error) {
      this.interruptBroadcast(
        error instanceof Error ? `Couldn't restart GPS: ${error.message}` : "Couldn't restart GPS.",
      );
    }
  }

  /** A fix from the journey controller's watcher, when it owns the GPS.
   * Thinned by the same rule as our own watcher's -- see `offerFix`. */
  submitFix(lat: number, lon: number, ts: number): void {
    if (!this.usesExternalFixes || !this.isBroadcasting) return;
    this.offerFix({ lat, lon, ts });
  }

  /** App backgrounded: go fully invisible to friends (untrack presence) and
   * stop the location watcher, regardless of whether broadcasting was on.
   * Returns whether broadcasting was active, so the caller can resume it on
   * foreground.
   *
   * A no-op while a journey is being tracked -- there, leaving the screen is
   * the expected case rather than a departure, and the ongoing notification
   * means the user can see and stop the sharing at any time. */
  async pauseForBackground(): Promise<boolean> {
    if (this.backgroundAllowed) return this.isBroadcasting;
    // Idempotent: a second background event while already paused reports what
    // the first one captured. Re-running would read `isBroadcasting` after
    // the first pause had already cleared it, and so resume to 'not
    // broadcasting' on a session that was.
    if (this.isPausedForBackground) return this.wasBroadcastingBeforeBackground;

    // Deliberately does NOT bump broadcastGeneration. Requesting location
    // permission opens a system dialog, which backgrounds the app and lands
    // here -- bumping the generation made an in-flight setBroadcasting()
    // cancel itself the moment it asked for permission. The paused flag
    // below, re-checked after the watcher is created, closes the same window
    // without the self-cancellation.
    this.isPausedForBackground = true;
    // Captured before any await, so a foreground event arriving mid-pause
    // still reads the right answer. Flag and watcher drop together for the
    // same reason they do in setBroadcasting: an await between them is a
    // window where the UI claims to be sharing over a dead watcher.
    this.wasBroadcastingBeforeBackground = this.isBroadcasting;
    this.stopLocationWatcher();
    this.setIsBroadcasting(false);
    await this.ownChannel?.untrack();
    return this.wasBroadcastingBeforeBackground;
  }

  /**
   * Confirms the realtime socket and the own channel are actually up, and
   * rebuilds them if not. Called when the app returns to the foreground.
   *
   * The state this exists for is a silent one. Backgrounding without a journey
   * stops every JS timer, including supabase-js's socket keepalive; the server
   * drops the connection; and realtime-js's own reconnect backoff is a JS timer
   * too, so nothing is left to bring it back. Everything then *looks* fine --
   * `ownChannel` is non-null, no error was ever raised, the banner is clear --
   * while presence goes nowhere and no friend location arrives. Checking the
   * socket directly is the only way to tell that apart from a quiet channel.
   *
   * Cheap and idempotent on the normal path, where the socket survived and
   * both checks pass immediately.
   */
  async ensureConnected(): Promise<void> {
    if (!this.ownUserId) return;

    if (!supabase.realtime.isConnected()) {
      console.warn('[location] realtime socket down on foreground, reconnecting');
      supabase.realtime.connect();
    }

    // A channel left sitting in a non-joined state after the socket went away.
    // Rejoining preserves broadcasting for the same reason the retry ladder
    // does: the user never asked for it to stop.
    if (this.ownChannel && this.ownChannel.state !== 'joined') {
      this.clearReconnect();
      await this.rejoinOwnChannel({ keepBroadcasting: true });
    }
  }

  /** Takes no argument by design. The caller used to hold "was broadcasting
   * before backgrounding" and hand it back, but it could only store that
   * once `pauseForBackground` resolved -- so a quick background/foreground
   * flip ran this against a value that had not been written yet, and
   * sharing never came back. The manager captures it synchronously instead;
   * there is nothing for a caller to get wrong. */
  async resumeForForeground(): Promise<void> {
    // Nothing was paused, so there is nothing to resume -- and running the
    // restart path anyway would tear down a working watcher to rebuild it.
    if (this.backgroundAllowed) return;
    this.isPausedForBackground = false;
    const wasBroadcasting = this.wasBroadcastingBeforeBackground;
    this.wasBroadcastingBeforeBackground = false;
    if (!this.ownChannel) return;
    if (wasBroadcasting) {
      // Silently: nobody tapped anything to get here. If the grant is gone,
      // sharing stops and says why, rather than the app demanding permission
      // back every time it is opened.
      const result = await this.setBroadcasting(true, { prompt: false });
      // Sharing was on when the user left and isn't now -- GPS switched off
      // while the app was away being the usual cause. Coming back to a dark
      // button with no explanation is precisely the failure the interrupted
      // channel exists to report, and the result was being thrown away.
      if (!result.ok) this.handlers.onBroadcastInterrupted(result.reason);
    } else {
      await this.trackPresence();
    }
  }

  private subscribeToFriend(friendId: string): void {
    if (this.friendChannels.has(friendId)) return;

    // No presence key: that option names the key WE would track under, and
    // we deliberately never track on a friend's channel -- we only listen.
    // Setting it read as if this device announced itself as the friend.
    const channel = supabase.channel(topicFor(friendId), {
      config: { private: true },
    });

    channel
      .on('broadcast', { event: 'loc' }, ({ payload }) => {
        const loc = parseLocPayload(payload);
        if (!loc) return;
        this.handlers.onFriendLocation({ userId: friendId, ...loc });
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<Partial<PresencePayload>>();
        const entry = state[friendId]?.[0];
        this.handlers.onFriendPresence(friendId, entry?.status ?? 'offline');
        // Reported from this same sync rather than a channel of its own, so
        // presence and journey can never describe different moments. Absent
        // parses to null, which covers all three ways there is nothing to
        // show: no journey, not sharing, or a build that predates this.
        this.handlers.onFriendJourney(friendId, parseSharedJourney(entry?.journey));
      })
      .subscribe((status) => {
        // A denied/failed friend-channel join used to sit silently dead --
        // at minimum, surface it and stop presenting the friend as visible.
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`[location] friend channel for ${friendId} failed to join: ${status}`);
          this.handlers.onFriendPresence(friendId, 'offline');
          this.handlers.onFriendJourney(friendId, null);
        }
      });

    this.friendChannels.set(friendId, channel);
  }

  private unsubscribeFromFriend(friendId: string): void {
    const channel = this.friendChannels.get(friendId);
    if (!channel) return;
    supabase.removeChannel(channel);
    this.friendChannels.delete(friendId);
    this.handlers.onFriendRemoved(friendId);
  }

  /** Reconciles the set of joined friend channels to match the current
   * accepted-friends list -- call whenever that list changes. */
  syncFriendSubscriptions(friendIds: string[]): void {
    const wanted = new Set(friendIds);
    for (const id of Array.from(this.friendChannels.keys())) {
      if (!wanted.has(id)) this.unsubscribeFromFriend(id);
    }
    for (const id of wanted) {
      this.subscribeToFriend(id);
    }
  }

  async teardown(): Promise<void> {
    for (const id of Array.from(this.friendChannels.keys())) {
      this.unsubscribeFromFriend(id);
    }
    await this.leaveOwn();
  }
}

export const locationChannelManager = new LocationChannelManager();
