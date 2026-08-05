/**
 * How near the nearest station has to be before filling it in is a help rather
 * than a guess.
 *
 * A metro rider planning a trip is usually at, or walking to, a station. Past
 * roughly this far the app is no longer answering "which station am I at" but
 * "which station is least far away", and those are different questions with
 * very different odds of being right.
 */
export const AUTOFILL_RADIUS_METERS = 1500;

export interface OriginAutofillInputs {
  /** The origin field already holds a station -- chosen by the user, restored
   * with a saved journey, or filled earlier. */
  hasOrigin: boolean;
  /** Already filled once since the screen was focused. */
  hasFilledThisVisit: boolean;
  /** The user emptied the field since the screen was focused. */
  userClearedThisVisit: boolean;
  /** Metres to the nearest station, or null with no position fix yet. */
  nearestDistanceMeters: number | null;
}

/**
 * Whether to put the nearest station in an empty origin field.
 *
 * Four rules, and each is here because the obvious version of this feature is
 * annoying in one specific way:
 *
 * - Never over a station already in the field, so it can't overwrite a choice.
 * - Once per visit, so a drifting fix can't rewrite the field underneath
 *   someone who is mid-plan. A guess that was right when the screen opened
 *   stays put even as GPS wanders.
 * - Never after the user has cleared it. Clearing is them saying the guess was
 *   wrong, and an app that answers that by guessing again immediately is
 *   arguing. Leaving the tab and coming back is what un-sticks it -- a
 *   deliberate gesture, and the one that means "I'm planning something else".
 * - Only when the station is genuinely near. A station 8 km away is a worse
 *   starting point than an empty field, and it reads as the app being confused
 *   about where its user is.
 */
export function shouldAutofillOrigin(inputs: OriginAutofillInputs): boolean {
  if (inputs.hasOrigin) return false;
  if (inputs.hasFilledThisVisit) return false;
  if (inputs.userClearedThisVisit) return false;
  if (inputs.nearestDistanceMeters === null) return false;
  return inputs.nearestDistanceMeters <= AUTOFILL_RADIUS_METERS;
}
