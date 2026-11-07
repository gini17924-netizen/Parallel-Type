import { describe, expect, it } from "vitest";

import {
  buildShareGrid,
  computeWordlePools,
  gradeGuess,
  hashSeed,
  isAlphaWord,
  isValidGuess,
  len5,
  normalizeGuess,
  pickAnswer,
} from "../../../src/ts/utils/wordle/wordle-engine";

describe("wordle engine (idea G4 phase 1)", () => {
  describe("gradeGuess — the official two-pass, duplicate-safe grade", () => {
    it("the classic: answer level, guess eeler", () => {
      //greens consume E; the leftover E is gray, the L is yellow
      expect(gradeGuess("level", "eeler")).toEqual([
        { letter: "e", state: "gray" },
        { letter: "e", state: "green" },
        { letter: "l", state: "yellow" },
        { letter: "e", state: "green" },
        { letter: "r", state: "gray" },
      ]);
    });

    it("the same letter green twice consumes both copies", () => {
      //level has two L's and both land as greens: the leftovers stay gray
      expect(gradeGuess("level", "lllll")).toEqual([
        { letter: "l", state: "green" },
        { letter: "l", state: "gray" },
        { letter: "l", state: "gray" },
        { letter: "l", state: "gray" },
        { letter: "l", state: "green" },
      ]);
    });

    it("counts the answer's duplicates, never over-rewarding", () => {
      //answer abble: B at pos1,2. The guess bbsst lands one B green (pos1);
      //its other B (pos0) finds the second B still uncounted -> yellow
      expect(gradeGuess("abble", "bbsst")).toEqual([
        { letter: "b", state: "yellow" },
        { letter: "b", state: "green" },
        { letter: "s", state: "gray" },
        { letter: "s", state: "gray" },
        { letter: "t", state: "gray" },
      ]);
    });

    it("a perfect guess is all green", () => {
      const result = gradeGuess("crane", "crane");
      expect(result.every((cell) => cell.state === "green")).toBe(true);
    });
  });

  describe("pickAnswer — the deterministic daily pick", () => {
    const pool = ["crane", "apple", "level", "eeler"].sort();

    it("the same dayKey + lang picks the same answer", () => {
      const a = pickAnswer(pool, "2026-11-7", "en");
      const b = pickAnswer(pool, "2026-11-7", "en");
      expect(a).toBe(b);
      expect(pool).toContain(a);
    });

    it("different languages hash differently on the same day", () => {
      const en = pickAnswer(pool, "2026-11-7", "en");
      const fa = pickAnswer(pool, "2026-11-7", "fa");
      //not guaranteed different for every pool/day, but pinned here:
      expect(en).toBeDefined();
      expect(fa).toBeDefined();
      expect(en === fa).toBe(false);
    });

    it("stays within the pool bounds and handles the empty pool", () => {
      for (let day = 1; day <= 60; day++) {
        const answer = pickAnswer(pool, `2026-11-${day}`, "en");
        expect(pool).toContain(answer);
      }
      expect(pickAnswer([], "2026-11-7", "en")).toBeUndefined();
    });

    it("the hash is stable across module semantics (pure function)", () => {
      expect(hashSeed("2026-11-7:en")).toBe(hashSeed("2026-11-7:en"));
      expect(hashSeed("2026-11-7:en")).not.toBe(hashSeed("2026-11-8:en"));
    });
  });

  describe("pools and normalization", () => {
    it("len5 keeps only 5-letter alpha words", () => {
      expect(len5(["abcde", "abc", "abcdef", "ab-de", "abcde‌"])).toEqual([
        "abcde",
      ]);
    });

    it("isAlphaWord rejects digits, hyphens and ZWNJ", () => {
      expect(isAlphaWord("abcde")).toBe(true);
      expect(isAlphaWord("سلام‌بار")).toBe(false); //ZWNJ inside
      expect(isAlphaWord("ab1de")).toBe(false);
      expect(isAlphaWord("آب‌ها")).toBe(false);
    });

    it("computeWordlePools intersects the common list with the valid list", () => {
      const common = ["crane", "apple", "weird", "abc"];
      const valid = ["crane", "apple", "cranes", "ab1cd", "weird"];
      const pools = computeWordlePools(common, valid);
      //answers: common AND valid (weird is both -> included); abc is not
      //5 letters; cranes/ab1cd never pass the valid-list filter
      expect(pools.answers).toEqual(["apple", "crane", "weird"]);
      expect(pools.validGuesses).toEqual(["apple", "crane", "weird"]);
    });

    it("normalizeGuess strips ZWNJ, hyphens and casing", () => {
      expect(normalizeGuess("کلمه‌ها")).toBe("کلمهها");
      expect(normalizeGuess("AB-cd")).toBe("abcd");
      expect(normalizeGuess("  Crane ")).toBe("crane");
    });

    it("isValidGuess accepts the normalized form", () => {
      const validSet = new Set(["crane"]);
      expect(isValidGuess("CRANE", validSet)).toBe(true);
      expect(isValidGuess("cranes", validSet)).toBe(false);
      expect(isValidGuess("xyz", validSet)).toBe(false);
    });
  });

  describe("buildShareGrid", () => {
    it("renders the emoji grid under the header", () => {
      const rows = [
        gradeGuess("crane", "naerc"), //no positional match: all yellow
        gradeGuess("crane", "crane"), //all green
        gradeGuess("crane", "xxxxx"), //nothing present: all gray
      ];
      const grid = buildShareGrid(rows, "wordle-like #1 en 2/6");
      expect(grid.split("\n")[0]).toBe("wordle-like #1 en 2/6");
      expect(grid).toContain("🟩");
      expect(grid).toContain("🟨");
      expect(grid).toContain("⬛");
    });
  });
});
