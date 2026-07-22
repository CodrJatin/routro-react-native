import * as Location from 'expo-location';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { FriendLocation, PresenceStatus } from './locationStore';

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

/** Callbacks the manager reports through instead of writing to app state
 * directly -- it owns Realtime channels and the location watcher, nothing
 * about where that data ends up. The one real caller (LocationProvider)
 * wires these straight into the Zustand store. */
export interface LocationManagerHandlers {
  onBroadcastingChange(enabled: boolean): void;
  onFriendLocation(loc: FriendLocation): void;
  onFriendPresence(userId: string, status: PresenceStatus): void;
  onFriendRemoved(userId: string): void;
}

const noopHandlers: LocationManagerHandlers = {
  onBroadcastingChange() {},
  onFriendLocation() {},
  onFriendPresence() {},
  onFriendRemoved() {},
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
  private friendChannels = new Map<string, RealtimeChannel>();
  private locationSubscription: Location.LocationSubscription | null = null;
  private isBroadcasting = false;
  /** Bumped on every joinOwn/teardown call so a stale async call that
   * finishes after a newer one started can detect it's obsolete and bail
   * out instead of clobbering state a subsequent call already set up. */
  private generation = 0;

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
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED' && myGeneration === this.generation) {
        await channel.track({ status: 'online' satisfies PresenceStatus });
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
   * clobbering the (now torn-down) state. */
  async leaveOwn(): Promise<void> {
    ++this.generation;
    await this.cleanupOwnChannel();
  }

  private async cleanupOwnChannel(): Promise<void> {
    await this.stopLocationWatcher();
    if (this.ownChannel) {
      await this.ownChannel.untrack();
      await supabase.removeChannel(this.ownChannel);
      this.ownChannel = null;
    }
    this.ownUserId = null;
  }

  async setBroadcasting(enabled: boolean): Promise<void> {
    if (!this.ownChannel) {
      this.setIsBroadcasting(false);
      return;
    }

    if (!enabled) {
      await this.stopLocationWatcher();
      await this.ownChannel.track({ status: 'online' satisfies PresenceStatus });
      this.setIsBroadcasting(false);
      return;
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      this.setIsBroadcasting(false);
      return;
    }

    await this.ownChannel.track({ status: 'broadcasting' satisfies PresenceStatus });
    this.locationSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: BROADCAST_DISTANCE_METERS,
        timeInterval: BROADCAST_INTERVAL_MS,
      },
      (position) => {
        const payload: LocPayload = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          heading: position.coords.heading,
          ts: position.timestamp,
        };
        this.ownChannel?.send({ type: 'broadcast', event: 'loc', payload });
      },
    );
    this.setIsBroadcasting(true);
  }

  private setIsBroadcasting(enabled: boolean): void {
    this.isBroadcasting = enabled;
    this.handlers.onBroadcastingChange(enabled);
  }

  private async stopLocationWatcher(): Promise<void> {
    this.locationSubscription?.remove();
    this.locationSubscription = null;
  }

  /** App backgrounded: go fully invisible to friends (untrack presence) and
   * stop the location watcher, regardless of whether broadcasting was on.
   * Returns whether broadcasting was active, so the caller can resume it on
   * foreground. */
  async pauseForBackground(): Promise<boolean> {
    const wasBroadcasting = this.isBroadcasting;
    await this.stopLocationWatcher();
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
        const loc = payload as LocPayload;
        this.handlers.onFriendLocation({ userId: friendId, ...loc });
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<{ status: PresenceStatus }>();
        const status = state[friendId]?.[0]?.status ?? 'offline';
        this.handlers.onFriendPresence(friendId, status);
      })
      .subscribe();

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
