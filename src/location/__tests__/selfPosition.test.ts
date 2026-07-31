import { beforeEach, describe, expect, it } from 'vitest';
import { useSelfPositionStore } from '../selfPosition';

/**
 * The store the user's own pin is drawn from. What matters here is the pair of
 * distinctions the pin depends on: a fix that moved versus one that only
 * confirmed the user is still where they were, and a live fix versus a cached
 * last-known one. Getting either wrong is what makes the pin jump, replay a
 * move it already made, or claim a stale position is current.
 */

function position() {
  return useSelfPositionStore.getState().position!;
}

describe('setLive', () => {
  beforeEach(() => {
    useSelfPositionStore.setState({ position: null });
  });

  it('records the first fix with nothing to glide from', () => {
    useSelfPositionStore.getState().setLive(28.6, 77.2);

    expect(position().previous).toBeNull();
  });

  it('carries the old position over as the point to glide from', () => {
    useSelfPositionStore.getState().setLive(28.6, 77.2);
    useSelfPositionStore.getState().setLive(28.7, 77.3);

    expect(position()).toMatchObject({ lat: 28.7, lon: 77.3 });
    expect(position().previous).toMatchObject({ lat: 28.6, lon: 77.2 });
  });

  it('keeps the last DISTINCT position when the user has not moved', () => {
    useSelfPositionStore.getState().setLive(28.6, 77.2);
    useSelfPositionStore.getState().setLive(28.7, 77.3);
    const movedAt = position().movedAt;

    useSelfPositionStore.getState().setLive(28.7, 77.3);

    // A repeat is the watcher saying "still here". Treating it as movement
    // would erase the real previous point and replay the last glide.
    expect(position().previous).toMatchObject({ lat: 28.6, lon: 77.2 });
    expect(position().movedAt).toBe(movedAt);
  });

  it('still refreshes freshness on a repeat, so a stationary user is not stale', () => {
    useSelfPositionStore.getState().setLive(28.6, 77.2);
    useSelfPositionStore.setState({ position: { ...position(), at: 0 } });

    useSelfPositionStore.getState().setLive(28.6, 77.2);

    expect(position().at).toBeGreaterThan(0);
  });
});

describe('seed', () => {
  beforeEach(() => {
    useSelfPositionStore.setState({ position: null });
  });

  it('fills a gap when nothing is known', () => {
    useSelfPositionStore.getState().seed(28.6, 77.2, 1000);

    expect(position()).toMatchObject({ lat: 28.6, lon: 77.2, at: 1000 });
  });

  it('never overwrites something taken more recently', () => {
    useSelfPositionStore.getState().setLive(28.7, 77.3);

    useSelfPositionStore.getState().seed(28.6, 77.2, 1000);

    expect(position()).toMatchObject({ lat: 28.7, lon: 77.3 });
  });

  it('starts gliding from when the cached fix landed, not when it was taken', () => {
    const before = Date.now();

    useSelfPositionStore.getState().seed(28.6, 77.2, 1000);

    // `at` is an hour-old OS timestamp; `movedAt` is now. The pin animates
    // against the latter, so a seeded fix appears rather than crawling in.
    expect(position().at).toBe(1000);
    expect(position().movedAt).toBeGreaterThanOrEqual(before);
  });
});
