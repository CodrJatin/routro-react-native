/** Wall-clock time, the way every other arrival in the app is printed. */
export function formatClockTime(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** A duration in whole minutes. Rounded rather than floored, and never zero:
 * "0 min" reads as a bug where "1 min" reads as an estimate. */
export function formatMinutes(ms: number): string {
  return `${Math.max(1, Math.round(ms / 60_000))} min`;
}

/** How much of a delay, or nothing at all. Used for the "+6 min" beside a
 * pushed-back arrival, which is the number someone actually decides on. */
export function formatDelay(ms: number | null): string | null {
  if (ms === null) return null;
  if (ms < 60_000) return null;
  return `+${Math.round(ms / 60_000)} min`;
}
