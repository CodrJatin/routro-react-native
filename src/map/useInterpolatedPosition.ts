import { useMemo } from 'react';
import type { FriendLocation } from '../realtime/locationStore';
import { glideAt, type Glide } from './glide';
import { useGlideFrame } from './useGlideFrame';

/** A friend's last two distinct fixes, as something `glide.ts` can animate.
 *
 * `movedAt`, not `receivedAt`: a heartbeat repeat refreshes the latter to
 * prove the friend is still live, and measuring against it would restart the
 * glide from the previous point every 15 seconds. */
function glideFor(location: FriendLocation): Glide {
  return {
    from: location.previous,
    to: { lat: location.lat, lon: location.lon },
    fromAt: location.previous?.movedAt ?? location.movedAt,
    toAt: location.movedAt,
  };
}

/**
 * Glides one friend's pin between broadcasts instead of teleporting it every
 * few seconds. See `glide.ts` for the interpolation itself and `useGlideFrame`
 * for the loop that drives it.
 *
 * Called from the component that draws a single pin, deliberately -- see the
 * note in `useGlideFrame`. It re-renders its caller once per frame while that
 * pin is moving, so its caller wants to be as small as possible.
 *
 * The pin trails roughly one broadcast interval behind the true position,
 * which is the standard trade for not extrapolating into positions a friend
 * never actually occupied.
 */
export function useInterpolatedPosition(location: FriendLocation): [number, number] {
  const glide = useMemo(() => glideFor(location), [location]);

  useGlideFrame(glide);

  // Deliberately not memoised: the render *is* the clock here, so a memo would
  // have to be keyed on the time it was trying to read.
  return glideAt(glide, Date.now());
}
