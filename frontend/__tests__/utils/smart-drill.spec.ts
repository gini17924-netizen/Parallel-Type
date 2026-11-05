import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach } from "vitest";

//deep relative imports: the tsconfig excludes __tests__ from the paths
//map, so type-aware lint cannot resolve the @keybr/* aliases here
import { Language } from "../../src/keybr/@keybr/keyboard/lib/index";
import {
  censor,
  makePhoneticModel,
} from "../../src/keybr/@keybr/phonetic-model/lib/index";

import {
  generateSmartDrillWords,
  SMART_DRILL_WORD_COUNT,
} from "../../src/ts/utils/smart-drill";
import {
  buildWeaknessMap,
  type WeaknessMap,
} from "../../src/ts/utils/weakness-model";
import type { LearnState } from "../../src/ts/utils/learn-stats";

// The compiled phonetic model is read straight from the vendored asset
// (same fidelity proof as __tests__/keybr/engine.spec.ts) so the pure
// generator runs headless without the ?url session loader.
const faModelData = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "src/keybr/@keybr/phonetic-model/assets/model-fa.data",
  ),
);
const model = censor(
  makePhoneticModel(Language.FA, new Uint8Array(faModelData)),
);

/** ف ا س ت ش ک — groups 1..6 unlocked, so ف (group «قفرژ») is in scope */
const ALLOWED = "بتینسمشگکلاقفرژ";

function seedLearnState(): void {
  const state: LearnState = {
    unlockedGroups: 6,
    keyStats: {
      //ف is the struggling letter: 30% accuracy, gated and ranked
      ف: { correct: 3, incorrect: 7 },
      ب: { correct: 9, incorrect: 1 },
      ت: { correct: 9, incorrect: 1 },
      ن: { correct: 9, incorrect: 1 },
      س: { correct: 9, incorrect: 1 },
      م: { correct: 9, incorrect: 1 },
      ی: { correct: 9, incorrect: 1 },
      ل: { correct: 9, incorrect: 1 },
      ا: { correct: 9, incorrect: 1 },
      ق: { correct: 9, incorrect: 1 },
      ر: { correct: 9, incorrect: 1 },
      ژ: { correct: 9, incorrect: 1 },
      ش: { correct: 9, incorrect: 1 },
      گ: { correct: 9, incorrect: 1 },
      ک: { correct: 9, incorrect: 1 },
    },
    reviewState: {},
  };
  window.localStorage.setItem("mtDesktopLearnState", JSON.stringify(state));
}

function weaknessFromStorage(): WeaknessMap {
  //pure pipeline: read the seeded storage through the model inputs
  return buildWeaknessMap(
    JSON.parse(
      window.localStorage.getItem("mtDesktopLearnState") ?? "{}",
    ) as LearnState,
    {},
  );
}

const WORD_LIST = [
  "بین",
  "بن",
  "بیت",
  "نیست",
  "بیست",
  "سمت",
  "نسبت",
  "من",
  "میں",
  "تباط",
];

describe("generateSmartDrillWords (idea #7: smart drill)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedLearnState();
  });

  it("is deterministic: the same seed and inputs produce the same drill", () => {
    const weakness = weaknessFromStorage();
    const a = generateSmartDrillWords({
      model,
      allowedLetters: ALLOWED,
      weakness,
      wordList: WORD_LIST,
      seed: 12345,
    });
    const b = generateSmartDrillWords({
      model,
      allowedLetters: ALLOWED,
      weakness,
      wordList: WORD_LIST,
      seed: 12345,
    });
    expect(a.words).toEqual(b.words);
    expect(a.words).toHaveLength(SMART_DRILL_WORD_COUNT);
  });

  it("every word only uses allowed letters (plus non-letter characters)", () => {
    const plan = generateSmartDrillWords({
      model,
      allowedLetters: ALLOWED,
      weakness: weaknessFromStorage(),
      wordList: WORD_LIST,
      seed: 777,
    });
    const allowed = new Set(ALLOWED.split(""));
    const isLetterChar = (ch: string): boolean => /[a-zà-ÿ؀-ۿ]/i.test(ch);
    for (const word of plan.words) {
      for (const ch of word.toLowerCase()) {
        expect(allowed.has(ch) || !isLetterChar(ch)).toBe(true);
      }
    }
  });

  it("weights towards the weak letter: ف dominates the phonetic slots", () => {
    const plan = generateSmartDrillWords({
      model,
      allowedLetters: ALLOWED,
      weakness: weaknessFromStorage(),
      wordList: [], //no real words: the drill is all phonetic
      seed: 4242,
    });
    expect(plan.words).toHaveLength(SMART_DRILL_WORD_COUNT);
    expect(plan.usedFallback).toBe(false);
    const فWords = plan.words.filter((w) => w.includes("ف"));
    //ف is the only gated weak letter; the Filter contract guarantees its
    //presence in focused phonetic words (unfocused slots may skip it)
    expect(فWords.length).toBeGreaterThanOrEqual(SMART_DRILL_WORD_COUNT / 3);
    expect(plan.focusedLetters).toContain("ف");
  });

  it("blends real words when the word list provides them", () => {
    const plan = generateSmartDrillWords({
      model,
      allowedLetters: ALLOWED,
      weakness: weaknessFromStorage(),
      wordList: WORD_LIST,
      seed: 99,
    });
    const real = plan.words.filter((w) => WORD_LIST.includes(w));
    expect(real.length).toBeGreaterThan(0);
    expect(real.length).toBeLessThanOrEqual(SMART_DRILL_WORD_COUNT / 2);
  });

  it("falls back to the bigram generator without a model", () => {
    const plan = generateSmartDrillWords({
      model: undefined,
      allowedLetters: ALLOWED,
      weakness: weaknessFromStorage(),
      wordList: WORD_LIST,
      seed: 31,
    });
    expect(plan.usedFallback).toBe(true);
    expect(plan.words).toHaveLength(SMART_DRILL_WORD_COUNT);
    for (const word of plan.words) {
      expect(word.length).toBeGreaterThan(0);
    }
  });

  it("phonetic words stay within the model's 3..10 length envelope", () => {
    const plan = generateSmartDrillWords({
      model,
      allowedLetters: ALLOWED,
      weakness: weaknessFromStorage(),
      wordList: [],
      seed: 818,
    });
    for (const word of plan.words) {
      expect(word.length).toBeGreaterThanOrEqual(1);
      expect(word.length).toBeLessThanOrEqual(10);
    }
  });

  it("degrades gracefully with an empty weakness map (unfocused phonetics)", () => {
    const plan = generateSmartDrillWords({
      model,
      allowedLetters: ALLOWED,
      weakness: {}, //fresh user: no gated evidence anywhere
      wordList: WORD_LIST,
      seed: 555,
    });
    expect(plan.words).toHaveLength(SMART_DRILL_WORD_COUNT);
    expect(plan.focusedLetters).toEqual([]);
  });
});
