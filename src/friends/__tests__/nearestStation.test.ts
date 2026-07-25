import { describe, expect, it } from 'vitest';
import { haversineMeters } from '../../engine/geo';
import { listStations } from '../../engine/graph';
import { findNearestStation } from '../nearestStation';

/** The exhaustive version the grid replaced. The grid is only worth having
 * if it agrees with this on every input, so that is what these assert. */
function bruteForceNearest(lat: number, lon: number) {
  let best: { name: string; distanceMeters: number } | null = null;
  for (const station of listStations()) {
    const distanceMeters = haversineMeters(lat, lon, station.lat, station.lon);
    if (!best || distanceMeters < best.distanceMeters) {
      best = { name: station.name, distanceMeters };
    }
  }
  return best;
}

/** Deterministic PRNG so a failure is reproducible rather than flaky. */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('findNearestStation', () => {
  it('returns the same station as an exhaustive scan across the network area', () => {
    const random = makeRandom(20260725);

    for (let i = 0; i < 500; i++) {
      // Roughly the Delhi NCR bounding box the network sits in.
      const lat = 28.3 + random() * 0.7;
      const lon = 76.8 + random() * 0.9;

      const actual = findNearestStation(lat, lon);
      const expected = bruteForceNearest(lat, lon);

      expect(actual).not.toBeNull();
      expect(actual!.distanceMeters).toBeCloseTo(expected!.distanceMeters, 6);
    }
  });

  it('agrees with an exhaustive scan when the point is far outside the network', () => {
    // Mumbai, ~1150 km away -- past the ring cap, so this exercises the
    // full-scan fallback rather than the grid walk.
    const actual = findNearestStation(19.076, 72.8777);
    const expected = bruteForceNearest(19.076, 72.8777);

    expect(actual).not.toBeNull();
    expect(actual!.distanceMeters).toBeCloseTo(expected!.distanceMeters, 6);
  });

  it('finds the exact station when queried at its own coordinates', () => {
    const station = listStations()[0];
    const nearest = findNearestStation(station.lat, station.lon);

    expect(nearest?.stationId).toBe(station.id);
    expect(nearest?.distanceMeters).toBeCloseTo(0, 6);
  });

  it('returns null for non-finite input rather than a bogus match', () => {
    expect(findNearestStation(Number.NaN, 77.2)).toBeNull();
    expect(findNearestStation(28.6, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
