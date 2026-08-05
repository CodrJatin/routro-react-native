import { describe, expect, it } from 'vitest';
import { flipped, shouldFlipAfterArrival } from '../savedJourneyDirection';

const outbound = {
  id: 'A B',
  originId: 'A',
  originName: 'Alpha',
  destinationId: 'B',
  destinationName: 'Bravo',
  savedAt: 1000,
};

describe('flipped', () => {
  it('swaps both ends', () => {
    const result = flipped(outbound);
    expect(result.originId).toBe('B');
    expect(result.originName).toBe('Bravo');
    expect(result.destinationId).toBe('A');
    expect(result.destinationName).toBe('Alpha');
  });

  it('leaves everything else alone -- the list is ordered by savedAt, and a card that jumped to the top would move under the thumb about to tap it', () => {
    const result = flipped(outbound);
    expect(result.id).toBe(outbound.id);
    expect(result.savedAt).toBe(outbound.savedAt);
  });

  it('is its own inverse', () => {
    expect(flipped(flipped(outbound))).toEqual(outbound);
  });
});

describe('shouldFlipAfterArrival', () => {
  it('turns a card around once its trip has been travelled', () => {
    expect(shouldFlipAfterArrival(outbound, 'A', 'B')).toBe(true);
  });

  it('leaves a card that already points home alone, so repeating the trip cannot flip it back', () => {
    expect(shouldFlipAfterArrival(flipped(outbound), 'A', 'B')).toBe(false);
  });

  it('ignores an unrelated journey', () => {
    expect(shouldFlipAfterArrival(outbound, 'C', 'D')).toBe(false);
  });

  it('ignores a trip that shares only one end', () => {
    expect(shouldFlipAfterArrival(outbound, 'A', 'C')).toBe(false);
  });
});
