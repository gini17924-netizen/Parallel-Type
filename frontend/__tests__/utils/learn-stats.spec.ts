import { describe, it, expect, beforeEach, vi } from "vitest";

import { ENGLISH_GROUPS, PERSIAN_GROUPS } from "../../src/ts/utils/learn-stats";
import * as Learn from "../../src/ts/utils/learn-stats";

const PERSIAN_ALPHABET = [
  "ا",
  "آ",
  "ب",
  "پ",
  "ت",
  "ث",
  "ج",
  "چ",
  "ح",
  "خ",
  "د",
  "ذ",
  "ر",
  "ز",
  "ژ",
  "س",
  "ش",
  "ص",
  "ض",
  "ط",
  "ظ",
  "ع",
  "غ",
  "ف",
  "ق",
  "ک",
  "گ",
  "ل",
  "م",
  "ن",
  "و",
  "ه",
  "ی",
];

describe("letter groups", () => {
  it("english groups cover 26 letters + semicolon with no duplicates", () => {
    const letters = ENGLISH_GROUPS.join("").split("");
    expect(new Set(letters).size).toBe(letters.length);
    expect([...letters].sort()).toEqual(
      [..."abcdefghijklmnopqrstuvwxyz;"].sort(),
    );
  });

  it("persian groups cover the full alphabet exactly once (32 letters + آ)", () => {
    const letters = PERSIAN_GROUPS.join("").split("");
    expect(letters).toHaveLength(33);
    expect(new Set(letters).size).toBe(33);
    expect([...letters].sort()).toEqual([...PERSIAN_ALPHABET].sort());
  });

  it("persian groups contain no non-persian letters (regression: urdu ڑ)", () => {
    for (const group of PERSIAN_GROUPS) {
      for (const ch of group) {
        expect(PERSIAN_ALPHABET).toContain(ch);
      }
    }
  });
});

describe("computeLetterStats", () => {
  it("counts correct letters", () => {
    const stats = Learn.computeLetterStats(["fj"], ["fj"]);
    expect(stats["f"]).toEqual({ correct: 1, incorrect: 0 });
    expect(stats["j"]).toEqual({ correct: 1, incorrect: 0 });
  });

  it("counts a wrong letter against the expected and the typed letter", () => {
    const stats = Learn.computeLetterStats(["fj"], ["fx"]);
    expect(stats["f"]).toEqual({ correct: 1, incorrect: 0 });
    expect(stats["j"]).toEqual({ correct: 0, incorrect: 1 });
    expect(stats["x"]).toEqual({ correct: 0, incorrect: 1 });
  });

  it("counts extra characters as mistakes on the typed letter", () => {
    const stats = Learn.computeLetterStats(["f"], ["fj"]);
    expect(stats["j"]).toEqual({ correct: 0, incorrect: 1 });
  });

  it("skips spaces", () => {
    const stats = Learn.computeLetterStats(["ab", "cd"], ["ab", "cd"]);
    expect(stats[" "]).toBeUndefined();
  });

  it("tracks persian letters by codepoint", () => {
    const stats = Learn.computeLetterStats(["بت"], ["بت"]);
    expect(stats["ب"]).toEqual({ correct: 1, incorrect: 0 });
    expect(stats["ت"]).toEqual({ correct: 1, incorrect: 0 });
  });
});

describe("registerDrillResult (feedback loop)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("unlocks the next group at 95% accuracy over 20+ samples", async () => {
    const fresh = await import("../../src/ts/utils/learn-stats");
    const perfect = Array.from({ length: 12 }, () => "fj");
    let state = fresh.registerDrillResult(perfect, perfect, "english");
    expect(state.unlockedGroups).toBe(1); //12 samples < threshold
    state = fresh.registerDrillResult(perfect, perfect, "english");
    expect(state.unlockedGroups).toBe(2); //24 samples, 100% acc
  });

  it("stays locked when accuracy is below the threshold", async () => {
    const fresh = await import("../../src/ts/utils/learn-stats");
    const drill = Array.from({ length: 12 }, () => "fj");
    const sloppy = Array.from({ length: 12 }, () => "fx");
    const state = fresh.registerDrillResult(drill, sloppy, "english");
    expect(state.unlockedGroups).toBe(1);
  });

  it("persists state across module reloads (localStorage)", async () => {
    const first = await import("../../src/ts/utils/learn-stats");
    const perfect = Array.from({ length: 12 }, () => "fj");
    first.registerDrillResult(perfect, perfect, "english");
    first.registerDrillResult(perfect, perfect, "english");
    const second = await import("../../src/ts/utils/learn-stats");
    expect(second.getLearnState().unlockedGroups).toBe(2);
  });
});

describe("generateDrillWords", () => {
  it("falls back to pseudo-words when no real words match", () => {
    const words = Learn.generateDrillWords("english", "fj", [], 10);
    expect(words).toHaveLength(10);
    for (const word of words) {
      expect(word.length).toBeGreaterThanOrEqual(3);
      expect(word.length).toBeLessThanOrEqual(6);
      for (const ch of word) expect("fj").toContain(ch);
    }
  });

  it("returns only allowed real words when matches exist", () => {
    const list = ["fad", "dad", "salad", "jsfkx"];
    const words = Learn.generateDrillWords("english", "fsad", list, 3);
    expect(words.length).toBe(3);
    for (const word of words) {
      expect(["fad", "dad"]).toContain(word);
    }
  });

  it("keeps pseudo-words inside the allowed letters with bigram references", () => {
    const words = Learn.generatePseudoWords("fsad", 20, [
      "fad",
      "sad",
      "das",
      "affa",
    ]);
    expect(words).toHaveLength(20);
    for (const word of words) {
      expect(word.length).toBeGreaterThanOrEqual(3);
      expect(word.length).toBeLessThanOrEqual(6);
      for (const ch of word) expect("fsad").toContain(ch);
    }
  });

  it("favours real words containing the emphasized letters", () => {
    const list = ["fad", "dad", "sad", "das", "ads", "fas"];
    const words = Learn.generateDrillWords("english", "fsad", list, 6, "f");
    const withF = words.filter((word) => word.includes("f")).length;
    expect(withF).toBeGreaterThanOrEqual(2);
  });
});

describe("active drill words (wiring consumed exactly once)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it("consumes the active drill words exactly once", async () => {
    const fresh = await import("../../src/ts/utils/learn-stats");
    fresh.setActiveDrillWords(["a", "b"]);
    expect(fresh.takeActiveDrillWords()).toEqual(["a", "b"]);
    expect(fresh.takeActiveDrillWords()).toBeUndefined();
  });
});

describe("persian starter words (early-group coverage)", () => {
  it("supplies real curated words where the language list has none", () => {
    //group 1 only (بت): the 1k list matches zero words, the starters fill in
    const words = Learn.generateDrillWords("persian", "بت", [], 10);
    expect(words).toContain("بت");
    expect(words).toContain("تب");
    for (const word of words) {
      for (const ch of word) expect("بت").toContain(ch);
    }
  });

  it("unlocks more curated words as groups unlock", () => {
    //groups 1-3 (بتینسم): from the starter list
    const words = Learn.generateDrillWords("persian", "بتینسم", [], 15);
    expect(words).toContain("بین");
    expect(words).toContain("نیست");
    for (const word of words) {
      for (const ch of word) expect("بتینسم").toContain(ch);
    }
  });

  it("never uses starter words for english", () => {
    const words = Learn.generateDrillWords("english", "fj", [], 10);
    for (const word of words) {
      for (const ch of word) expect("fj").toContain(ch);
    }
  });
});

describe("spaced review (SM-2 lite)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("a clean letter doubles its interval, an error resets it to due-now", async () => {
    const fresh = await import("../../src/ts/utils/learn-stats");
    const before = Date.now();
    const perfect = Array.from({ length: 12 }, () => "fj");
    fresh.registerDrillResult(perfect, perfect, "english");
    const state = fresh.getLearnState();
    expect(state.reviewState?.["f"]?.intervalMs).toBe(2 * 86_400_000);
    expect(state.reviewState?.["f"]?.dueAt).toBeGreaterThanOrEqual(
      before + 2 * 86_400_000 - 1000,
    );
    //an error on f resets it to due-now (typed 'xj' vs 'fj': f is wrong)
    const drill = Array.from({ length: 12 }, () => "fj");
    const sloppy = Array.from({ length: 12 }, () => "xj");
    const state2 = fresh.registerDrillResult(drill, sloppy, "english");
    expect(state2.reviewState?.["f"]?.intervalMs).toBe(0);
    expect(state2.reviewState?.["f"]?.dueAt).toBeLessThanOrEqual(Date.now());
  });

  it("rustyLetters lists due letters weakest-first, hides not-yet-due ones", async () => {
    const fresh = await import("../../src/ts/utils/learn-stats");
    const perfect = Array.from({ length: 12 }, () => "fj");
    for (let i = 0; i < 5; i++) {
      fresh.registerDrillResult(perfect, perfect, "english");
    }
    //f/j: 120 samples at 100%, reviewed 2+ days out → not due
    expect(fresh.rustyLetters(8)).toHaveLength(0);
    //an error drill resets f/j to due-now
    const drill = Array.from({ length: 12 }, () => "fj");
    const sloppy = Array.from({ length: 12 }, () => "fx");
    fresh.registerDrillResult(drill, sloppy, "english");
    const list = fresh.rustyLetters(8);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]?.letter).toBe("x"); //0% accuracy sorts first
    expect(list.map((it) => it.letter)).toContain("j");
  });
});

describe("rowDrillsForLanguage (language-aware rows)", () => {
  it("returns QWERTY rows for english", () => {
    const drills = Learn.rowDrillsForLanguage("english");
    expect(drills).toHaveLength(6);
    expect(drills[1]?.letters).toBe("qwertyuiop");
  });

  it("returns Persian standard layout rows for persian", () => {
    const drills = Learn.rowDrillsForLanguage("persian");
    expect(drills).toHaveLength(6);
    const allLetters = drills.map((d) => d.letters).join("");
    //only Persian digits/letters, no latin, no urdu ڑ
    for (const ch of allLetters) {
      expect("۱۲۳۴۵۶۷۸۹۰اآبپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی").toContain(ch);
    }
  });

  it("persian hands cover every letter except آ exactly once", () => {
    const drills = Learn.rowDrillsForLanguage("persian");
    const hands = drills
      .filter((d) => d.label.includes("hand"))
      .map((d) => d.letters)
      .join("");
    const alphabet = [...("ا" + "بپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی")].sort();
    expect([...hands].sort()).toEqual(alphabet);
  });
});
