import { useEffect, useReducer, useRef } from 'react';
import { isGliding, type Glide } from './glide';

/**
 * Re-renders the calling component every frame while any of `glides` is still
 * mid-move, and stops the moment they have all arrived.
 *
 * This is the cheap way to animate map pins: interpolate the *coordinates* on
 * a frame loop and let the existing sources/markers follow, so there are no
 * extra views and no extra animated nodes per pin. The alternative -- a
 * Reanimated view for every pin -- is what made smooth movement look
 * unaffordable in the first place.
 *
 * An idle map costs nothing: with nothing moving the loop is never started.
 */
export function useGlideFrames(glides: Glide[]): void {
  const [, tick] = useReducer((count: number) => count + 1, 0);
  const frameRef = useRef<number | null>(null);

  // Re-keyed on the fixes themselves, so a new one restarts the loop for its
  // fresh animation window. Keyed on the timestamps rather than the array,
  // which is rebuilt on every unrelated re-render.
  const signature = glides.map((glide) => `${glide.fromAt}:${glide.toAt}`).join('|');

  useEffect(() => {
    let cancelled = false;

    const step = () => {
      if (cancelled) return;
      const now = Date.now();
      if (!glides.some((glide) => isGliding(glide, now))) {
        frameRef.current = null;
        return; // everything has arrived -- stop until the next fix
      }
      tick();
      frameRef.current = requestAnimationFrame(step);
    };

    if (glides.some((glide) => isGliding(glide, Date.now()))) {
      frameRef.current = requestAnimationFrame(step);
    }

    return () => {
      cancelled = true;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature`
    // stands in for the glide set; depending on the array itself would restart
    // the loop on every unrelated re-render.
  }, [signature]);
}
