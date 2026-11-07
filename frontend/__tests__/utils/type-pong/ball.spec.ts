import { describe, expect, it } from "vitest";

import { BALANCE } from "../../../src/ts/utils/type-pong/balance";
import {
  ballSpeed,
  capSpeed,
  jitterVx,
  stepBall,
  type Ball,
} from "../../../src/ts/utils/type-pong/ball";

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

describe("type pong ball (idea G13 phase 1)", () => {
  it("integrates the position linearly", () => {
    const ball: Ball = { x: 50, y: 50, vx: 20, vy: -40 };
    stepBall(ball, 0.5, makeRng(1));
    expect(ball.x).toBe(50 + 10);
    expect(ball.y).toBe(50 - 20);
  });

  it("reflects off the side walls with a small jitter", () => {
    const ball: Ball = { x: 99, y: 50, vx: 30, vy: -40 };
    stepBall(ball, 0.2, makeRng(7)); //x = 105 -> reflected to 95
    expect(ball.x).toBeCloseTo(95, 0);
    expect(ball.vx).toBeLessThan(0); //flipped
    expect(Math.abs(ball.vx)).toBeGreaterThanOrEqual(BALANCE.minAbsVx);
  });

  it("enforces the minimum |vx| after a jitter squash", () => {
    const ball: Ball = { x: 50, y: 50, vx: -2, vy: 60 };
    jitterVx(ball, () => 0.5); //a reflection: the direction flips, then
    //the min-|vx| enforcement restores the magnitude
    expect(Math.abs(ball.vx)).toBeGreaterThanOrEqual(BALANCE.minAbsVx);
    expect(ball.vx).toBeGreaterThan(0); //the direction flipped (-2 -> +)
  });

  it("caps the ball speed", () => {
    const ball: Ball = { x: 50, y: 50, vx: 150, vy: 150 };
    capSpeed(ball);
    expect(ballSpeed(ball)).toBeCloseTo(BALANCE.ballSpeedMax, 0);
  });

  it("the speed cap holds through bounces", () => {
    const ball: Ball = { x: 50, y: 50, vx: -140, vy: -140 };
    jitterVx(ball, makeRng(3));
    expect(ballSpeed(ball)).toBeLessThanOrEqual(BALANCE.ballSpeedMax + 1);
  });
});
