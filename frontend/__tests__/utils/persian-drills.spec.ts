import { describe, expect, it } from "vitest";

import {
  buildPersianPunctuationDrillWords,
  buildZwnjDrillWords,
  PERSIAN_PUNCTUATION,
  ZWNJ,
} from "../../src/ts/utils/persian-drills";

const ZWNJ_RE = /\u200c/;

describe("phase 69 — the ZWNJ drill generator", () => {
  it("every word carries a half-space and no spaces", () => {
    const words = buildZwnjDrillWords(30, 42);
    expect(words).toHaveLength(30);
    for (const word of words) {
      expect(ZWNJ_RE.test(word)).toBe(true);
      expect(word.includes(" ")).toBe(false);
    }
  });

  it("builds valid morphological forms", () => {
    const words = buildZwnjDrillWords(60, 7);
    for (const word of words) {
      const [prefix, rest] = word.split(ZWNJ);
      //prefixed verbs: می/نمی + stem + personal ending
      if (prefix === "می" || prefix === "نمی") {
        expect(rest.length).toBeGreaterThan(1);
      } else {
        //noun suffixes and superlatives
        expect(["ها", "های", "ان", "ام", "هایم", "ترین"].some((s) => rest.endsWith(s))).toBe(
          true,
        );
      }
    }
  });

  it("is deterministic per seed", () => {
    expect(buildZwnjDrillWords(25, 99)).toEqual(buildZwnjDrillWords(25, 99));
    expect(buildZwnjDrillWords(25, 99)).not.toEqual(
      buildZwnjDrillWords(25, 100),
    );
  });
});

describe("phase 69 — the punctuation drill generator", () => {
  it("every token carries persian punctuation, none latin", () => {
    //5 words x 6 token shapes = 30 unique combinations — enough for 25
    const pool = ["سلام", "خانه", "کتاب", "شهر", "روز"];
    const words = buildPersianPunctuationDrillWords(25, 5, pool);
    expect(words).toHaveLength(25);
    for (const word of words) {
      expect(PERSIAN_PUNCTUATION.some((mark) => word.includes(mark))).toBe(
        true,
      );
      //latin-only punctuation is forbidden — note "!" is SHARED between
      //scripts (the persian exclamation is the same U+0021 glyph)
      expect(word).not.toMatch(/[,;?"]/);
      //tokens come from the pool (wrapped or marked)
      const stripped = word.replace(/[«»،؛؟!:]/g, "");
      expect(pool).toContain(stripped);
    }
  });

  it("the «» pair produces one wrapped shape per word, not two", () => {
    const words = buildPersianPunctuationDrillWords(500, 1, ["آب"]);
    //1 word x 6 shapes = 6 unique tokens max — the loop must stop there
    expect(words.length).toBeLessThanOrEqual(6);
    const wrapped = words.filter((w) => w.startsWith("«"));
    for (const w of wrapped) {
      expect(w).toBe("«آب»");
    }
  });

  it("falls back to the built-in pool without a word list", () => {
    const words = buildPersianPunctuationDrillWords(10, 3);
    expect(words).toHaveLength(10);
    for (const word of words) {
      expect(word.length).toBeGreaterThan(2);
    }
  });

  it("stops on an exhausted tiny pool instead of looping forever", () => {
    const words = buildPersianPunctuationDrillWords(500, 1, ["آب", "نور"]);
    //2 words x 6 shapes = 12 unique tokens max
    expect(words.length).toBeLessThanOrEqual(12);
    expect(words.length).toBeGreaterThan(0);
  });

  it("is deterministic per seed", () => {
    const pool = ["سلام", "خانه", "کتاب", "شهر", "روز"];
    expect(buildPersianPunctuationDrillWords(20, 77, pool)).toEqual(
      buildPersianPunctuationDrillWords(20, 77, pool),
    );
  });
});
