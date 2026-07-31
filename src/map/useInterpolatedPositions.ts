import { useMemo } from 'react';
import type { FriendLocation } from '../realtime/locationStore';
import { glideAt, type Glide } from './glide';
import { useGlideFrames } from './useGlideFrames';

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
 * Glides friend pins between broadcasts instead of teleporting them every few
 * seconds. See `glide.ts` for the interpolation itself and `useGlideFrames`
 * for the loop that drives it.
 *
 * The pins trail roughly one broadcast interval behind the true position,
 * which is the standard trade for not extrapolating into positions a friend
 * never actually occupied.
 */
export function useInterpolatedPositions(
  locations: FriendLocation[],
): Record<string, [number, number]> {
  const glides = useMemo(() => locations.map(glideFor), [locations]);

  useGlideFrames(glides);

  const now = Date.now();
  const positions: Record<string, [number, number]> = {};
  locations.forEach((location, index) => {
    positions[location.userId] = glideAt(glides[index], now);
  });
  return positions;
}
