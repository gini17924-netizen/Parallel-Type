import { describe, it, expect } from "vitest";

import {
  createWordSource,
  normalizePool,
} from "../../../src/ts/utils/deck-runner/words-source";
import { createRng } from "../../../src/ts/utils/deck-runner/rng";

describe("deck-runner words-source (G24)", () => {
  describe("normalizePool", () => {
    it("drops too-short, too-long and spaced words", () => {
      const pool = normalizePool([
        "ab",
        "abcd",
        "toolongword",
        "two words",
        "abc",
      ]);
      expect(pool).toEqual(["abcd", "abc"]);
    });

    it("dedupes case-insensitively", () => {
      expect(normalizePool(["abc", "ABC", "abd"])).toEqual(["abc", "abd"]);
    });
  });

  describe("createWordSource", () => {
    it("returns empty string when the pool normalizes to nothing", () => {
      const source = createWordSource({
        id: "en-1k",
        kind: "language",
        pool: ["ab", "x"],
        rng: createRng(1),
      });
      expect(source.nextWord()).toBe("");
    });

    it("uniform kind: same seed produces the same sequence", () => {
      const pool = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];
      const make = (): string[] => {
        const source = createWordSource({
          id: "en-1k",
          kind: "language",
          pool,
          rng: createRng(999),
        });
        return Array.from({ length: 10 }, () => source.nextWord());
      };
      expect(make()).toEqual(make());
    });

    it("dedupe window: consecutive picks from a big pool do not repeat", () => {
      const pool = Array.from({ length: 30 }, (_, i) => `word${i}`);
      const source = createWordSource({
        id: "en-1k",
        kind: "language",
        pool,
        rng: createRng(5),
      });
      const picks = Array.from({ length: 10 }, () => source.nextWord());
      expect(new Set(picks).size).toBe(10);
    });

    it("zipf kind mirrors the upstream distribution deterministically", () => {
      const pool = Array.from({ length: 1000 }, (_, i) => `w${i}`);
      const make = (): string[] => {
        const source = createWordSource({
          id: "en-1k",
          kind: "zipf",
          pool,
          rng: createRng(31337),
        });
        return Array.from({ length: 20 }, () => source.nextWord());
      };
      const a = make();
      const b = make();
      expect(a).toEqual(b);
      //zipf favours early (frequent) indices: low-index words dominate
      const low = a.filter((w) => Number(w.slice(1)) < 50).length;
      expect(low).toBeGreaterThan(0);
    });

    it("weakness kind: argmax prefers the word with the weak char", () => {
      const source = createWordSource({
        id: "fa-1k",
        kind: "weakness",
        pool: ["فبب", "اثث"],
        rng: createRng(11),
        weakness: {
          ف: { letter: "ف", score: 1, acc: 0.3, total: 10, evidence: [] },
        },
      });
      expect(source.nextWord()).toBe("فبب");
      //recent-window dedupe: the second pick takes the other word
      expect(source.nextWord()).toBe("اثث");
    });

    it("weakness kind falls back to uniform with an empty map", () => {
      const source = createWordSource({
        id: "en-1k",
        kind: "weakness",
        pool: ["alpha", "beta"],
        rng: createRng(3),
        weakness: {},
      });
      expect(["alpha", "beta"]).toContain(source.nextWord());
    });
  });
});
