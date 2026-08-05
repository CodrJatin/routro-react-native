import { describe, expect, it } from 'vitest';
import { AUTOFILL_RADIUS_METERS, shouldAutofillOrigin } from '../originAutofill';

const base = {
  hasOrigin: false,
  hasFilledThisVisit: false,
  userClearedThisVisit: false,
  nearestDistanceMeters: 200,
};

describe('shouldAutofillOrigin', () => {
  it('fills an empty field from a nearby station', () => {
    expect(shouldAutofillOrigin(base)).toBe(true);
  });

  it('never overwrites a station already in the field', () => {
    expect(shouldAutofillOrigin({ ...base, hasOrigin: true })).toBe(false);
  });

  it('fills at most once per visit, so a drifting fix cannot rewrite the field', () => {
    expect(shouldAutofillOrigin({ ...base, hasFilledThisVisit: true })).toBe(false);
  });

  it('stays out of the way once the user has cleared it', () => {
    expect(shouldAutofillOrigin({ ...base, userClearedThisVisit: true })).toBe(false);
  });

  it('waits for a position fix', () => {
    expect(shouldAutofillOrigin({ ...base, nearestDistanceMeters: null })).toBe(false);
  });

  it('declines a station too far away to be the one the user is standing at', () => {
    expect(
      shouldAutofillOrigin({ ...base, nearestDistanceMeters: AUTOFILL_RADIUS_METERS + 1 }),
    ).toBe(false);
  });

  it('accepts one exactly at the limit', () => {
    expect(shouldAutofillOrigin({ ...base, nearestDistanceMeters: AUTOFILL_RADIUS_METERS })).toBe(
      true,
    );
  });
});
