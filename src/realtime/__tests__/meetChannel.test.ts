import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The meet channel's repair path and its reachability reporting.
 *
 * Both exist for the same failure: one pair's channel refusing to join used to
 * leave that friend permanently unable to be asked or to ask, while the button
 * that sends stayed lit -- because reachability was answered from a Map the
 * channel was inserted into before it had joined.
 */

type SubscribeStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';

interface FakeChannel {
  topic: string;
  state: string;
  sent: unknown[];
  handlers: Record<string, (payload: { payload: unknown }) => void>;
  emit(status: SubscribeStatus): void;
  subscribe(cb?: (status: SubscribeStatus) => void): FakeChannel;
  on(type: string, filter: unknown, handler: (p: { payload: unknown }) => void): FakeChannel;
  send(message: unknown): Promise<string>;
}

let channels: FakeChannel[] = [];
let removed: FakeChannel[] = [];

function makeChannel(topic: string): FakeChannel {
  let callback: ((status: SubscribeStatus) => void) | undefined;
  const channel: FakeChannel = {
    topic,
    state: 'closed',
    sent: [],
    handlers: {},
    emit(status) {
      if (status === 'SUBSCRIBED') channel.state = 'joined';
      else channel.state = 'errored';
      callback?.(status);
    },
    subscribe(cb) {
      callback = cb;
      return channel;
    },
    on(type, _filter, handler) {
      channel.handlers[type] = handler;
      return channel;
    },
    async send(message) {
      channel.sent.push(message);
      return 'ok';
    },
  };
  channels.push(channel);
  return channel;
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    channel: (topic: string) => makeChannel(topic),
    removeChannel: async (channel: FakeChannel) => {
      removed.push(channel);
      return 'ok';
    },
  },
}));

const { meetChannelManager } = await import('../meetChannel');

const SELF = 'aaaaaaaa-0000-0000-0000-000000000000';
const FRIEND = 'bbbbbbbb-0000-0000-0000-000000000000';
const OTHER = 'cccccccc-0000-0000-0000-000000000000';

/** Reachability as reported through the handler -- the only way the UI learns
 * it, and so the only thing worth asserting on. */
let reach: Record<string, boolean> = {};
/** How many reachability changes have been published, to check the dedup. */
let changes = 0;

/** What the Meet button actually reads: absent means unreachable, exactly as
 * `Boolean(state.reachable[id])` resolves it in the store. */
function effectiveReach(friendId: string): boolean {
  return reach[friendId] ?? false;
}

/** The channel for a friend that has not been torn down. */
function liveChannel(friendId: string): FakeChannel {
  const found = channels.filter((c) => c.topic.includes(friendId) && !removed.includes(c));
  return found[found.length - 1];
}

beforeEach(() => {
  meetChannelManager.teardown();
  channels = [];
  removed = [];
  reach = {};
  changes = 0;
  vi.useFakeTimers();
  meetChannelManager.setHandlers({
    onMessage() {},
    onReachabilityChange(friendId, canReach) {
      reach[friendId] = canReach;
      changes += 1;
    },
  });
  meetChannelManager.setSelf(SELF);
});

describe('reachability', () => {
  it('is not claimed merely because a join was attempted', () => {
    meetChannelManager.syncFriends([FRIEND]);
    // The channel object exists, but nothing has joined yet. This is the state
    // the old `canReach` reported as reachable.
    expect(reach[FRIEND]).toBeUndefined();
  });

  it('is reported once the channel actually joins', () => {
    meetChannelManager.syncFriends([FRIEND]);
    liveChannel(FRIEND).emit('SUBSCRIBED');
    expect(reach[FRIEND]).toBe(true);
  });

  it('stays unclaimed when the first join is refused', () => {
    meetChannelManager.syncFriends([FRIEND]);
    liveChannel(FRIEND).emit('CHANNEL_ERROR');
    // No event, deliberately: the store defaults to unreachable, so there is
    // no change to publish. What matters is the effective answer the button
    // reads, which is what this asserts.
    expect(effectiveReach(FRIEND)).toBe(false);
  });

  it('is withdrawn when a channel that had joined then fails', () => {
    meetChannelManager.syncFriends([FRIEND]);
    liveChannel(FRIEND).emit('SUBSCRIBED');
    expect(effectiveReach(FRIEND)).toBe(true);

    // This one does have to be published -- the button is currently lit.
    liveChannel(FRIEND).emit('CHANNEL_ERROR');
    expect(reach[FRIEND]).toBe(false);
    expect(effectiveReach(FRIEND)).toBe(false);
  });

  it('publishes a change once, not once per failure event', () => {
    meetChannelManager.syncFriends([FRIEND]);
    liveChannel(FRIEND).emit('SUBSCRIBED');
    changes = 0;
    liveChannel(FRIEND).emit('CHANNEL_ERROR');
    liveChannel(FRIEND).emit('CHANNEL_ERROR');
    liveChannel(FRIEND).emit('TIMED_OUT');
    expect(changes).toBe(1);
  });

  it('is withdrawn when the friend goes away', () => {
    meetChannelManager.syncFriends([FRIEND]);
    liveChannel(FRIEND).emit('SUBSCRIBED');
    expect(reach[FRIEND]).toBe(true);

    meetChannelManager.syncFriends([]);
    expect(reach[FRIEND]).toBe(false);
  });
});

describe('send', () => {
  it('refuses on a channel that never joined, rather than falling back to REST', async () => {
    meetChannelManager.syncFriends([FRIEND]);
    const sent = await meetChannelManager.send(FRIEND, { kind: 'cancel', id: 'x' } as never);
    expect(sent).toBe(false);
    expect(liveChannel(FRIEND).sent).toHaveLength(0);
  });

  it('sends once joined', async () => {
    meetChannelManager.syncFriends([FRIEND]);
    liveChannel(FRIEND).emit('SUBSCRIBED');
    const sent = await meetChannelManager.send(FRIEND, { kind: 'cancel', id: 'x' } as never);
    expect(sent).toBe(true);
  });
});

describe('rejoin ladder', () => {
  it('rebuilds a channel that failed on its own', async () => {
    meetChannelManager.syncFriends([FRIEND]);
    const first = liveChannel(FRIEND);
    first.emit('CHANNEL_ERROR');

    await vi.advanceTimersByTimeAsync(3000);
    expect(removed).toContain(first);

    const second = liveChannel(FRIEND);
    expect(second).not.toBe(first);
    second.emit('SUBSCRIBED');
    expect(reach[FRIEND]).toBe(true);
  });

  it('does not advance the ramp for repeat failures of one drop', async () => {
    meetChannelManager.syncFriends([FRIEND]);
    const first = liveChannel(FRIEND);
    // realtime-js emits several of these per drop.
    first.emit('CHANNEL_ERROR');
    first.emit('CHANNEL_ERROR');
    first.emit('TIMED_OUT');

    await vi.advanceTimersByTimeAsync(3000);
    // One rebuild, not three.
    expect(removed.filter((c) => c === first)).toHaveLength(1);
    expect(channels.filter((c) => c.topic.includes(FRIEND))).toHaveLength(2);
  });

  it('keeps retrying indefinitely, settling into the flat interval', async () => {
    meetChannelManager.syncFriends([FRIEND]);
    const attemptsAfter = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      return channels.filter((c) => c.topic.includes(FRIEND)).length;
    };

    liveChannel(FRIEND).emit('CHANNEL_ERROR');
    expect(await attemptsAfter(3000)).toBe(2);
    liveChannel(FRIEND).emit('CHANNEL_ERROR');
    expect(await attemptsAfter(7000)).toBe(3);
    // Past the ramp: flat, and still going.
    liveChannel(FRIEND).emit('CHANNEL_ERROR');
    expect(await attemptsAfter(10_000)).toBe(4);
    liveChannel(FRIEND).emit('CHANNEL_ERROR');
    expect(await attemptsAfter(10_000)).toBe(5);
  });

  it('does not reopen a channel for someone unfriended while the retry was pending', async () => {
    meetChannelManager.syncFriends([FRIEND]);
    liveChannel(FRIEND).emit('CHANNEL_ERROR');

    meetChannelManager.syncFriends([]);
    await vi.advanceTimersByTimeAsync(30_000);

    // The one from the initial join, and nothing since.
    expect(channels.filter((c) => c.topic.includes(FRIEND))).toHaveLength(1);
  });

  it('repairs one friend without disturbing another', async () => {
    meetChannelManager.syncFriends([FRIEND, OTHER]);
    const otherChannel = liveChannel(OTHER);
    otherChannel.emit('SUBSCRIBED');
    liveChannel(FRIEND).emit('CHANNEL_ERROR');

    await vi.advanceTimersByTimeAsync(3000);

    expect(removed).not.toContain(otherChannel);
    expect(reach[OTHER]).toBe(true);
    expect(channels.filter((c) => c.topic.includes(OTHER))).toHaveLength(1);
  });

  it('runs a due rejoin from the tick, for when the JS timer never fires', async () => {
    meetChannelManager.syncFriends([FRIEND]);
    const first = liveChannel(FRIEND);
    first.emit('CHANNEL_ERROR');

    // The app is backgrounded: the timer above does not run, but the journey
    // service's tick does. Time passes without the timer being allowed to fire.
    vi.setSystemTime(Date.now() + 10_000);
    meetChannelManager.tick();
    await vi.advanceTimersByTimeAsync(0);

    expect(removed).toContain(first);
    expect(channels.filter((c) => c.topic.includes(FRIEND))).toHaveLength(2);
  });

  it('drops pending retries on teardown', async () => {
    meetChannelManager.syncFriends([FRIEND]);
    liveChannel(FRIEND).emit('CHANNEL_ERROR');

    meetChannelManager.teardown();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(channels.filter((c) => c.topic.includes(FRIEND))).toHaveLength(1);
  });
});
