import { describe, expect, it } from 'vitest';
import { parseSharedJourney } from '../sharedJourney';

const VALID = {
  originId: 'ramesh-nagar',
  destinationId: 'patel-nagar',
  mode: 'fastest',
  startedAt: 1_700_000_000_000,
};

describe('parseSharedJourney', () => {
  it('accepts a well-formed journey', () => {
    expect(parseSharedJourney(VALID)).toEqual({
      originId: 'ramesh-nagar',
      destinationId: 'patel-nagar',
      mode: 'fastest',
      startedAt: 1_700_000_000_000,
    });
  });

  it('accepts min-interchange as a mode', () => {
    expect(parseSharedJourney({ ...VALID, mode: 'min-interchange' })?.mode).toBe('min-interchange');
  });

  it('treats an absent journey as nothing to show rather than an error', () => {
    // The ordinary case: a friend who is not on a journey, and a friend on a
    // build that predates journey sharing, are indistinguishable here and both
    // fine.
    expect(parseSharedJourney(undefined)).toBeNull();
    expect(parseSharedJourney(null)).toBeNull();
  });

  it('rejects non-objects', () => {
    expect(parseSharedJourney('ramesh-nagar')).toBeNull();
    expect(parseSharedJourney(42)).toBeNull();
    expect(parseSharedJourney([])).toBeNull();
  });

  it('rejects missing or non-string station ids', () => {
    expect(parseSharedJourney({ ...VALID, originId: undefined })).toBeNull();
    expect(parseSharedJourney({ ...VALID, destinationId: 12 })).toBeNull();
  });

  it('rejects station ids this build does not know', () => {
    // The reason existence is checked at the boundary rather than left to
    // findRoute: a sender on a newer graph can name stations we cannot draw,
    // and that should be dropped once here rather than rediscovered as an
    // empty route by each of the surfaces that read it.
    expect(parseSharedJourney({ ...VALID, destinationId: 'not-a-real-station' })).toBeNull();
    expect(parseSharedJourney({ ...VALID, originId: 'not-a-real-station' })).toBeNull();
  });

  it('rejects an unknown mode', () => {
    expect(parseSharedJourney({ ...VALID, mode: 'cheapest' })).toBeNull();
    expect(parseSharedJourney({ ...VALID, mode: undefined })).toBeNull();
  });

  it('rejects a journey that goes nowhere', () => {
    expect(parseSharedJourney({ ...VALID, destinationId: VALID.originId })).toBeNull();
  });

  it('rejects a non-finite or non-positive startedAt', () => {
    expect(parseSharedJourney({ ...VALID, startedAt: Number.NaN })).toBeNull();
    expect(parseSharedJourney({ ...VALID, startedAt: Number.POSITIVE_INFINITY })).toBeNull();
    expect(parseSharedJourney({ ...VALID, startedAt: 0 })).toBeNull();
    expect(parseSharedJourney({ ...VALID, startedAt: '1700000000000' })).toBeNull();
  });
});
