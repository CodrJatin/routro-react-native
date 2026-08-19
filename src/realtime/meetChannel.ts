import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import {
  MEET_EVENT,
  meetTopicFor,
  parseMeetMessage,
  type MeetMessage,
} from './meetMessage';
import { rejoinDelayFor } from './rejoinBackoff';

export interface MeetChannelHandlers {
  /** A message from `friendId`, already narrowed. Malformed payloads never
   * get here. */
  onMessage(friendId: string, message: MeetMessage): void;
  /**
   * Whether a meet can actually be sent to this friend right now.
   *
   * Reported rather than polled because the answer changes asynchronously --
   * a channel joins, fails, or is repaired long after the screen that cares
   * about it last rendered. The UI used to ask a synchronous `canReach()`
   * during render, which could only ever be right by accident: it answered
   * from a Map that a channel was inserted into before it had joined, so a
   * refused join read as reachable forever.
   */
  onReachabilityChange(friendId: string, canReach: boolean): void;
}

const noopHandlers: MeetChannelHandlers = {
  onMessage() {},
  onReachabilityChange() {},
};

/**
 * One private channel per accepted friend, for meet requests and their
 * replies.
 *
 * Deliberately separate from `locationChannelManager` rather than another map
 * inside it. The location channel is a fan-out: one topic per person, every
 * friend listening. This is a conversation: one topic per *pair*, exactly two
 * people on it, enforced server-side (see
 * supabase/migrations/0006_meet_requests.sql). Folding the two together would
 * have meant asking one friend to meet in a room all of them are standing in.
 *
 * Like the location channels, nothing here is ever written to a table -- a
 * meet request exists in memory on two phones for thirty seconds and then
 * doesn't.
 */
class MeetChannelManager {
  private handlers: MeetChannelHandlers = noopHandlers;
  private selfUserId: string | null = null;
  private channels = new Map<string, RealtimeChannel>();
  /**
   * Pending rejoins, keyed by friend. Per-friend rather than one shared timer,
   * for the same reason the location friend channels are: one pair whose
   * channel is refusing must not hold up everyone else's recovery.
   */
  private retries = new Map<
    string,
    { attempt: number; dueAt: number; timer: ReturnType<typeof setTimeout> | null }
  >();
  /** The accepted-friends list as last reconciled, so a rejoin that resolves
   * later can ask whether the friend it is repairing is still one. */
  private wantedFriendIds = new Set<string>();
  /** Who has been reported as reachable, so a repeat status for an unchanged
   * channel doesn't publish a redundant update into the store. */
  private reachable = new Set<string>();

  setHandlers(handlers: MeetChannelHandlers): void {
    this.handlers = handlers;
  }

  /**
   * Whose channels these are. Changing it drops every channel: a topic is
   * named after both halves of the pair, so none of them survives a different
   * user signing in.
   */
  setSelf(userId: string | null): void {
    if (this.selfUserId === userId) return;
    this.selfUserId = userId;
    this.removeAll();
  }

  /** Reconciles joined channels against the accepted-friends list. Call
   * whenever that list changes -- an unfriended pair's channel would fail RLS
   * on its next rejoin anyway, but leaving it joined until then is a channel
   * still holding the socket for a conversation that can't happen. */
  syncFriends(friendIds: string[]): void {
    if (!this.selfUserId) {
      this.removeAll();
      return;
    }
    const wanted = new Set(friendIds);
    // Held on the manager, because a rejoin resolving after this ran has to be
    // able to ask whether the friend it is repairing is still wanted.
    this.wantedFriendIds = wanted;
    for (const id of Array.from(this.channels.keys())) {
      if (!wanted.has(id)) this.leave(id);
    }
    for (const id of wanted) {
      this.join(id);
    }
  }

  /**
   * Puts a message on a friend's pair channel. Resolves false when it could
   * not be sent, so the caller can say so rather than leaving the user
   * believing they asked someone who never heard.
   */
  async send(friendId: string, message: MeetMessage): Promise<boolean> {
    const channel = this.channels.get(friendId);
    // Checked, not merely fetched. A channel object exists from the moment the
    // join is *attempted*, and sending on one that never joined hands the
    // message to realtime-js's per-message REST fallback -- which is a
    // different delivery path with different authorization, arriving (or not)
    // with nothing here able to tell which happened.
    if (!channel || channel.state !== 'joined') return false;
    try {
      const result = await channel.send({
        type: 'broadcast',
        event: MEET_EVENT,
        payload: message,
      });
      return result === 'ok';
    } catch (error) {
      console.warn('[meet] send failed', error);
      return false;
    }
  }

  /**
   * Runs any rejoin that has come due, from the journey service's tick.
   *
   * The JS timers below stop dead while the app is backgrounded, which is
   * where a journey spends most of its life -- and being asked to meet someone
   * is at its most useful precisely then. Same arrangement as
   * `locationChannelManager.tick()`, and idempotent for the same reason.
   */
  tick(): void {
    const now = Date.now();
    for (const [friendId, entry] of Array.from(this.retries)) {
      if (entry.dueAt !== 0 && now >= entry.dueAt) void this.rejoin(friendId);
    }
  }

  teardown(): void {
    // Emptied before the loop, and load-bearing: a `rejoin` that is mid-await
    // has already taken its channel out of `channels`, so the loop below
    // cannot see it, and it resubscribes on the strength of this set alone
    // once its await resolves.
    this.wantedFriendIds = new Set();
    this.removeAll();
    this.selfUserId = null;
  }

  private join(friendId: string): void {
    if (!this.selfUserId || this.channels.has(friendId)) return;

    // No presence: this channel carries messages only. Tracking on it would
    // publish a second, redundant "I am here" that nothing reads.
    const channel = supabase.channel(meetTopicFor(this.selfUserId, friendId), {
      config: { private: true },
    });

    channel
      .on('broadcast', { event: MEET_EVENT }, ({ payload }) => {
        const message = parseMeetMessage(payload);
        if (!message) return;
        this.handlers.onMessage(friendId, message);
      })
      .subscribe((status, error) => {
        if (status === 'SUBSCRIBED') {
          this.clearRetry(friendId);
          this.setReachable(friendId, true);
          return;
        }
        // A refused join means requests to and from this friend will fail.
        // Reporting it was already right; leaving it there was not. This is a
        // conversation with exactly one other person, so a channel that never
        // comes back means that one friend silently cannot be asked and cannot
        // ask -- with nothing on screen to say so, and no way to recover short
        // of the friends list happening to change.
        //
        // A socket-level drop is handled for free, because realtime-js rejoins
        // every channel when the socket returns. This is for what that does
        // not cover: a single channel failing on its own, an authorization
        // check that momentarily said no being the likely one.
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(
            `[meet] channel for ${friendId} failed to join: ${status}` +
              `${error ? ` -- ${error.message}` : ''}`,
          );
          this.setReachable(friendId, false);
          this.scheduleRejoin(friendId);
        }
      });

    this.channels.set(friendId, channel);
  }

  /** Queues another attempt at one friend's channel. Same ladder as the
   * location channels, and indefinite for the same reason: there is no failed
   * end-state worth declaring, only a channel that is not back *yet*. */
  private scheduleRejoin(friendId: string): void {
    const existing = this.retries.get(friendId);
    // Already queued. realtime-js emits several failures per drop and each
    // must not advance the ramp on its own.
    if (existing && (existing.timer !== null || existing.dueAt !== 0)) return;

    const attempt = (existing?.attempt ?? 0) + 1;
    const delay = rejoinDelayFor(attempt);
    const timer = setTimeout(() => {
      const entry = this.retries.get(friendId);
      if (entry) entry.timer = null;
      void this.rejoin(friendId);
    }, delay);
    this.retries.set(friendId, { attempt, dueAt: Date.now() + delay, timer });
  }

  /** Rebuilds one friend's channel. */
  private async rejoin(friendId: string): Promise<void> {
    const entry = this.retries.get(friendId);
    // Claimed by whichever of the timer and `tick()` got here first.
    if (!entry || entry.dueAt === 0) return;
    entry.dueAt = 0;
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }

    const channel = this.channels.get(friendId);
    if (!channel) return; // left while this was pending

    // Deliberately not `leave`, which is a removal: it reports the friend
    // unreachable and, at the caller, forgets the pair's meet state. This is a
    // repair of a channel we still want, so an agreed meet must survive it.
    this.channels.delete(friendId);
    try {
      await supabase.removeChannel(channel);
    } catch (error) {
      console.warn(`[meet] removeChannel failed rejoining ${friendId}`, error);
    }

    // Checked after the await, not before: the friendship can end, or the user
    // can sign out, while this is in flight -- and resubscribing then would
    // reopen a channel the server is about to refuse anyway.
    if (!this.wantedFriendIds.has(friendId)) {
      this.retries.delete(friendId);
      return;
    }
    this.join(friendId);
  }

  private clearRetry(friendId: string): void {
    const entry = this.retries.get(friendId);
    if (!entry) return;
    if (entry.timer !== null) clearTimeout(entry.timer);
    this.retries.delete(friendId);
  }

  /** Publishes a change, and only a change -- realtime-js reports the same
   * status repeatedly across one drop. */
  private setReachable(friendId: string, canReach: boolean): void {
    if (this.reachable.has(friendId) === canReach) return;
    if (canReach) this.reachable.add(friendId);
    else this.reachable.delete(friendId);
    this.handlers.onReachabilityChange(friendId, canReach);
  }

  private leave(friendId: string): void {
    // Cleared first and unconditionally: a pending retry for a friend who is
    // no longer wanted would otherwise fire and reopen their channel.
    this.clearRetry(friendId);
    const channel = this.channels.get(friendId);
    if (!channel) return;
    this.channels.delete(friendId);
    this.setReachable(friendId, false);
    void supabase.removeChannel(channel).catch((error: unknown) => {
      console.warn('[meet] removeChannel failed', error);
    });
  }

  private removeAll(): void {
    for (const id of Array.from(this.channels.keys())) {
      this.leave(id);
    }
    // Retries for friends whose channel had already been torn down by a failed
    // rejoin still hold a live timer; `leave` above only reaches the ones with
    // a channel left to remove.
    for (const id of Array.from(this.retries.keys())) {
      this.clearRetry(id);
    }
  }
}

export const meetChannelManager = new MeetChannelManager();
