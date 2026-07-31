import { describe, expect, it } from 'vitest';
import {
  MAX_GLIDE_MS,
  MIN_GLIDE_MS,
  glideAt,
  glideDurationMs,
  isGliding,
  type Glide,
} from '../glide';

/**
 * The interpolation both map pins are drawn through. These cover the cases
 * that decide whether a pin glides or teleports -- which is the whole point of
 * the module -- plus the degenerate inputs a real fix stream produces (a first
 * fix, a repeat, two fixes that arrive out of order).
 */

function glide(overrides: Partial<Glide> = {}): Glide {
  return {
    from: { lat: 28.6, lon: 77.2 },
    to: { lat: 28.7, lon: 77.3 },
    fromAt: 10_000,
    toAt: 14_000,
    ...overrides,
  };
}

describe('glideDurationMs', () => {
  it('glides over the gap between the two fixes', () => {
    expect(glideDurationMs(glide())).toBe(4000);
  });

  it('has nothing to animate for a first fix', () => {
    expect(glideDurationMs(glide({ from: null }))).toBeNull();
  });

  it('has nothing to animate when the two fixes share a timestamp', () => {
    expect(glideDurationMs(glide({ fromAt: 14_000 }))).toBeNull();
  });

  it('has nothing to animate when the fixes arrived out of order', () => {
    expect(glideDurationMs(glide({ fromAt: 20_000 }))).toBeNull();
  });

  it('floors a burst of fixes so pins do not flicker', () => {
    expect(glideDurationMs(glide({ fromAt: 13_900 }))).toBe(MIN_GLIDE_MS);
  });

  it('caps a fix after a long silence so the pin does not crawl', () => {
    expect(glideDurationMs(glide({ fromAt: 0, toAt: 120_000 }))).toBe(MAX_GLIDE_MS);
  });
});

describe('glideAt', () => {
  it('sits on the previous fix at the start of the window', () => {
    expect(glideAt(glide(), 14_000)).toEqual([77.2, 28.6]);
  });

  it('has arrived at the latest fix once the window closes', () => {
    expect(glideAt(glide(), 18_000)).toEqual([77.3, 28.7]);
  });

  it('stays on the latest fix long after the window closes', () => {
    expect(glideAt(glide(), 999_000)).toEqual([77.3, 28.7]);
  });

  it('is somewhere between the two mid-window', () => {
    const [lon, lat] = glideAt(glide(), 16_000);

    expect(lon).toBeGreaterThan(77.2);
    expect(lon).toBeLessThan(77.3);
    expect(lat).toBeGreaterThan(28.6);
    expect(lat).toBeLessThan(28.7);
  });

  it('eases out, so it covers more than half the distance by half the window', () => {
    const [, lat] = glideAt(glide(), 16_000);

    expect(lat).toBeGreaterThan(28.65);
  });

  it('moves monotonically towards the latest fix', () => {
    const g = glide();
    const samples = [14_500, 15_000, 15_500, 16_000, 17_000].map((now) => glideAt(g, now)[1]);

    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
  });

  it('places a first fix directly, with nothing to animate from', () => {
    expect(glideAt(glide({ from: null }), 14_000)).toEqual([77.3, 28.7]);
  });

  it('never rewinds when the clock reads before the fix landed', () => {
    expect(glideAt(glide(), 12_000)).toEqual([77.2, 28.6]);
  });
});

describe('isGliding', () => {
  it('is animating inside the window', () => {
    expect(isGliding(glide(), 16_000)).toBe(true);
  });

  it('has stopped once the window closes', () => {
    expect(isGliding(glide(), 18_000)).toBe(false);
  });

  it('never starts for a first fix', () => {
    expect(isGliding(glide({ from: null }), 14_000)).toBe(false);
  });

  it('never starts for a repeat of the same instant', () => {
    expect(isGliding(glide({ fromAt: 14_000 }), 14_000)).toBe(false);
  });
});
