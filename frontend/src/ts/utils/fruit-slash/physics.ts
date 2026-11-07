/**
 * Fruit Slash physics (idea G10, phase 1): the arc step — pure math, no
 * state. Top-based vh: gravity pulls +y, the launch vy is negative (up).
 */

/** one Euler step: vy integrates gravity first, then both axes move */
export function stepArc(
  x: number,
  y: number,
  vx: number,
  vy: number,
  dtSec: number,
  gravityVhPerSec2: number,
): {
  x: number;
  y: number;
  vx: number;
  vy: number;
} {
  const nextVy = vy + gravityVhPerSec2 * dtSec;
  return {
    x: x + vx * dtSec,
    y: y + nextVy * dtSec,
    vx,
    vy: nextVy,
  };
}

/** ms from the launch until the apex (vy crosses zero): |vy0| / g */
export function apexTimeMs(
  vy0VhPerSec: number,
  gravityVhPerSec2: number,
): number {
  return (Math.abs(vy0VhPerSec) / gravityVhPerSec2) * 1000;
}
