import { describe, expect, it } from "vitest";

import {
  aiSpeedMps,
  checkpointMult,
} from "../../../src/ts/utils/nitro-run/balance";
import {
  aiAdvance,
  checkpointsFor,
  createAiRacer,
} from "../../../src/ts/utils/nitro-run/racers";

describe("nitro run racers (idea G23 phase 1)", () => {
  it("converts wpm to m/s on the 5-char standard (60wpm = 50 m/s)", () => {
    expect(aiSpeedMps(60)).toBeCloseTo(50, 6);
    expect(aiSpeedMps(90)).toBeCloseTo(75, 6);
  });

  it("the checkpoint multiplier compounds x1.05 per checkpoint", () => {
    expect(checkpointMult(0)).toBe(1);
    expect(checkpointMult(1)).toBeCloseTo(1.05, 6);
    expect(checkpointMult(2)).toBeCloseTo(1.1025, 6);
  });

  it("advances a racer time-based with the checkpoint scaling", () => {
    const racer = createAiRacer({ wpmBase: 60, lane: 0 });
    aiAdvance(racer, 1, 0); //1s at 50 m/s
    expect(racer.progressM).toBeCloseTo(50, 6);
    aiAdvance(racer, 1, 2); //1s at 50 x 1.1025
    expect(racer.progressM).toBeCloseTo(50 + 55.125, 4);
  });

  it("the checkpoint count derives from the player's distance", () => {
    expect(checkpointsFor(0, 500)).toBe(0);
    expect(checkpointsFor(499, 500)).toBe(0);
    expect(checkpointsFor(500, 500)).toBe(1);
    expect(checkpointsFor(1234, 500)).toBe(2);
  });
});
