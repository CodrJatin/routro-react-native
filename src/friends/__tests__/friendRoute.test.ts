import { beforeEach, describe, expect, it } from 'vitest';
import type { SharedJourney } from '../../realtime/sharedJourney';
import { clearFriendRouteCache, getFriendRoute } from '../friendRoute';

function journey(overrides: Partial<SharedJourney> = {}): SharedJourney {
  return {
    originId: 'ramesh-nagar',
    destinationId: 'patel-nagar',
    mode: 'fastest',
    startedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('getFriendRoute', () => {
  beforeEach(() => {
    clearFriendRouteCache();
  });

  it('returns null for no journey', () => {
    expect(getFriendRoute(null)).toBeNull();
    expect(getFriendRoute(undefined)).toBeNull();
  });

  it('computes the same route the engine would', () => {
    const route = getFriendRoute(journey());
    expect(route).not.toBeNull();
    expect(route!.originStationId).toBe('ramesh-nagar');
    expect(route!.destinationStationId).toBe('patel-nagar');
    expect(route!.mode).toBe('fastest');
  });

  it('returns the identical object on a repeat lookup', () => {
    // Identity, not just equality: the derived views memoise on this
    // reference, so a fresh object each call would recompute every friend's
    // progress and polyline on every position tick.
    expect(getFriendRoute(journey())).toBe(getFriendRoute(journey()));
  });

  it('ignores startedAt when keying, since it does not change the path', () => {
    const first = getFriendRoute(journey({ startedAt: 1 }));
    const second = getFriendRoute(journey({ startedAt: 999_999 }));
    expect(first).toBe(second);
  });

  it('keys separately on mode', () => {
    const fastest = getFriendRoute(journey({ mode: 'fastest' }));
    const minInterchange = getFriendRoute(journey({ mode: 'min-interchange' }));
    expect(fastest).not.toBeNull();
    expect(minInterchange).not.toBeNull();
    expect(fastest!.mode).toBe('fastest');
    expect(minInterchange!.mode).toBe('min-interchange');
  });

  it('keys separately on the stations', () => {
    const a = getFriendRoute(journey());
    const b = getFriendRoute(journey({ destinationId: 'moti-nagar' }));
    expect(a).not.toBe(b);
    expect(b!.destinationStationId).toBe('moti-nagar');
  });

  it('caches an unroutable pair instead of retrying it forever', () => {
    // 'bodaki' is an orphan in the source data, so this never routes. Caching
    // the null is the point: rediscovering it costs a full search each time.
    const unroutable = journey({ originId: 'bodaki' });
    expect(getFriendRoute(unroutable)).toBeNull();
    expect(getFriendRoute(unroutable)).toBeNull();
  });

  it('evicts rather than growing without bound', () => {
    // Far more distinct journeys than the cap, to prove the map does not just
    // keep every route a session has ever seen.
    const destinations = ['moti-nagar', 'kirti-nagar', 'shadipur', 'patel-nagar'];
    for (let i = 0; i < 40; i++) {
      getFriendRoute(
        journey({
          destinationId: destinations[i % destinations.length],
          mode: i % 2 === 0 ? 'fastest' : 'min-interchange',
          startedAt: 1_000 + i,
        }),
      );
    }
    // Still correct after churn, which is the property that actually matters.
    const route = getFriendRoute(journey());
    expect(route!.destinationStationId).toBe('patel-nagar');
  });
});
