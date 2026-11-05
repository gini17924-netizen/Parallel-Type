import { describe, it, expect, beforeEach } from "vitest";

import {
  _setWeakLettersSeedForTests,
  pickWord,
} from "../../src/ts/utils/weak-letters-funbox";
import type { Wordset } from "../../src/ts/test/wordset";

function fakeWordset(words: string[]): Wordset {
  return { words, length: words.length } as unknown as Wordset;
}

function seedWeaknessStorage(): void {
  //ف: gated weak letter (30% acc, 10 samples); ا: gated strong (90%)
  window.localStorage.setItem(
    "mtDesktopLearnState",
    JSON.stringify({
      unlockedGroups: 2,
      keyStats: {
        ف: { correct: 3, incorrect: 7 },
        ا: { correct: 9, incorrect: 1 },
      },
      reviewState: {},
    }),
  );
}

describe("weak_letters funbox sampler (idea #8)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns empty for an undefined wordset (weakspot parity)", () => {
    _setWeakLettersSeedForTests(1);
    expect(pickWord(undefined)).toBe("");
  });

  it("pass-through when the weakness map is empty (fresh user)", () => {
    _setWeakLettersSeedForTests(2);
    const wordset = fakeWordset(["one", "two", "three"]);
    const words = Array.from({ length: 10 }, () => pickWord(wordset));
    expect(words.every((w) => ["one", "two", "three"].includes(w))).toBe(true);
  });

  it("argmax picks weak-letter words over strong-letter words", () => {
    seedWeaknessStorage();
    _setWeakLettersSeedForTests(123);
    const wordset = fakeWordset(["فب", "اث"]); //ف weak, ا strong
    const words = Array.from({ length: 20 }, () => pickWord(wordset));
    const فCount = words.filter((w) => w === "فب").length;
    const اCount = words.filter((w) => w === "اث").length;
    expect(فCount + اCount).toBe(20);
    //argmax over 20 samples: the weak word wins essentially every slot
    expect(فCount).toBeGreaterThan(15);
  });

  it("same seed and storage produce the same word sequence", () => {
    seedWeaknessStorage();
    _setWeakLettersSeedForTests(777);
    const wordset = fakeWordset(["فب", "اث", "بم"]);
    const first = Array.from({ length: 10 }, () => pickWord(wordset));
    _setWeakLettersSeedForTests(777);
    const second = Array.from({ length: 10 }, () => pickWord(wordset));
    expect(first).toEqual(second);
  });

  it("reseeding drops the weakness cache: fresh storage is honored", () => {
    _setWeakLettersSeedForTests(5);
    const wordset = fakeWordset(["فب", "اث"]);
    pickWord(wordset); //cache built with EMPTY storage
    seedWeaknessStorage(); //evidence appears afterwards
    _setWeakLettersSeedForTests(5); //reset clears the cache too
    const words = Array.from({ length: 10 }, () => pickWord(wordset));
    //with evidence, the weak word now dominates instead of pass-through
    const فCount = words.filter((w) => w === "فب").length;
    expect(فCount).toBeGreaterThan(5);
  });
});
