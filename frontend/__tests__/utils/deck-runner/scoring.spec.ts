import { describe, it, expect } from "vitest";

import {
  comboMultiplier,
  wordScore,
} from "../../../src/ts/utils/deck-runner/scoring";
import type { WordEvent } from "../../../src/ts/utils/deck-runner/round-engine";

function evt(word: string, overrides: Partial<WordEvent> = {}): WordEvent {
  return {
    word,
    typed: word,
    correct: true,
    accuracy: 1,
    chars: word.length,
    errors: 0,
    skipped: false,
    elapsedMs: 0,
    comboBefore: 0,
    ...overrides,
  };
}

describe("deck-runner scoring (G24)", () => {
  it("base chips = 5 per char, mult 1 at zero combo", () => {
    expect(wordScore(evt("abc"), { combo: 0, sourceId: "en-1k" })).toEqual({
      chips: 15,
      mult: 1,
      total: 15,
    });
  });

  it("combo tiers: 1 / 1.2 / 1.5 / 2 / 3 (within a blind's reach)", () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(5)).toBe(1.2);
    expect(comboMultiplier(10)).toBe(1.5);
    expect(comboMultiplier(20)).toBe(2);
    expect(comboMultiplier(30)).toBe(3);
    //a 2-char word at combo 30: chips 10 × 3 = 30
    expect(wordScore(evt("ab"), { combo: 30, sourceId: "en-1k" }).total).toBe(
      30,
    );
  });

  it("rare char bonus comes from the per-language table", () => {
    //ظ is in the fa table
    const fa = wordScore(evt("ظب"), { combo: 0, sourceId: "fa-1k" });
    expect(fa.chips).toBe(5 * 2 + 10);
    //same char with a non-fa source: no table
    const en = wordScore(evt("ظب"), { combo: 0, sourceId: "en-1k" });
    expect(en.chips).toBe(10);
    //language wins over the sourceId prefix (weakness:/custom: ids have no
    //usable prefix): a persian run on a weakness source still gets the table
    const byLanguage = wordScore(evt("ظب"), {
      combo: 0,
      sourceId: "weakness:en-1k",
      language: "persian",
    });
    expect(byLanguage.chips).toBe(5 * 2 + 10);
  });

  it("code words get +15 (sourceId starts with code)", () => {
    const code = wordScore(evt("abc"), { combo: 0, sourceId: "code-python" });
    expect(code.chips).toBe(15 + 15);
  });

  it("words of 8+ chars get +20", () => {
    expect(
      wordScore(evt("abcdefgh"), { combo: 0, sourceId: "en-1k" }).chips,
    ).toBe(40 + 20);
  });

  it("joker pipeline applies in slot order", () => {
    const order: string[] = [];
    const addChips = (acc: {
      chips: number;
      mult: number;
    }): { chips: number; mult: number } => {
      order.push("addChips");
      return { chips: acc.chips + 10, mult: acc.mult };
    };
    const doubleMult = (acc: {
      chips: number;
      mult: number;
    }): { chips: number; mult: number } => {
      order.push("doubleMult");
      return { chips: acc.chips, mult: acc.mult * 2 };
    };
    const result = wordScore(evt("abc"), {
      combo: 0,
      sourceId: "en-1k",
      jokers: [addChips, doubleMult],
    });
    expect(order).toEqual(["addChips", "doubleMult"]);
    //chips added BEFORE the mult doubled: (15+10)×2 = 50
    expect(result.total).toBe(50);
  });

  it("total is rounded", () => {
    //chips 15 × mult 1.2 = 18 exactly; use 5 chars × 1.15 via joker to force .5
    const result = wordScore(evt("abcde"), {
      combo: 0,
      sourceId: "en-1k",
      jokers: [(acc) => ({ chips: acc.chips, mult: acc.mult + 0.15 })],
    });
    expect(result.total).toBe(Math.round(25 * 1.15));
  });
});
