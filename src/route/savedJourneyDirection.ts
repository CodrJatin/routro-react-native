import type { StationId } from '../engine/types';

/**
 * The direction half of a saved journey -- the four fields that turn around
 * when a card flips.
 *
 * Structural rather than `SavedJourney` itself so this module imports nothing
 * from the store, which reaches AsyncStorage the moment it is loaded. These
 * two rules are the part worth testing on their own.
 */
export interface DirectedJourney {
  originId: StationId;
  originName: string;
  destinationId: StationId;
  destinationName: string;
}

/** The same journey, travelled the other way. Generic so callers keep whatever
 * else they carry (id, savedAt) rather than getting a narrowed copy back. */
export function flipped<T extends DirectedJourney>(journey: T): T {
  return {
    ...journey,
    originId: journey.destinationId,
    originName: journey.destinationName,
    destinationId: journey.originId,
    destinationName: journey.originName,
  };
}

/**
 * Whether finishing `originId -> destinationId` should turn this card around.
 *
 * True only while the card still points the way the user has just travelled.
 * One already pointing back is offering the return trip, which is the whole
 * purpose of the flip -- turning it again would undo it, and doing that on
 * every arrival would leave a card's direction depending on how many times the
 * trip had been made rather than on which way it was made last.
 */
export function shouldFlipAfterArrival(
  journey: DirectedJourney,
  originId: StationId,
  destinationId: StationId,
): boolean {
  return journey.originId === originId && journey.destinationId === destinationId;
}
