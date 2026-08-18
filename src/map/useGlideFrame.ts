import { useEffect, useReducer, useRef } from 'react';
import { isGliding, type Glide } from './glide';

/**
 * Re-renders the calling component every frame while `glide` is still
 * mid-move, and stops the moment it arrives.
 *
 * This is the cheap way to animate map pins: interpolate the *coordinates* on
 * a frame loop and let the existing sources/markers follow, so there are no
 * extra views and no extra animated nodes per pin. The alternative -- a
 * Reanimated view for every pin -- is what made smooth movement look
 * unaffordable in the first place.
 *
 * One glide, not a list, and that is the whole point of the shape. Driving a
 * set of pins from a single loop meant the component holding the list
 * re-rendered every frame, so one friend moving re-rendered every other
 * friend's marker, every avatar, and every destination flag alongside them.
 * Mounted per pin instead, a frame costs exactly the subtree that actually
 * moved. The loops are not additive in the way that suggests: several pins
 * moving at once still resolve within one frame, and React batches the state
 * updates they produce into a single render pass.
 *
 * An idle map costs nothing: with nothing moving, no loop is ever started.
 */
export function useGlideFrame(glide: Glide | null): void {
  const [, tick] = useReducer((count: number) => count + 1, 0);
  const frameRef = useRef<number | null>(null);

  // Re-keyed on the fix itself, so a new one restarts the loop for its fresh
  // animation window. Keyed on the timestamps rather than the object, which is
  // rebuilt on every unrelated re-render.
  const signature = glide ? `${glide.fromAt}:${glide.toAt}` : '';

  useEffect(() => {
    if (!glide) return;
    let cancelled = false;

    const step = () => {
      if (cancelled) return;
      if (!isGliding(glide, Date.now())) {
        frameRef.current = null;
        return; // arrived -- stop until the next fix
      }
      tick();
      frameRef.current = requestAnimationFrame(step);
    };

    if (isGliding(glide, Date.now())) {
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
    // stands in for the glide; depending on the object itself would restart
    // the loop on every unrelated re-render.
  }, [signature]);
}
