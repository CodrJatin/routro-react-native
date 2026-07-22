import { describe, expect, it } from 'vitest';
import { estimateFareRupees } from '../fare';
import { searchStations } from '../graph';

describe('searchStations', () => {
  it('ranks exact prefix matches first', () => {
    const results = searchStations('rajouri');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe('Rajouri Garden');
  });

  it('matches a merged interchange station by name', () => {
    const results = searchStations('hauz khas');
    expect(results.some((s) => s.id === 'hauz-khas')).toBe(true);
  });

  it('returns nothing for an empty query', () => {
    expect(searchStations('')).toEqual([]);
  });

  it('is case-insensitive and punctuation-insensitive', () => {
    const results = searchStations('KASHMERE-GATE');
    expect(results.some((s) => s.id === 'kashmere-gate')).toBe(true);
  });
});

describe('estimateFareRupees', () => {
  it('applies the lowest slab for short distances', () => {
    expect(estimateFareRupees(500)).toBe(10);
  });

  it('is monotonically non-decreasing with distance', () => {
    const distances = [0, 1000, 3000, 8000, 15000, 25000, 40000, 100000];
    const fares = distances.map(estimateFareRupees);
    for (let i = 1; i < fares.length; i++) {
      expect(fares[i]).toBeGreaterThanOrEqual(fares[i - 1]);
    }
  });

  it('caps at the beyond-max-slab fare for very long distances', () => {
    expect(estimateFareRupees(100000)).toBe(60);
  });
});
