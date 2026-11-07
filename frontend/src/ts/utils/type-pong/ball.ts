import { BALANCE } from "./balance";

/**
 * Type Pong ball physics (idea G13, phase 1): pure math — the position
 * integrates the velocity, the side walls reflect with a +-2% jitter
 * (anti infinite-corner-ping-pong, doc G13 §۵), the speed is capped and
 * a minimum |vx| is enforced after every touch. PURE.
 */

export type Ball = { x: number; y: number; vx: number; vy: number };

export function ballSpeed(ball: Ball): number {
  return Math.hypot(ball.vx, ball.vy);
}

export function capSpeed(ball: Ball): void {
  const speed = ballSpeed(ball);
  if (speed <= BALANCE.ballSpeedMax) return;
  const scale = BALANCE.ballSpeedMax / speed;
  ball.vx *= scale;
  ball.vy *= scale;
}

export function enforceMinVx(ball: Ball): void {
  const min = BALANCE.minAbsVx;
  if (Math.abs(ball.vx) >= min) return;
  ball.vx = ball.vx < 0 ? -min : min;
}

/** reflects the horizontal velocity with a +-jitter multiplier */
export function jitterVx(ball: Ball, rng: () => number): void {
  const jitter = 1 + (rng() * 2 - 1) * BALANCE.bounceJitter;
  ball.vx = -ball.vx * jitter;
  enforceMinVx(ball);
  capSpeed(ball);
}

/** one physics step: integrate, then reflect off the side walls */
export function stepBall(ball: Ball, dtSec: number, rng: () => number): void {
  ball.x += ball.vx * dtSec;
  ball.y += ball.vy * dtSec;
  if (ball.x < 0) {
    ball.x = -ball.x;
    jitterVx(ball, rng);
  } else if (ball.x > BALANCE.courtW) {
    ball.x = 2 * BALANCE.courtW - ball.x;
    jitterVx(ball, rng);
  }
}
