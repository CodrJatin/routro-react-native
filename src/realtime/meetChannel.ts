import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import {
  MEET_EVENT,
  meetTopicFor,
  parseMeetMessage,
  type MeetMessage,
} from './meetMessage';

export interface MeetChannelHandlers {
  /** A message from `friendId`, already narrowed. Malformed payloads never
   * get here. */
  onMessage(friendId: string, message: MeetMessage): void;
}

const noopHandlers: MeetChannelHandlers = { onMessage() {} };

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
    if (!channel) return false;
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

  /** Whether a channel for this friend exists at all. The UI uses it to keep
   * the Meet button from offering something that cannot be delivered. */
  canReach(friendId: string): boolean {
    return this.channels.has(friendId);
  }

  teardown(): void {
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
      .subscribe((status) => {
        // A refused join means requests to (and from) this friend will fail.
        // Say so in the log rather than leaving a dead channel that silently
        // swallows everything -- `send` already reports the failure upward.
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`[meet] channel for ${friendId} failed to join: ${status}`);
        }
      });

    this.channels.set(friendId, channel);
  }

  private leave(friendId: string): void {
    const channel = this.channels.get(friendId);
    if (!channel) return;
    this.channels.delete(friendId);
    void supabase.removeChannel(channel).catch((error: unknown) => {
      console.warn('[meet] removeChannel failed', error);
    });
  }

  private removeAll(): void {
    for (const id of Array.from(this.channels.keys())) {
      this.leave(id);
    }
  }
}

export const meetChannelManager = new MeetChannelManager();
