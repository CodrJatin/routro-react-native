import * as Location from 'expo-location';
import { AppState } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { ConnectionState, FriendLocation, PresenceStatus } from './locationStore';

const BROADCAST_DISTANCE_METERS = 15;
const BROADCAST_INTERVAL_MS = 5000;

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
  /** Deliberately excludes `receivedAt` and `previous` -- both are derived
   * by the store's `upsertFriendLocation`, not by the sender. Stamping
   * `receivedAt` here would put staleness back on the sender's clock, and
   * `previous` only exists relative to what this device already held. */
  onFriendLocation(loc: Omit<FriendLocation, 'receivedAt' | 'previous'>): void;
  onFriendPresence(userId: string, status: PresenceStatus): void;
  onFriendRemoved(userId: string): void;
  onConnectionChange(state: ConnectionState): void;
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

  async setBroadcasting(enabled: boolean): Promise<BroadcastResult> {
    const myBroadcastGeneration = ++this.broadcastGeneration;

    if (!this.ownChannel) {
      this.setIsBroadcasting(false);
      return { ok: false, reason: "You're not connected to the location service yet." };
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

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (myBroadcastGeneration !== this.broadcastGeneration) return { ok: true }; // superseded
    if (status !== 'granted') {
      this.setIsBroadcasting(false);
      return { ok: false, reason: 'Location permission is needed to share your location.' };
    }
    // Presenting the permission alert can itself background the app; don't
    // start transmitting from the background just because the prompt
    // resolved after the fact.
    if (AppState.currentState !== 'active') {
      this.setIsBroadcasting(false);
      return { ok: true }; // backgrounded, not a failure worth alerting about
    }

    // Wait for the channel to have actually joined before installing the
    // watcher -- sending while still joining/reconnecting makes realtime-js
    // silently fall back to one REST POST per message.
    const joined = await this.waitForOwnChannelJoined();
    if (myBroadcastGeneration !== this.broadcastGeneration) return { ok: true }; // superseded
    if (!joined || !this.ownChannel) {
      this.setIsBroadcasting(false);
      return {
        ok: false,
        reason: this.lastChannelError
          ? `Couldn't connect to the location service: ${this.lastChannelError}`
          : "Couldn't reach the location service. Check your connection and try again.",
      };
    }
    // Re-check once more: the ready-wait above can itself span a
    // backgrounding event that the earlier check missed.
    if (AppState.currentState !== 'active') {
      this.setIsBroadcasting(false);
      return { ok: true };
    }

    await this.ownChannel.track({ status: 'broadcasting' satisfies PresenceStatus });
    if (myBroadcastGeneration !== this.broadcastGeneration) return { ok: true }; // superseded

    // Belt-and-suspenders: guarantee any previous watcher is gone before
    // assigning a new one, however it might have gotten there.
    this.stopLocationWatcher();
    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: BROADCAST_DISTANCE_METERS,
        timeInterval: BROADCAST_INTERVAL_MS,
      },
      (position) => {
        // Dropping a fix during a reconnect is cheaper and more honest than
        // realtime-js's silent per-message REST fallback.
        if (!this.ownChannel || this.ownChannel.state !== 'joined') return;
        const payload: LocPayload = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          heading: position.coords.heading,
          ts: position.timestamp,
        };
        this.ownChannel.send({ type: 'broadcast', event: 'loc', payload }).then((result) => {
          if (result !== 'ok') {
            console.warn(`[location] broadcast send did not succeed: ${result}`);
          }
        });
      },
    );

    if (myBroadcastGeneration !== this.broadcastGeneration) {
      // Superseded while awaiting watchPositionAsync -- remove what was just
      // created instead of leaking a watcher with no handle left to stop it.
      subscription.remove();
      return { ok: true };
    }

    this.locationSubscription = subscription;
    this.setIsBroadcasting(true);
    return { ok: true };
  }

  private setIsBroadcasting(enabled: boolean): void {
    this.isBroadcasting = enabled;
    this.handlers.onBroadcastingChange(enabled);
  }

  private stopLocationWatcher(): void {
    this.locationSubscription?.remove();
    this.locationSubscription = null;
  }

  /** App backgrounded: go fully invisible to friends (untrack presence) and
   * stop the location watcher, regardless of whether broadcasting was on.
   * Returns whether broadcasting was active, so the caller can resume it on
   * foreground. */
  async pauseForBackground(): Promise<boolean> {
    // Cancels any in-flight setBroadcasting(true): its own AppState checks
    // can't cover the window between its last check and watchPositionAsync
    // resolving, so backgrounding must actively supersede it rather than
    // rely on it noticing.
    ++this.broadcastGeneration;
    const wasBroadcasting = this.isBroadcasting;
    this.stopLocationWatcher();
    await this.ownChannel?.untrack();
    this.setIsBroadcasting(false);
    return wasBroadcasting;
  }

  async resumeForForeground(wasBroadcasting: boolean): Promise<void> {
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
