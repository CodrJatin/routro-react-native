import { beforeEach, describe, expect, it } from 'vitest';
import { useLocationStore } from '../locationStore';

/**
 * The receiving half of the broadcast heartbeat. The sender repeats its last
 * fix verbatim so a stationary friend doesn't go silent (see
 * HEARTBEAT_RESEND_AFTER_MS in locationChannel.ts); these cover the
 * distinction the store has to draw between "still here" and "moved", which
 * the map pin and the line badge both depend on.
 */

const FRIEND = 'friend-user';

function fix(lat: number, lon: number, ts: number) {
  return { userId: FRIEND, lat, lon, ts };
}

function stored() {
  return useLocationStore.getState().friendLocations[FRIEND];
}

describe('upsertFriendLocation', () => {
  beforeEach(() => {
    useLocationStore.setState({ friendLocations: {}, friendPresence: {} });
  });

  it('records the first fix with no previous point', () => {
    useLocationStore.getState().upsertFriendLocation(fix(28.6, 77.2, 1000));

    expect(stored().previous).toBeNull();
    expect(stored().movedAt).toBe(stored().receivedAt);
  });

  it('keeps the last distinct point as previous when the friend moves', () => {
    const store = useLocationStore.getState();
    store.upsertFriendLocation(fix(28.6, 77.2, 1000));
    const first = stored();
    store.upsertFriendLocation(fix(28.61, 77.21, 2000));

    expect(stored().previous).toEqual({ lat: 28.6, lon: 77.2, movedAt: first.movedAt });
  });

  it('treats an identical repeat as liveness, not movement', async () => {
    const store = useLocationStore.getState();
    store.upsertFriendLocation(fix(28.6, 77.2, 1000));
    store.upsertFriendLocation(fix(28.61, 77.21, 2000));
    const moved = stored();

    await new Promise((resolve) => setTimeout(resolve, 5));
    // Byte-for-byte what the heartbeat re-sends, original `ts` and all.
    store.upsertFriendLocation(fix(28.61, 77.21, 2000));

    // Fresh enough to stay live...
    expect(stored().receivedAt).toBeGreaterThan(moved.receivedAt);
    // ...but the pin must not replay its glide, and the direction of travel
    // the line badge is derived from must survive.
    expect(stored().movedAt).toBe(moved.movedAt);
    expect(stored().previous).toEqual(moved.previous);
  });

  it('treats a re-reading of the same spot as movement when the sender says so', () => {
    const store = useLocationStore.getState();
    store.upsertFriendLocation(fix(28.6, 77.2, 1000));
    const first = stored();
    // Same coordinates, but a genuinely new reading -- a stationary GPS
    // returning the identical point is not the same thing as a repeat, and
    // only `ts` can tell them apart.
    store.upsertFriendLocation(fix(28.6, 77.2, 2000));

    expect(stored().previous).toEqual({ lat: 28.6, lon: 77.2, movedAt: first.movedAt });
  });
});

describe('setFriendPresence', () => {
  beforeEach(() => {
    useLocationStore.setState({ friendLocations: {}, friendPresence: {} });
  });

  it('keeps a friend location when they stop broadcasting', () => {
    const store = useLocationStore.getState();
    store.upsertFriendLocation(fix(28.6, 77.2, 1000));
    store.setFriendPresence(FRIEND, 'online');

    // Deleting it here is what let one dropped presence sync erase a friend
    // who was still transmitting -- unrecoverably, since the next fix would
    // arrive with no `previous` to derive their line or glide from. Removal is
    // `computeFriendStatus`'s job now, on the receiver's own clock. The
    // retained position is also what "last active" is read from.
    expect(stored()).toBeDefined();
    expect(useLocationStore.getState().friendPresence[FRIEND]).toBe('online');
  });

  it('keeps the location while they are still broadcasting', () => {
    const store = useLocationStore.getState();
    store.upsertFriendLocation(fix(28.6, 77.2, 1000));
    store.setFriendPresence(FRIEND, 'broadcasting');

    expect(stored()).toBeDefined();
  });
});
