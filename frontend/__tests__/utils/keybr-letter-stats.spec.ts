import { describe, it, expect, beforeEach } from "vitest";

import { loadKeybrLetterStats } from "../../src/ts/utils/keybr-letter-stats";
import {
  weakLetters,
  rustyLetters,
  getLearnState,
} from "../../src/ts/utils/learn-stats";

/** ف U+0641, ا U+0627, ج U+062C — English j U+006A */
const FA_F = 0x0641;
const FA_ALEF = 0x0627;
const EN_J = 0x006a;

function keybrSession(
  histogram: { codePoint: number; hitCount: number; missCount: number }[],
): unknown {
  return { timeStamp: 1, length: 10, time: 5, errors: 1, histogram };
}

describe("loadKeybrLetterStats (keybr → drills bridge, read-only)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("aggregates every mtKeybrResults:* language into per-letter stats", () => {
    window.localStorage.setItem(
      "mtKeybrResults:fa",
      JSON.stringify([
        keybrSession([
          { codePoint: FA_F, hitCount: 3, missCount: 7 },
          { codePoint: 32, hitCount: 5, missCount: 0 }, //spacebar
        ]),
        keybrSession([
          { codePoint: FA_F, hitCount: 4, missCount: 1 },
          { codePoint: FA_ALEF, hitCount: 9, missCount: 1 },
        ]),
      ]),
    );
    window.localStorage.setItem(
      "mtKeybrResults:en",
      JSON.stringify([
        keybrSession([{ codePoint: EN_J, hitCount: 2, missCount: 2 }]),
      ]),
    );

    expect(loadKeybrLetterStats()).toEqual({
      ف: { correct: 7, incorrect: 8 },
      ا: { correct: 9, incorrect: 1 },
      j: { correct: 2, incorrect: 2 },
    });
  });

  it("skips corrupt payloads instead of failing", () => {
    window.localStorage.setItem("mtKeybrResults:fa", "{not json");
    window.localStorage.setItem(
      "mtKeybrResults:en",
      "[null, {histogram: [null, 5]}]",
    );
    expect(loadKeybrLetterStats()).toEqual({});
  });

  it("returns nothing when the user never used the keybr engine", () => {
    expect(loadKeybrLetterStats()).toEqual({});
  });

  it("surfaces keybr-weak letters in weakLetters without touching the learn state", () => {
    window.localStorage.setItem(
      "mtKeybrResults:fa",
      JSON.stringify([
        keybrSession([{ codePoint: FA_F, hitCount: 3, missCount: 7 }]),
      ]),
    );
    const weak = weakLetters(8);
    expect(weak.some((it) => it.letter === "ف" && it.acc === 0.3)).toBe(true);

    //read-only guarantee: the learn state and its review schedule stay
    //monkeytype-driven
    expect(getLearnState().keyStats["ف"]).toBeUndefined();
    expect(rustyLetters(8).some((it) => it.letter === "ف")).toBe(false);
  });
});
