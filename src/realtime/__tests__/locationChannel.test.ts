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
/** Makes presence untrack fail, so cleanup's error handling can be exercised. */
let untrackShouldThrow = false;
/** Channels handed to supabase.removeChannel -- cleanup must always get here,
 * however untrack went. */
const removedChannels: FakeChannel[] = [];

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
      if (untrackShouldThrow) throw new Error('untrack failed');
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
    removeChannel: async (channel: FakeChannel) => {
      removedChannels.push(channel);
      return 'ok';
    },
  },
}));

/** Watchers handed out by watchPositionAsync, so tests can assert none leak. */
const watchers: { removed: boolean; fire: (position: unknown) => void; fail: (reason: string) => void }[] = [];
let servicesEnabled = true;
let permissionStatus = 'granted';
/** Calls to the Android "turn location on?" resolution dialog. The hook lets
 * a test decide the outcome -- accepting it flips `servicesEnabled`. */
let enableProviderCalls = 0;
let enableProviderHook: (() => void) | null = null;
/** Lets a test suspend watchPositionAsync mid-call to exercise the window
 * between "permission granted" and "watcher installed". */
let watchGate: Promise<void> | null = null;

/** Lets a test simulate the side effects of the system permission dialog
 * (which takes focus and backgrounds the app) while the request is pending. */
let permissionRequestHook: (() => void) | null = null;
/** How many times the system permission dialog has been asked for -- i.e. how
 * many times the user was shown one. */
let permissionRequests = 0;

vi.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: async () => {
    permissionRequests += 1;
    permissionRequestHook?.();
    return { status: permissionStatus };
  },
  getForegroundPermissionsAsync: async () => ({ status: permissionStatus }),
  hasServicesEnabledAsync: async () => servicesEnabled,
  enableNetworkProviderAsync: async () => {
    enableProviderCalls += 1;
    if (!enableProviderHook) throw new Error('denied');
    enableProviderHook();
  },
  watchPositionAsync: async (
    _options: unknown,
    callback: (position: unknown) => void,
    errorHandler?: (reason: string) => void,
  ) => {
    // One-shot: only the first call parks, so a test can hold one attempt
    // here while a second one runs past it to completion.
    if (watchGate) {
      const gate = watchGate;
      watchGate = null;
      await gate;
    }
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

let platformOS = 'android';

vi.mock('react-native', () => ({
  get AppState() {
    return appState;
  },
  get Platform() {
    return { OS: platformOS };
  },
}));

const { locationChannelManager } = await import('../locationChannel');

const USER_ID = 'self-user';
const FRIEND_ID = 'friend-user';

/** The *current* own channel: a stuck join gets recreated, so an early
 * reference goes stale and only the newest one is the live one. */
function ownChannel(): FakeChannel {
  return channels.filter((c) => c.topic === `user-location:${USER_ID}`).at(-1)!;
}

/** Long enough for the join wait, the rejoin, and the second join wait. */
const JOIN_GIVE_UP_MS = 20_000;

function position(lat: number, lon: number) {
  return { coords: { latitude: lat, longitude: lon }, timestamp: 1_700_000_000_000 };
}

describe('locationChannelManager', () => {
  beforeEach(async () => {
    await locationChannelManager.teardown();
    channels.length = 0;
    watchers.length = 0;
    removedChannels.length = 0;
    untrackShouldThrow = false;
    permissionStatus = 'granted';
    watchGate = null;
    permissionRequestHook = null;
    permissionRequests = 0;
    servicesEnabled = true;
    enableProviderCalls = 0;
    enableProviderHook = null;
    platformOS = 'android';
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

  it('still removes the channel when presence untrack fails', async () => {
    await locationChannelManager.joinOwn(USER_ID);
    const channel = ownChannel();
    await channel.emit('SUBSCRIBED');

    untrackShouldThrow = true;
    // Must not reject: neither joinOwn nor teardown is awaited by the
    // provider, so a throw here surfaced as an unhandled rejection.
    await expect(locationChannelManager.leaveOwn()).resolves.toBeUndefined();

    // A channel left un-removed is referenced nowhere, still joined, still
    // receiving, with no handle left to close it.
    expect(removedChannels).toContain(channel);
  });

  it('resumes broadcasting after a background/foreground flip', async () => {
    await locationChannelManager.joinOwn(USER_ID);
    await ownChannel().emit('SUBSCRIBED');
    await locationChannelManager.setBroadcasting(true);

    // Deliberately NOT awaited: the OS can deliver 'active' before the pause
    // has finished, which is what left the caller resuming against a flag it
    // had not written yet -- and sharing simply never came back.
    const pausing = locationChannelManager.pauseForBackground();
    await locationChannelManager.resumeForForeground();
    await pausing;

    expect(watchers.filter((w) => !w.removed)).toHaveLength(1);
  });

  it('reports what the first pause captured when backgrounded twice', async () => {
    await locationChannelManager.joinOwn(USER_ID);
    await ownChannel().emit('SUBSCRIBED');
    await locationChannelManager.setBroadcasting(true);

    expect(await locationChannelManager.pauseForBackground()).toBe(true);
    // Re-reading isBroadcasting here would see the false the first pause just
    // set, and foregrounding would never resume a session that was live.
    expect(await locationChannelManager.pauseForBackground()).toBe(true);
  });

  it('says so when sharing cannot be resumed on returning to the app', async () => {
    const interruptions: string[] = [];
    locationChannelManager.setHandlers({
      onBroadcastingChange() {},
      onFriendLocation() {},
      onFriendPresence() {},
      onFriendRemoved() {},
      onConnectionChange() {},
      onBroadcastInterrupted: (reason) => interruptions.push(reason),
    });

    await locationChannelManager.joinOwn(USER_ID);
    await ownChannel().emit('SUBSCRIBED');
    await locationChannelManager.setBroadcasting(true);

    await locationChannelManager.pauseForBackground();
    // Location switched off in Settings while the app was away, and declined
    // when offered the chance to switch it back on.
    servicesEnabled = false;
    await locationChannelManager.resumeForForeground();

    // The button goes dark either way; without this the user has no idea why,
    // and every reason to assume they are still sharing.
    expect(interruptions).toHaveLength(1);
    expect(interruptions[0]).toContain('Location is turned off');
    // Told, not asked. Offering Play's "turn on location?" dialog here put a
    // system prompt in front of the user on a return to the app they made for
    // some entirely unrelated reason.
    expect(enableProviderCalls).toBe(0);
  });

  it('never opens the permission dialog when resuming on foreground', async () => {
    const interruptions: string[] = [];
    locationChannelManager.setHandlers({
      onBroadcastingChange() {},
      onFriendLocation() {},
      onFriendPresence() {},
      onFriendRemoved() {},
      onConnectionChange() {},
      onBroadcastInterrupted: (reason) => interruptions.push(reason),
    });

    await locationChannelManager.joinOwn(USER_ID);
    await ownChannel().emit('SUBSCRIBED');
    await locationChannelManager.setBroadcasting(true);
    expect(permissionRequests).toBe(1);

    await locationChannelManager.pauseForBackground();
    // Exactly what Android does to a one-time ("Only this time") grant the
    // moment the app leaves the foreground.
    permissionStatus = 'denied';
    await locationChannelManager.resumeForForeground();

    // Asking here put a dialog the user never tapped for in front of them on
    // every return to the app -- and dismissing it is itself a foreground
    // event, so it came straight back.
    expect(permissionRequests).toBe(1);
    expect(watchers.filter((w) => !w.removed)).toHaveLength(0);
    expect(interruptions).toHaveLength(1);
    expect(interruptions[0]).toContain('Location access was withdrawn');
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
    await locationChannelManager.resumeForForeground();

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

  it('keeps sending while stationary, so a still friend is not dropped', async () => {
    // Fake timers go up FIRST: the heartbeat's interval has to be created
    // under them, or advancing the clock never fires it.
    vi.useFakeTimers();
    try {
      await locationChannelManager.joinOwn(USER_ID);
      const channel = ownChannel();
      await channel.emit('SUBSCRIBED');
      await locationChannelManager.setBroadcasting(true);

      watchers.find((w) => !w.removed)!.fire(position(28.6, 77.2));
      expect(channel.sent).toHaveLength(1);

      // Standing on a platform: distanceInterval is a hard OS-level filter,
      // so the watcher legitimately delivers nothing more. Without a
      // heartbeat the receiver sees silence, fades the pin at 30s and drops
      // it at 90s while the user believes they are still sharing.
      await vi.advanceTimersByTimeAsync(50_000);

      expect(channel.sent.length).toBeGreaterThan(1);
      // Repeats carry the ORIGINAL reading, unrestamped -- that identity is
      // how the receiver tells a repeat from real movement.
      expect(channel.sent.at(-1)).toEqual(channel.sent[0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops repeating the last fix once broadcasting is turned off', async () => {
    vi.useFakeTimers();
    try {
      await locationChannelManager.joinOwn(USER_ID);
      const channel = ownChannel();
      await channel.emit('SUBSCRIBED');
      await locationChannelManager.setBroadcasting(true);

      watchers.find((w) => !w.removed)!.fire(position(28.6, 77.2));
      await locationChannelManager.setBroadcasting(false);
      const sentWhenStopped = channel.sent.length;

      await vi.advanceTimersByTimeAsync(60_000);

      // A heartbeat surviving the stop would keep transmitting a position
      // after the user explicitly stopped sharing it.
      expect(channel.sent).toHaveLength(sentWhenStopped);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let a superseded attempt switch off the newer live one', async () => {
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

    // Park the first attempt inside watchPositionAsync...
    let openGate: () => void = () => {};
    watchGate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const first = locationChannelManager.setBroadcasting(true);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // ...and let a second one overtake it and genuinely start broadcasting.
    const second = await locationChannelManager.setBroadcasting(true);
    expect(second.ok).toBe(true);

    openGate();
    await first;

    // The loser reporting itself through refuse() flipped the flag off after
    // the winner had started: a dark button over a live watcher, presence
    // re-tracked as 'online' by a device still transmitting, and a services
    // watchdog that short-circuits on the same flag.
    expect(broadcastingChanges.at(-1)).toBe(true);
    expect(watchers.filter((w) => !w.removed)).toHaveLength(1);
  });

  it('always succeeds at stopping, even with no channel at all', async () => {
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
    await ownChannel().emit('SUBSCRIBED');
    await locationChannelManager.setBroadcasting(true);

    // The connection is gone by the time the user reaches for the toggle.
    await locationChannelManager.leaveOwn();

    const result = await locationChannelManager.setBroadcasting(false);

    // Refusing here answered "stop sharing" with "Couldn't start sharing",
    // leaving the user unable to tell whether they were still transmitting.
    expect(result.ok).toBe(true);
    expect(broadcastingChanges.at(-1)).toBe(false);
    expect(watchers.every((w) => w.removed)).toBe(true);
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
    await vi.advanceTimersByTimeAsync(JOIN_GIVE_UP_MS);
    const refused = await refusedPromise;
    vi.useRealTimers();
    expect(refused.ok).toBe(false);

    // The channel recovers on its own, as realtime-js does. That attempt
    // recreated the channel, so it's the newest one that comes back.
    await ownChannel().emit('SUBSCRIBED');

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
    await vi.advanceTimersByTimeAsync(JOIN_GIVE_UP_MS);
    const result = await pending;
    vi.useRealTimers();

    expect(result.ok).toBe(false);
    // Survives the rejoin attempt in between, which clears the error the
    // channel reported and is the only thing that explains the failure.
    if (!result.ok) expect(result.reason).toContain('CHANNEL_ERROR');
  });

  it('recreates a stuck channel instead of refusing on it', async () => {
    await locationChannelManager.joinOwn(USER_ID);
    const stuck = ownChannel();
    // Socket dropped -- realtime-js left this one closed and is not bringing
    // it back. Backgrounding for a system dialog is the common way in, so it
    // lands exactly when the user returns and taps share.
    await stuck.emit('CLOSED');
    stuck.state = 'closed';

    vi.useFakeTimers();
    const pending = locationChannelManager.setBroadcasting(true);
    // Let the first wait time out and the replacement channel be created...
    await vi.advanceTimersByTimeAsync(7000);
    const replacement = ownChannel();
    expect(replacement).not.toBe(stuck);
    // ...then have it join, as a healthy connection does.
    await replacement.emit('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(500);
    const result = await pending;
    vi.useRealTimers();

    expect(result.ok).toBe(true);
    expect(watchers.filter((w) => !w.removed)).toHaveLength(1);
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

  it('refuses to start when the user declines the turn-location-on dialog', async () => {
    await locationChannelManager.joinOwn(USER_ID);
    await ownChannel().emit('SUBSCRIBED');

    servicesEnabled = false;
    const result = await locationChannelManager.setBroadcasting(true);

    expect(enableProviderCalls).toBe(1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Location is turned off');
    expect(watchers).toHaveLength(0);
  });

  it('offers the system dialog instead of a message when location is off', async () => {
    await locationChannelManager.joinOwn(USER_ID);
    await ownChannel().emit('SUBSCRIBED');

    servicesEnabled = false;
    // Accepting the dialog is what actually switches location on.
    enableProviderHook = () => {
      servicesEnabled = true;
    };
    const result = await locationChannelManager.setBroadcasting(true);

    expect(enableProviderCalls).toBe(1);
    expect(result.ok).toBe(true);
    expect(watchers).toHaveLength(1);
  });

  it('waits out the lag between accepting the dialog and location coming up', async () => {
    await locationChannelManager.joinOwn(USER_ID);
    await ownChannel().emit('SUBSCRIBED');

    servicesEnabled = false;
    // Play services resolves the dialog as soon as the setting flips, but the
    // providers report themselves as off for a beat afterwards -- checking
    // once used to refuse the attempt the user had just approved.
    enableProviderHook = () => {
      setTimeout(() => {
        servicesEnabled = true;
      }, 400);
    };
    const result = await locationChannelManager.setBroadcasting(true);

    expect(result.ok).toBe(true);
    expect(watchers).toHaveLength(1);
  });

  it('does not attempt the dialog on iOS, where there is no such API', async () => {
    platformOS = 'ios';
    await locationChannelManager.joinOwn(USER_ID);
    await ownChannel().emit('SUBSCRIBED');

    servicesEnabled = false;
    const result = await locationChannelManager.setBroadcasting(true);

    expect(enableProviderCalls).toBe(0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Location is turned off');
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
    onBroadcast({ payload: { lat: 28.6, lon: 77.2, ts: 0 } });
    expect(received).toHaveLength(0);

    onBroadcast({ payload: { lat: 28.6, lon: 77.2, ts: 1 } });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ userId: FRIEND_ID, lat: 28.6, lon: 77.2 });
  });
});
