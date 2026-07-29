import * as Location from 'expo-location';
import { AppState, Platform } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { ConnectionState, FriendLocation, PresenceStatus } from './locationStore';

const BROADCAST_DISTANCE_METERS = 15;
const BROADCAST_INTERVAL_MS = 5000;
/** How long a fix may go un-transmitted before the last one is simply sent
 * again.
 *
 * `BROADCAST_DISTANCE_METERS` is a hard filter in the OS, not a hint --
 * Android maps it to `setMinUpdateDistanceMeters` and iOS to
 * `CLLocationManager.distanceFilter`, and neither delivers anything at all
 * until the device has moved that far (`timeInterval` does not override it,
 * and iOS ignores that option entirely). So someone standing still --
 * waiting on a platform, which is precisely when a friend is looking for
 * them -- transmitted nothing, went stale on the receiver at 30s and was
 * dropped off the map entirely at 90s while still actively sharing. */
const HEARTBEAT_RESEND_AFTER_MS = 15_000;
/** How often the heartbeat checks. Deliberately shorter than the resend
 * window above, so the worst-case silence is ~20s and stays comfortably
 * inside the receiver's 30s staleness threshold. */
const HEARTBEAT_TICK_MS = 5000;
/** How often to confirm the device still has location switched on while
 * broadcasting. */
const SERVICES_CHECK_INTERVAL_MS = 15_000;
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

function topicFor(userId: string): string {
  return `user-location:${userId}`;
}

interface LocPayload {
  lat: number;
  lon: number;
  heading: number | null;
  ts: number;
}

/** Narrows an untrusted realtime broadcast payload down to a `LocPayload`,
 * or null if it doesn't look like one. This is the trust boundary: only an
 * accepted friend can publish to their own topic, but a client version
 * mismatch is enough to send something malformed, and this flows straight
 * into the native GeoJSON layer's `coordinates` if let through unchecked. */
function parseLocPayload(payload: unknown): LocPayload | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { lat, lon, heading, ts } = payload as Record<string, unknown>;

  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) return null;
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return null;

  const safeHeading = typeof heading === 'number' && Number.isFinite(heading) ? heading : null;
  return { lat, lon, heading: safeHeading, ts };
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
  onFriendRemoved(userId: string): void;
  onConnectionChange(state: ConnectionState): void;
  /** Broadcasting stopped on its own -- GPS switched off, provider error --
   * rather than because the user toggled it. The UI needs to say so, since
   * the alternative is the button quietly staying lit while nothing is
   * actually being shared. */
  onBroadcastInterrupted(reason: string): void;
}

/** Why a broadcast toggle didn't take effect, so the UI can say so instead
 * of just failing to light up. `ok` is also true for benign no-ops (the call
 * was superseded, or the app backgrounded mid-flight). */
export type BroadcastResult = { ok: true } | { ok: false; reason: string };

const noopHandlers: LocationManagerHandlers = {
  onBroadcastingChange() {},
  onFriendLocation() {},
  onFriendPresence() {},
  onFriendRemoved() {},
  onConnectionChange() {},
  onBroadcastInterrupted() {},
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
  /** Set while the app is backgrounded. Checked after the location watcher
   * is created, so an enable that was in flight across a backgrounding tears
   * its watcher back down -- without cancelling enables that merely paused
   * behind a permission dialog. */
  private isPausedForBackground = false;
  private servicesWatchdog: ReturnType<typeof setInterval> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  /** The last fix actually put on the wire, kept so the heartbeat can repeat
   * it verbatim. Its `ts` stays at the original reading's time rather than
   * being restamped: it describes when the position was taken, not when it
   * was last transmitted, and the receiver uses that identity to tell a
   * repeat apart from real movement. */
  private lastSentFix: LocPayload | null = null;
  private lastSentAt = 0;
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

  async joinOwn(userId: string): Promise<void> {
    if (this.ownChannel && this.ownUserId === userId) return;
    const myGeneration = ++this.generation;
    await this.cleanupOwnChannel();
    if (myGeneration !== this.generation) return; // superseded while awaiting cleanup

    this.ownUserId = userId;
    const channel = supabase.channel(topicFor(userId), {
      config: { private: true, presence: { key: userId } },
    });
    this.handlers.onConnectionChange('connecting');

    channel.subscribe(async (status, error) => {
      if (myGeneration !== this.generation) return; // superseded

      if (status === 'SUBSCRIBED') {
        // Re-track the manager's real current status, not a literal --
        // this callback also fires on every reconnect, and a network blip
        // must not silently downgrade an active broadcaster to 'online'.
        await channel.track({ status: this.isBroadcasting ? 'broadcasting' : 'online' satisfies PresenceStatus });
        this.lastChannelError = null;
        this.handlers.onConnectionChange('connected');
        return;
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        // A denied or failed join means nothing is transmitting -- stop the
        // watcher so `isBroadcasting` (now false) matches reality instead of
        // a ghost watcher silently resuming sends on reconnect.
        this.stopLocationWatcher();
        this.setIsBroadcasting(false);
        this.lastChannelError = error?.message ?? status;
        this.handlers.onConnectionChange('error');
        return;
      }

      if (status === 'CLOSED') {
        // NOT an error: CLOSED is a normal lifecycle event (socket drop,
        // rejoin, leave) and realtime-js reconnects on its own. Treating it
        // as fatal is what previously left the connection banner stuck on
        // and every later broadcast attempt refused.
        this.stopLocationWatcher();
        this.setIsBroadcasting(false);
        this.handlers.onConnectionChange('connecting');
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
  private async rejoinOwnChannel(): Promise<void> {
    const userId = this.ownUserId;
    if (!userId) return;
    await this.cleanupOwnChannel(); // clears ownUserId, hence the capture above
    await this.joinOwn(userId);
  }

  /** Public exit point -- bumps generation so any in-flight joinOwn call
   * detects it's been superseded and discards its work instead of
   * clobbering the (now torn-down) state. Also bumps broadcastGeneration so
   * an in-flight setBroadcasting(true) call can't install a watcher after
   * the user has signed out. */
  async leaveOwn(): Promise<void> {
    ++this.generation;
    ++this.broadcastGeneration;
    await this.cleanupOwnChannel();
  }

  private cleanupOwnChannel(): Promise<void> {
    const run = async () => {
      this.stopLocationWatcher();
      // Must clear the flag too, not just the watcher: it is what the
      // subscribe callback re-tracks presence from, so leaving it set meant
      // signing out while broadcasting and back in advertised the new
      // session as 'broadcasting' with no watcher actually running.
      this.setIsBroadcasting(false);
      const channel = this.ownChannel;
      this.ownChannel = null;
      this.lastChannelError = null;
      this.ownUserId = null;
      if (channel) {
        await channel.untrack();
        await supabase.removeChannel(channel);
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

  async setBroadcasting(enabled: boolean): Promise<BroadcastResult> {
    const myBroadcastGeneration = ++this.broadcastGeneration;

    if (!this.ownChannel) {
      return this.refuse('no-channel', "You're not connected to the location service yet.");
    }

    if (!enabled) {
      this.stopLocationWatcher();
      await this.ownChannel.track({ status: 'online' satisfies PresenceStatus });
      if (myBroadcastGeneration !== this.broadcastGeneration) return { ok: true };
      this.setIsBroadcasting(false);
      return { ok: true };
    }

    // Already broadcasting with a live watcher -- nothing to do, and
    // re-requesting permission/re-tracking would be redundant.
    if (this.isBroadcasting && this.locationSubscription) return { ok: true };

    console.warn(
      `[broadcast] starting appState=${String(AppState.currentState)} channelState=${this.ownChannel.state}`,
    );

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (myBroadcastGeneration !== this.broadcastGeneration) {
      return this.refuse(
        'superseded-permission',
        'Sharing was interrupted while asking for permission. Try again.',
      );
    }
    if (status !== 'granted') {
      return this.refuse(
        'permission-denied',
        'Location permission is needed to share your location.',
      );
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
      return this.refuse(
        'superseded-foreground',
        'Sharing was interrupted while returning to the app. Try again.',
      );
    }

    // Permission granted is not the same as GPS being switched on. Without
    // this, broadcasting "started" happily and then never produced a single
    // fix, leaving the button lit while nothing was shared.
    if (!(await this.hasLocationServices())) {
      // Android can offer to switch location on right here, without sending
      // the user off to Settings -- so ask, rather than telling them to go do
      // it themselves and come back.
      const accepted = await this.promptToEnableLocationServices();
      if (myBroadcastGeneration !== this.broadcastGeneration) {
        return this.refuse(
          'superseded-services-prompt',
          'Sharing was interrupted while turning location on. Try again.',
        );
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
        return this.refuse(
          'superseded-services-foreground',
          'Sharing was interrupted while turning location on. Try again.',
        );
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
        return this.refuse(
          'superseded-services-wait',
          'Sharing was interrupted while turning location on. Try again.',
        );
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
      return this.refuse(
        'superseded-join',
        'Sharing was interrupted while connecting. Try again.',
      );
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
        return this.refuse(
          'superseded-rejoin',
          'Sharing was interrupted while reconnecting. Try again.',
        );
      }
      joined = await this.waitForOwnChannelJoined(REJOIN_WAIT_MS);
      if (myBroadcastGeneration !== this.broadcastGeneration) {
        return this.refuse(
          'superseded-rejoin-wait',
          'Sharing was interrupted while reconnecting. Try again.',
        );
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
    await this.ownChannel.track({ status: 'broadcasting' satisfies PresenceStatus });
    if (myBroadcastGeneration !== this.broadcastGeneration) return { ok: true }; // superseded

    // Belt-and-suspenders: guarantee any previous watcher is gone before
    // assigning a new one, however it might have gotten there.
    this.stopLocationWatcher();

    let subscription: Location.LocationSubscription;
    try {
      subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: BROADCAST_DISTANCE_METERS,
        timeInterval: BROADCAST_INTERVAL_MS,
      },
      (position) => {
        this.sendFix({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          heading: position.coords.heading,
          ts: position.timestamp,
        });
      },
      // Third argument, previously omitted: the provider reporting a problem
      // (GPS switched off mid-session being the obvious one) used to go
      // nowhere, so sharing looked healthy while no fix would ever arrive.
      (reason) => this.interruptBroadcast(reason),
      );
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
      return this.refuse(
        'superseded-watcher',
        'Sharing was interrupted while starting GPS. Try again.',
      );
    }
    // The app backgrounded while the watcher was being created. This is the
    // window pauseForBackground() can't cover on its own, and the reason it
    // no longer needs to cancel the whole attempt to stay safe.
    if (this.isPausedForBackground) {
      subscription.remove();
      return this.refuse(
        'backgrounded-late',
        'The app left the foreground before sharing could start. Try again.',
      );
    }

    this.locationSubscription = subscription;
    this.startServicesWatchdog();
    this.setIsBroadcasting(true);
    // After setIsBroadcasting: the heartbeat checks that flag before sending.
    this.startHeartbeat();
    return { ok: true };
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
    this.heartbeat = setInterval(() => {
      const fix = this.lastSentFix;
      if (!fix || !this.isBroadcasting) return;
      if (Date.now() - this.lastSentAt < HEARTBEAT_RESEND_AFTER_MS) return;
      this.sendFix(fix);
    }, HEARTBEAT_TICK_MS);
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
    this.servicesWatchdog = setInterval(async () => {
      if (!this.isBroadcasting) return;
      if (!(await this.hasLocationServices())) {
        this.interruptBroadcast('Location was turned off on this device.');
      }
    }, SERVICES_CHECK_INTERVAL_MS);
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
    void this.ownChannel?.track({ status: 'online' satisfies PresenceStatus });
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

  /** App backgrounded: go fully invisible to friends (untrack presence) and
   * stop the location watcher, regardless of whether broadcasting was on.
   * Returns whether broadcasting was active, so the caller can resume it on
   * foreground. */
  async pauseForBackground(): Promise<boolean> {
    // Deliberately does NOT bump broadcastGeneration. Requesting location
    // permission opens a system dialog, which backgrounds the app and lands
    // here -- bumping the generation made an in-flight setBroadcasting()
    // cancel itself the moment it asked for permission. The paused flag
    // below, re-checked after the watcher is created, closes the same window
    // without the self-cancellation.
    this.isPausedForBackground = true;
    const wasBroadcasting = this.isBroadcasting;
    this.stopLocationWatcher();
    await this.ownChannel?.untrack();
    this.setIsBroadcasting(false);
    return wasBroadcasting;
  }

  async resumeForForeground(wasBroadcasting: boolean): Promise<void> {
    this.isPausedForBackground = false;
    if (!this.ownChannel) return;
    if (wasBroadcasting) {
      await this.setBroadcasting(true);
    } else {
      await this.ownChannel.track({ status: 'online' satisfies PresenceStatus });
    }
  }

  private subscribeToFriend(friendId: string): void {
    if (this.friendChannels.has(friendId)) return;

    const channel = supabase.channel(topicFor(friendId), {
      config: { private: true, presence: { key: friendId } },
    });

    channel
      .on('broadcast', { event: 'loc' }, ({ payload }) => {
        const loc = parseLocPayload(payload);
        if (!loc) return;
        this.handlers.onFriendLocation({ userId: friendId, ...loc });
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<{ status: PresenceStatus }>();
        const status = state[friendId]?.[0]?.status ?? 'offline';
        this.handlers.onFriendPresence(friendId, status);
      })
      .subscribe((status) => {
        // A denied/failed friend-channel join used to sit silently dead --
        // at minimum, surface it and stop presenting the friend as visible.
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`[location] friend channel for ${friendId} failed to join: ${status}`);
          this.handlers.onFriendPresence(friendId, 'offline');
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
