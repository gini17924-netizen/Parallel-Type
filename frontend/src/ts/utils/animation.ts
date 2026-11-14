import { animate, AnimationParams } from "animejs";

/**
 * phase 95: THE imperative animejs entry — every promise-based animation
 * goes through this gate so prefers-reduced-motion is honored in exactly
 * one place. reduced motion runs the animation at ZERO duration: the final
 * values still apply (an outright skip would leave the element in its
 * pre-animation state) and the promise resolves at once. this module is a
 * LEAF (animejs + nothing else) so both utils/misc and utils/dom can
 * delegate without a cycle.
 */

export function prefersReducedMotion(): boolean {
  return matchMedia?.("(prefers-reduced-motion)")?.matches ?? false;
}

/** the effective params for one animation: reduced motion collapses the
 * duration and delay to zero — pure, so the gate is unit-testable without
 * intercepting animejs */
export function effectiveAnimationParams(
  options: AnimationParams,
  reduced: boolean,
): AnimationParams {
  return reduced ? { ...options, duration: 0, delay: 0 } : options;
}

export async function promiseAnimate(
  el: HTMLElement | string,
  options: AnimationParams,
): Promise<void> {
  await new Promise<void>((resolve) => {
    const effective = effectiveAnimationParams(options, prefersReducedMotion());
    animate(el, {
      ...effective,
      onComplete: (self, e) => {
        options.onComplete?.(self, e);
        resolve();
      },
    });
  });
}
