/**
 * Where a pin should be drawn *right now*, given that GPS arrives as a few
 * discrete fixes a minute.
 *
 * Shared by the user's own pin and their friends' pins so the two can't move
 * differently on the same map: a fix replaces a position, and the pin walks
 * there over the time the move actually took, rather than teleporting the
 * moment the number changes.
 *
 * Pure by design -- no React, no clock of its own. `now` is always passed in,
 * which is what makes every case below testable.
 */

/** Clamps on the animation duration. The gap between two fixes is the honest
 * duration to glide over, but a first fix after a long silence would
 * otherwise crawl across the screen for a minute, and a burst of fixes would
 * flicker. */
export const MIN_GLIDE_MS = 600;
export const MAX_GLIDE_MS = 6000;

export interface GlidePoint {
  lat: number;
  lon: number;
}

export interface Glide {
  /** Where the pin is coming from. Null for a first fix, which simply appears
   * -- there is nowhere honest to animate it from. */
  from: GlidePoint | null;
  to: GlidePoint;
  /** ms since epoch, THIS device's clock, for when `from` was first seen.
   * Never a sender's clock: the gap between the two stamps below is what sets
   * the animation duration, and cross-device drift would make it nonsense. */
  fromAt: number;
  /** ms since epoch, this device's clock, for when `to` was first seen. */
  toAt: number;
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** How long this move should take on screen, or null when there is nothing to
 * animate (a first fix, or two fixes that arrived out of order). */
export function glideDurationMs(glide: Glide): number | null {
  if (!glide.from) return null;
  const gap = glide.toAt - glide.fromAt;
  if (!Number.isFinite(gap) || gap <= 0) return null;
  return Math.min(Math.max(gap, MIN_GLIDE_MS), MAX_GLIDE_MS);
}

/** Whether this glide still has frames left to draw. Callers use it to stop
 * the frame loop the moment every pin has arrived. */
export function isGliding(glide: Glide, now: number): boolean {
  const duration = glideDurationMs(glide);
  if (duration === null) return false;
  return now - glide.toAt < duration && now >= glide.toAt;
}

/** The coordinate to draw at `now`, as `[lon, lat]` -- the order MapLibre
 * wants. Outside the animation window this is just the latest fix, so it is
 * always safe to call. */
export function glideAt(glide: Glide, now: number): [number, number] {
  const duration = glideDurationMs(glide);
  const from = glide.from;
  if (duration === null || !from) return [glide.to.lon, glide.to.lat];

  const t = (now - glide.toAt) / duration;
  if (t >= 1) return [glide.to.lon, glide.to.lat];
  if (t <= 0) return [from.lon, from.lat];

  const eased = easeOutCubic(t);
  return [lerp(from.lon, glide.to.lon, eased), lerp(from.lat, glide.to.lat, eased)];
}
