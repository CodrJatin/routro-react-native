import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Covers the broadcast state machine's hard cases: the ones that can't be
 * caught by a typecheck and are painful to reproduce by hand on a device --
 * backgrounding mid-permission-prompt, re-entrant enables, socket
 * reconnects, and malformed payloads from a peer.
 */

type SubscribeStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';

interface FakeChannel {
  topic: string;
  state: string;
  tracked: { status: string }[];
  sent: unknown[];
  handlers: Record<string, (payload: { payload: unknown }) => void>;
  emit(status: SubscribeStatus): Promise<void>;
  subscribe(cb?: (status: SubscribeStatus) => void | Promise<void>): FakeChannel;
  on(type: string, filter: unknown, handler: (p: { payload: unknown }) => void): FakeChannel;
  track(payload: { status: string }): Promise<string>;
  untrack(): Promise<string>;
  send(message: unknown): Promise<string>;
  presenceState(): Record<string, unknown>;
}

const channels: FakeChannel[] = [];

function makeChannel(topic: string): FakeChannel {
  let callback: ((status: SubscribeStatus) => void | Promise<void>) | undefined;
  const channel: FakeChannel = {
    topic,
    state: 'closed',
    tracked: [],
    sent: [],
    handlers: {},
    async emit(status) {
      if (status === 'SUBSCRIBED') channel.state = 'joined';
      await callback?.(status);
    },
    subscribe(cb) {
      callback = cb;
      return channel;
    },
    on(type, _filter, handler) {
      channel.handlers[type] = handler;
      return channel;
    },
    async track(payload) {
      channel.tracked.push(payload);
      return 'ok';
    },
    async untrack() {
      return 'ok';
    },
    async send(message) {
      channel.sent.push(message);
      return 'ok';
    },
    presenceState: () => ({}),
  };
  channels.push(channel);
  return channel;
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    channel: (topic: string) => makeChannel(topic),
    removeChannel: async () => 'ok',
  },
}));

/** Watchers handed out by watchPositionAsync, so tests can assert none leak. */
const watchers: { removed: boolean; fire: (position: unknown) => void; fail: (reason: string) => void }[] = [];
let servicesEnabled = true;
let permissionStatus = 'granted';
/** Lets a test suspend watchPositionAsync mid-call to exercise the window
 * between "permission granted" and "watcher installed". */
let watchGate: Promise<void> | null = null;

/** Lets a test simulate the side effects of the system permission dialog
 * (which takes focus and backgrounds the app) while the request is pending. */
let permissionRequestHook: (() => void) | null = null;

vi.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: async () => {
    permissionRequestHook?.();
    return { status: permissionStatus };
  },
  hasServicesEnabledAsync: async () => servicesEnabled,
  watchPositionAsync: async (
    _options: unknown,
    callback: (position: unknown) => void,
    errorHandler?: (reason: string) => void,
  ) => {
    if (watchGate) await watchGate;
    const watcher = {
      removed: false,
      fire: callback,
      fail: (reason: string) => errorHandler?.(reason),
      remove() {
        watcher.removed = true;
      },
    };
    watchers.push(watcher);
    return watcher;
  },
}));

type AppStateListener = (state: string) => void;
const appStateListeners = new Set<AppStateListener>();
const appState = {
  currentState: 'active' as string,
  addEventListener(_type: string, listener: AppStateListener) {
    appStateListeners.add(listener);
    return { remove: () => appStateListeners.delete(listener) };
  },
};

/** Drives AppState the way the OS does: set the value AND notify listeners. */
function setAppState(next: string) {
  appState.currentState = next;
  for (const listener of Array.from(appStateListeners)) listener(next);
}

vi.mock('react-native', () => ({
  get AppState() {
    return appState;
  },
}));

const { locationChannelManager } = await import('../locationChannel');

const USER_ID = 'self-user';
const FRIEND_ID = 'friend-user';

function ownChannel(): FakeChannel {
  return channels.find((c) => c.topic === `user-location:${USER_ID}`)!;
}

function position(lat: number, lon: number) {
  return { coords: { latitude: lat, longitude: lon, heading: null }, timestamp: 1_700_000_000_000 };
}

describe('locationChannelManager', () => {
  beforeEach(async () => {
    await locationChannelManager.teardown();
    channels.length = 0;
    watchers.length = 0;
    permissionStatus = 'granted';
    watchGate = null;
    permissionRequestHook = null;
    servicesEnabled = true;
    appStateListeners.clear();
    appState.currentState = 'active';
    locationChannelManager.setHandlers({
      onBroadcastingChange() {},
      onFriendLocation() {},
      onFriendPresence() {},
      onFriendRemoved() {},
      onConnectionChange() {},
      onBroadcastInterrupted() {},
    });
  });

  it('does not install a second watcher when broadcasting is enabled twice', async () => {
    await locationChannelManager.joinOwn(USER_ID);
    await ownChannel().emit('SUBSCRIBED');

    await locationChannelManager.setBroadcasting(true);
    await locationChannelManager.setBroadcasting(true);

    // A second watcher with no handle to stop it would broadcast forever.
    expect(watchers.filter((w) => !w.removed)).toHaveLength(1);
  });

  it('removes the watcher it created if backgrounding supersedes the enable', async () => {
    await locationChannelManager.joinOwn(USER_ID);
    await ownChannel().emit('SUBSCRIBED');

    // Suspend watchPositionAsync, then background the app before it resolves.
    let openGate: () => void = () => {};
    watchGate = new Promise<void>((resolve) => {
      openGate = resolve;
    });

    const enabling = locationChannelManager.setBroadcasting(true);
    await locationChannelManager.pauseForBackground();
    openGate();
    await enabling;

    // The watcher may have been created, but it must not have survived.
    expect(watchers.every((w) => w.removed)).toBe(true);
  });

  it('refuses to start broadcasting if the app never returns to the foreground', async () => {
    await locationChannelManager.joinOwn(USER_ID);
    await ownChannel().emit('SUBSCRIBED');

    setAppState('background');

    vi.useFakeTimers();
    const pending = locationChannelManager.setBroadcasting(true);
    await vi.advanceTimersByTimeAsync(95000);
    const result = await pending;
    vi.useRealTimers();

    expect(result.ok).toBe(false);
    expect(watchers.filter((w) => !w.removed)).toHaveLength(0);
  });

  it('still starts when the permission dialog backgrounds the app', async () => {
    await locationChannelManager.joinOwn(USER_ID);
    await ownChannel().emit('SUBSCRIBED');

    // Exactly what happens on a real device: asking for permission opens a
    // system dialog, which drives AppState to inactive and fires the
    // provider's pauseForBackground() -- while this very call is in flight.
    permissionRequestHook = () => {
      setAppState('inactive');
      void locationChannelManager.pauseForBackground();
    };

    const pending = locationChannelManager.setBroadcasting(true);

    // The dialog closes and focus comes back.
    await Promise.resolve();
    setAppState('active');
    await locationChannelManager.resumeForForeground(false);

    const result = await pending;

    // Cancelling here is what made the button spin and do nothing: the
    // operation was killed by the dialog it opened itself.
    expect(result.ok).toBe(true);
    expect(watchers.filter((w) => !w.removed)).toHaveLength(1);
  });

  it('does not broadcast when permission is refused', async () => {
    await locationChannelManager.joinOwn(USER_ID);
    await ownChannel().emit('SUBSCRIBED');

    permissionStatus = 'denied';
    await locationChannelManager.setBroadcasting(true);

    expect(watchers).toHaveLength(0);
  });

  it('re-advertises presence as broadcasting after a reconnect', async () => {
    await locationChannelManager.joinOwn(USER_ID);
    const channel = ownChannel();
    await channel.emit('SUBSCRIBED');
    await locationChannelManager.setBroadcasting(true);

    // A network blip: the socket drops and rejoins.
    await channel.emit('SUBSCRIBED');

    // Tracking 'online' here would drop an actively-broadcasting user to
    // Inactive on their friends' devices while their pings kept arriving.
    expect(channel.tracked.at(-1)).toEqual({ status: 'broadcasting' });
  });

  it('advertises presence as online when not broadcasting', async () => {
    await locationChannelManager.joinOwn(USER_ID);
    const channel = ownChannel();
    await channel.emit('SUBSCRIBED');

    expect(channel.tracked.at(-1)).toEqual({ status: 'online' });
  });

  it('drops fixes instead of sending while the channel is not joined', async () => {
    await locationChannelManager.joinOwn(USER_ID);
    const channel = ownChannel();
    await channel.emit('SUBSCRIBED');
    await locationChannelManager.setBroadcasting(true);

    const watcher = watchers.find((w) => !w.removed)!;

    watcher.fire(position(28.6, 77.2));
    expect(channel.sent).toHaveLength(1);

    // Mid-reconnect: realtime-js would silently fall back to one REST POST
    // per message here, so the fix must be dropped instead.
    channel.state = 'closed';
    watcher.fire(position(28.61, 77.21));
    expect(channel.sent).toHaveLength(1);
  });

  it('stops broadcasting when the channel reports an error', async () => {
    const broadcastingChanges: boolean[] = [];
    locationChannelManager.setHandlers({
      onBroadcastingChange: (enabled) => broadcastingChanges.push(enabled),
      onFriendLocation() {},
      onFriendPresence() {},
      onFriendRemoved() {},
      onConnectionChange() {},
      onBroadcastInterrupted() {},
    });

    await locationChannelManager.joinOwn(USER_ID);
    const channel = ownChannel();
    await channel.emit('SUBSCRIBED');
    await locationChannelManager.setBroadcasting(true);

    await channel.emit('CHANNEL_ERROR');

    // The button must not stay lit green while nothing is transmitting.
    expect(broadcastingChanges.at(-1)).toBe(false);
    expect(watchers.every((w) => w.removed)).toBe(true);
  });

  it('can still start broadcasting after a transient close', async () => {
    await locationChannelManager.joinOwn(USER_ID);
    const channel = ownChannel();

    // A close before the user ever taps -- socket blip on startup, say.
    await channel.emit('CLOSED');
    channel.state = 'closed';

    // Fake timers so the join-wait's poll doesn't burn real seconds.
    vi.useFakeTimers();
    const refusedPromise = locationChannelManager.setBroadcasting(true);
    await vi.advanceTimersByTimeAsync(7000);
    const refused = await refusedPromise;
    vi.useRealTimers();
    expect(refused.ok).toBe(false);

    // The channel recovers on its own, as realtime-js does.
    await channel.emit('SUBSCRIBED');

    // This must now succeed. Latching the first failure is what previously
    // left the button dead for the rest of the session.
    const accepted = await locationChannelManager.setBroadcasting(true);
    expect(accepted.ok).toBe(true);
    expect(watchers.filter((w) => !w.removed)).toHaveLength(1);
  });

  it('reports a reason when it cannot reach the channel', async () => {
    await locationChannelManager.joinOwn(USER_ID);
    const channel = ownChannel();
    await channel.emit('CHANNEL_ERROR');

    vi.useFakeTimers();
    const pending = locationChannelManager.setBroadcasting(true);
    await vi.advanceTimersByTimeAsync(7000);
    const result = await pending;
    vi.useRealTimers();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('CHANNEL_ERROR');
  });

  it('treats CLOSED as reconnecting rather than a hard error', async () => {
    const states: string[] = [];
    locationChannelManager.setHandlers({
      onBroadcastingChange() {},
      onFriendLocation() {},
      onFriendPresence() {},
      onFriendRemoved() {},
      onConnectionChange: (state) => states.push(state),
      onBroadcastInterrupted() {},
    });

    await locationChannelManager.joinOwn(USER_ID);
    await ownChannel().emit('CLOSED');

    // Showing "connection lost" for a routine socket cycle is what put the
    // banner on screen and left it there.
    expect(states.at(-1)).toBe('connecting');
  });

  it('stops and reports when the location provider errors mid-broadcast', async () => {
    const interruptions: string[] = [];
    const broadcastingChanges: boolean[] = [];
    locationChannelManager.setHandlers({
      onBroadcastingChange: (enabled) => broadcastingChanges.push(enabled),
      onFriendLocation() {},
      onFriendPresence() {},
      onFriendRemoved() {},
      onConnectionChange() {},
      onBroadcastInterrupted: (reason) => interruptions.push(reason),
    });

    await locationChannelManager.joinOwn(USER_ID);
    await ownChannel().emit('SUBSCRIBED');
    await locationChannelManager.setBroadcasting(true);

    // Switching GPS off while sharing: the provider reports it, and that
    // used to go nowhere -- leaving the button lit over a dead watcher.
    const watcher = watchers.find((w) => !w.removed)!;
    watcher.fail('Location services are disabled');

    expect(interruptions).toHaveLength(1);
    expect(broadcastingChanges.at(-1)).toBe(false);
    expect(watchers.every((w) => w.removed)).toBe(true);
  });

  it('refuses to start when location services are switched off', async () => {
    await locationChannelManager.joinOwn(USER_ID);
    await ownChannel().emit('SUBSCRIBED');

    servicesEnabled = false;
    const result = await locationChannelManager.setBroadcasting(true);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Location is turned off');
    expect(watchers).toHaveLength(0);
  });

  it('rejects malformed friend payloads before they reach the store', async () => {
    const received: unknown[] = [];
    locationChannelManager.setHandlers({
      onBroadcastingChange() {},
      onFriendLocation: (loc) => received.push(loc),
      onFriendPresence() {},
      onFriendRemoved() {},
      onConnectionChange() {},
      onBroadcastInterrupted() {},
    });

    await locationChannelManager.joinOwn(USER_ID);
    locationChannelManager.syncFriendSubscriptions([FRIEND_ID]);
    const friendChannel = channels.find((c) => c.topic === `user-location:${FRIEND_ID}`)!;
    const onBroadcast = friendChannel.handlers.broadcast;

    onBroadcast({ payload: { lat: 'nope', lon: 77.2, ts: 1 } });
    onBroadcast({ payload: { lat: 28.6, lon: 999, ts: 1 } });
    onBroadcast({ payload: { lat: Number.NaN, lon: 77.2, ts: 1 } });
    onBroadcast({ payload: null });
    expect(received).toHaveLength(0);

    onBroadcast({ payload: { lat: 28.6, lon: 77.2, heading: 90, ts: 1 } });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ userId: FRIEND_ID, lat: 28.6, lon: 77.2, heading: 90 });
  });
});
