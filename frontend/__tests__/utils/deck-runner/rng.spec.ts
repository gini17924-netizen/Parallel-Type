import { describe, it, expect } from "vitest";

import { createRng } from "../../../src/ts/utils/deck-runner/rng";

describe("deck-runner rng (G24)", () => {
  it("same seed produces the same sequence", () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = Array.from({ length: 100 }, () => a());
    const seqB = Array.from({ length: 100 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("values stay within [0, 1)", () => {
    const rng = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("different seeds diverge immediately", () => {
    expect(createRng(1)()).not.toBe(createRng(2)());
  });

  it("negative and zero seeds are normalized without throwing", () => {
    expect(() => createRng(0)()).not.toThrow();
    expect(() => createRng(-77)()).not.toThrow();
  });
});
