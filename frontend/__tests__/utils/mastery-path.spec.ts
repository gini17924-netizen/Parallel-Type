import { describe, expect, it } from "vitest";

import {
  DEFAULT_MASTERY_CRITERION,
  evaluateUnlock,
  keyMastery,
  masteryPathForLanguage,
  PERSIAN_GROUPS,
  type KeyStat,
  type LearnState,
} from "../../src/ts/utils/learn-stats";
import type { KeybrLetterStat } from "../../src/ts/utils/keybr-letter-stats";

function keyStat(correct: number, incorrect: number): KeyStat {
  return { correct, incorrect };
}

function keybrStat(
  correct: number,
  incorrect: number,
  totalMs: number,
): KeybrLetterStat {
  return { correct, incorrect, totalTimeToType: totalMs };
}

function state(
  unlockedGroups: number,
  keyStats: Record<string, KeyStat>,
): LearnState {
  return { unlockedGroups, keyStats };
}

const PERSIAN = "persian";
/** the first persian group's letters (بت) */
const GROUP1 = PERSIAN_GROUPS[0] as string;
const GROUP2 = PERSIAN_GROUPS[1] as string;

describe("phase 70 — the per-key mastery criterion", () => {
  it("masters on accuracy alone when no keybr speed evidence exists", () => {
    //20 samples, 95%+ accuracy
    const mastery = keyMastery("ب", keyStat(19, 1), undefined);
    expect(mastery.samples).toBe(20);
    expect(mastery.accuracy).toBe(0.95);
    expect(mastery.meanMsPerChar).toBeUndefined();
    expect(mastery.mastered).toBe(true);
    //just below the sample floor
    expect(keyMastery("ب", keyStat(18, 1), undefined).mastered).toBe(false);
    //just below the accuracy bar (2/20 wrong = 90%)
    expect(keyMastery("ب", keyStat(18, 2), undefined).mastered).toBe(false);
    //nothing typed at all
    expect(keyMastery("ب", undefined, undefined).mastered).toBe(false);
  });

  it("the speed gate blocks a slow key that has keybr timing", () => {
    //accurate by the learn state, but keybr says 1000ms/char (> 800)
    const slow = keyMastery(
      "ب",
      keyStat(19, 1),
      keybrStat(10, 0, 10_000),
    );
    expect(slow.meanMsPerChar).toBe(1000);
    expect(slow.mastered).toBe(false);
    //fast evidence (400ms/char) passes
    const fast = keyMastery("ب", keyStat(19, 1), keybrStat(10, 0, 4_000));
    expect(fast.meanMsPerChar).toBe(400);
    expect(fast.mastered).toBe(true);
  });

  it("hits from keybr alone without timing do not fake speed evidence", () => {
    //hitCount present but the legacy row carries no timeToType
    const mastery = keyMastery("ب", keyStat(19, 1), keybrStat(10, 0, 0));
    expect(mastery.meanMsPerChar).toBeUndefined();
    expect(mastery.mastered).toBe(true);
  });

  it("the criterion is injectable", () => {
    const relaxed = { minSamples: 5, minAccuracy: 0.8, maxMeanMsPerChar: 2000 };
    expect(
      keyMastery("ب", keyStat(5, 1), keybrStat(2, 0, 3_000), relaxed).mastered,
    ).toBe(true);
    expect(
      keyMastery(
        "ب",
        keyStat(5, 1),
        keybrStat(2, 0, 3_000),
        DEFAULT_MASTERY_CRITERION,
      ).mastered,
    ).toBe(false);
  });
});

describe("phase 70 — the mastery path", () => {
  it("chains mastered → current → locked", () => {
    const learn = state(3, {});
    const path = masteryPathForLanguage(learn, {}, PERSIAN);
    expect(path).toHaveLength(PERSIAN_GROUPS.length);
    expect(path[0]?.status).toBe("mastered");
    expect(path[1]?.status).toBe("mastered");
    expect(path[2]?.status).toBe("current");
    expect(path[3]?.status).toBe("locked");
    //locked keys are never mastered by definition
    for (const group of path.slice(3)) {
      for (const key of group.keys) {
        expect(key.mastered).toBe(false);
      }
    }
  });

  it("shows per-key evidence inside the current group", () => {
    const first = GROUP1.split("");
    const keyStats: Record<string, KeyStat> = {
      [first[0] as string]: keyStat(19, 1), //mastered
      [first[1] as string]: keyStat(5, 3), //in progress
    };
    const path = masteryPathForLanguage(state(1, keyStats), {}, PERSIAN);
    const current = path[0] as (typeof path)[number];
    expect(current.status).toBe("current");
    expect(current.keys[0]?.mastered).toBe(true);
    expect(current.keys[1]?.mastered).toBe(false);
  });
});

describe("phase 70 — the unlock gate enforces speed when evidence exists", () => {
  it("a slow current group does not unlock the next one", () => {
    const keyStats: Record<string, KeyStat> = {};
    for (const letter of GROUP1.split("")) {
      keyStats[letter] = keyStat(19, 1); //accurate
    }
    //keybr timing says every letter is slow (1000ms/char)
    const keybr: Record<string, KeybrLetterStat> = {};
    for (const letter of GROUP1.split("")) {
      keybr[letter] = keybrStat(10, 0, 10_000);
    }
    expect(evaluateUnlock(state(1, keyStats), PERSIAN, keybr)).toBe(1);
    //same state without keybr evidence unlocks on accuracy alone
    expect(evaluateUnlock(state(1, keyStats), PERSIAN, {})).toBe(2);
  });

  it("a fast current group unlocks the next one", () => {
    const keyStats: Record<string, KeyStat> = {};
    for (const letter of GROUP1.split("")) {
      keyStats[letter] = keyStat(19, 1);
    }
    const keybr: Record<string, KeybrLetterStat> = {};
    for (const letter of GROUP1.split("")) {
      keybr[letter] = keybrStat(10, 0, 4_000);
    }
    expect(evaluateUnlock(state(1, keyStats), PERSIAN, keybr)).toBe(2);
  });

  it("an empty second group letter keeps the chain strict", () => {
    //group 2 unlocked but its letters never typed: no further unlock
    const keyStats: Record<string, KeyStat> = {};
    for (const letter of GROUP2.split("")) {
      keyStats[letter] = keyStat(0, 0);
    }
    expect(evaluateUnlock(state(2, keyStats), PERSIAN, {})).toBe(2);
  });
});
