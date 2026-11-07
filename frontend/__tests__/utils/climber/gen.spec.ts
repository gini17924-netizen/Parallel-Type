import { describe, expect, it } from "vitest";

import { BALANCE } from "../../../src/ts/utils/climber/balance";
import {
  generateStack,
  makePlatform,
  stageOf,
  timerFor,
} from "../../../src/ts/utils/climber/gen";

describe("sky climber gen (idea G15 phase 1)", () => {
  it("the stack is deterministic under the injected word source", () => {
    const a = generateStack(8, () => "cat");
    const b = generateStack(8, () => "cat");
    expect(a).toEqual(b);
    expect(a).toHaveLength(8);
    expect(a[0]?.index).toBe(0);
    expect(a[7]?.index).toBe(7);
  });

  it("the timer decays with height and clamps at the floor", () => {
    expect(timerFor(0)).toBe(BALANCE.timerStartMs);
    expect(timerFor(10)).toBe(
      BALANCE.timerStartMs - 10 * BALANCE.timerDecayMsPerPlatform,
    );
    expect(timerFor(1000)).toBe(BALANCE.timerMinMs);
  });

  it("makePlatform binds the word source per index", () => {
    const platform = makePlatform(3, (index) => `w${index}`);
    expect(platform.word).toBe("w3");
    expect(platform.timerMs).toBe(timerFor(3));
  });

  it("stageOf steps every 15 platforms", () => {
    expect(stageOf(0)).toBe(1);
    expect(stageOf(14)).toBe(1);
    expect(stageOf(15)).toBe(2);
    expect(stageOf(30)).toBe(3);
  });
});
