import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  ENTER_STAT_KEY,
  generateEnterDrillWords,
  MAX_CUSTOM_TEXT_TOKENS,
  normalizeEnterStatKey,
} from "../../src/ts/utils/enter-drill";
import {
  computeLetterStats,
  registerDrillResult,
} from "../../src/ts/utils/learn-stats";

describe("generateEnterDrillWords (idea #9)", () => {
  it("is deterministic for the same seed and style", () => {
    const a = generateEnterDrillWords(
      "prose",
      ["the", "quick", "fox"],
      10,
      12345,
    );
    const b = generateEnterDrillWords(
      "prose",
      ["the", "quick", "fox"],
      10,
      12345,
    );
    expect(a).toEqual(b);
  });

  it.each(["prose", "code", "chat"] as const)(
    "%s: only the last token of each line ends with a newline",
    (style) => {
      const tokens = generateEnterDrillWords(
        style,
        ["the", "quick", "fox"],
        8,
        42,
      );
      expect(tokens.length).toBeGreaterThan(0);
      let newlines = 0;
      for (const token of tokens) {
        //no mid-token newline: if present at all, it is the final character
        if (token.includes("\n")) {
          expect(token.indexOf("\n")).toBe(token.length - 1);
          newlines++;
        }
      }
      //every generated line (but the engine strips the last line's Enter at
      //run time - the generator still emits it) contributes exactly one
      expect(newlines).toBeGreaterThan(0);
    },
  );

  it("never puts a space inside a token and respects the custom-mode cap", () => {
    const longList = Array.from({ length: 300 }, (_, i) => `word${i}`);
    const tokens = generateEnterDrillWords("prose", longList, 25, 7);
    for (const token of tokens) {
      expect(token.includes(" ")).toBe(false);
    }
    expect(tokens.length).toBeLessThanOrEqual(MAX_CUSTOM_TEXT_TOKENS);
  });

  it("works without a language list (built-in fallback pool)", () => {
    const tokens = generateEnterDrillWords("chat", [], 5, 9);
    expect(tokens.length).toBeGreaterThan(0);
  });
});

describe("enter stat key mapping (idea #9)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("computeLetterStats already tracks the newline as a key", () => {
    const stats = computeLetterStats(["fox\n"], ["fox\n"]);
    expect(stats["\n"]?.correct).toBe(1);
    const missed = computeLetterStats(["fox\n"], ["fox "]);
    expect(missed["\n"]?.incorrect).toBe(1);
  });

  it("normalizeEnterStatKey merges the raw newline into the enter key", () => {
    const normalized = normalizeEnterStatKey({
      f: { correct: 3, incorrect: 0 },
      "\n": { correct: 2, incorrect: 1 },
      enter: { correct: 5, incorrect: 0 },
    });
    expect(normalized["enter"]).toEqual({ correct: 7, incorrect: 1 });
    expect(normalized["\n"]).toBeUndefined();
    expect(normalized["f"]).toEqual({ correct: 3, incorrect: 0 });
  });

  it("registerDrillResult persists enter stats under the enter key (SM-2 included)", () => {
    //an enter drill: two lines, first Enter correct, second missed
    registerDrillResult(
      ["salam\n", "khoobi\n"],
      ["salam\n", "khoobi "],
      "persian",
    );
    const state = JSON.parse(
      window.localStorage.getItem("mtDesktopLearnState") ?? "{}",
    ) as { keyStats: Record<string, { correct: number; incorrect: number }> };
    expect(state.keyStats[ENTER_STAT_KEY]).toBeDefined();
    expect(state.keyStats[ENTER_STAT_KEY]?.incorrect).toBe(1);
    expect(state.keyStats["\n"]).toBeUndefined();
    //SM-2 schedule applies to the enter key like any letter
    expect(window.localStorage.getItem("mtDesktopLearnState")).toContain(
      '"enter":{',
    );
  });
});
