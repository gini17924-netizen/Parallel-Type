import { describe, it, expect, beforeEach } from "vitest";

import {
  buildWeaknessMap,
  MIN_SAMPLES_PER_SOURCE,
} from "../../src/ts/utils/weakness-model";
import { getLearnState, type LearnState } from "../../src/ts/utils/learn-stats";
import { loadKeybrLetterStats } from "../../src/ts/utils/keybr-letter-stats";

/** ف U+0641, ا U+0627, س U+0633, ت U+062A */
const FA_F = 0x0641;
const FA_ALEF = 0x0627;
const FA_SEEN = 0x0633;
const FA_TEH = 0x062a;

function seedDrillStats(
  keyStats: Record<string, { correct: number; incorrect: number }>,
): void {
  const state: LearnState = {
    unlockedGroups: 3,
    keyStats,
    reviewState: {},
  };
  window.localStorage.setItem("mtDesktopLearnState", JSON.stringify(state));
}

function seedKeybr(
  histogram: {
    codePoint: number;
    hitCount: number;
    missCount: number;
    timeToType?: number;
  }[],
  lang = "fa",
): void {
  window.localStorage.setItem(
    `mtKeybrResults:${lang}`,
    JSON.stringify(
      histogram.map((sample) => ({
        timeStamp: 1,
        length: 10,
        time: 5,
        errors: 1,
        histogram: [sample],
      })),
    ),
  );
}

describe("buildWeaknessMap (idea #7: unified weakness model)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("gates per source: a letter below MIN_SAMPLES_PER_SOURCE never enters", () => {
    seedDrillStats({
      //just under the gate
      ف: { correct: 3, incorrect: MIN_SAMPLES_PER_SOURCE - 4 },
      //just above
      ا: { correct: 4, incorrect: 1 },
    });
    const map = buildWeaknessMap(getLearnState(), loadKeybrLetterStats());
    expect(map["ف"]).toBeUndefined();
    expect(map["ا"]).toBeDefined();
  });

  it("keeps the display accuracy RAW (compat contract of weakLetters)", () => {
    seedKeybr([{ codePoint: FA_F, hitCount: 3, missCount: 7 }]);
    const map = buildWeaknessMap(getLearnState(), loadKeybrLetterStats());
    expect(map["ف"]?.acc).toBe(0.3); //raw, not smoothed
    expect(map["ف"]?.total).toBe(10);
    expect(map["ف"]?.evidence).toEqual([{ source: "keybr", n: 10 }]);
  });

  it("rank-normalizes per source: a char weak in drills but strong in keybr lands mid-pack", () => {
    seedDrillStats({
      //ف: terrible in drills (0%), ت: perfect (100%)
      ف: { correct: 0, incorrect: 20 },
      ت: { correct: 20, incorrect: 0 },
    });
    seedKeybr([
      //ف: excellent in keybr (100% fast), ت: terrible (0% slow)
      { codePoint: FA_F, hitCount: 15, missCount: 0, timeToType: 100 },
      { codePoint: FA_TEH, hitCount: 0, missCount: 15, timeToType: 900 },
    ]);
    const map = buildWeaknessMap(getLearnState(), loadKeybrLetterStats());
    const ف = map["ف"];
    const ت = map["ت"];
    expect(ف).toBeDefined();
    expect(ت).toBeDefined();
    //two sources, opposite verdicts: equal-vote mean puts both mid-pack
    expect(ف?.score).toBeGreaterThan(0);
    expect(ف?.score).toBeLessThan(1);
    expect(ت?.score).toBeGreaterThan(0);
    expect(ت?.score).toBeLessThan(1);
    //and they land close together (evidence conflicts, model is humble)
    expect(Math.abs((ف?.score ?? 0) - (ت?.score ?? 0))).toBeLessThan(0.3);
  });

  it("cannot be flooded: sample counts never weight the merge", () => {
    //ا: the worst char of a SMALL drill history (10 samples)
    seedDrillStats({
      ا: { correct: 0, incorrect: 10 },
      ت: { correct: 10, incorrect: 0 },
    });
    //ف: a MEDIOCRE char of a MASSIVE keybr history (1000 samples) — and س,
    //a genuinely weaker char in the same source, ranks above it
    seedKeybr([
      { codePoint: FA_F, hitCount: 600, missCount: 400, timeToType: 300 },
      { codePoint: FA_SEEN, hitCount: 200, missCount: 800, timeToType: 300 },
    ]);
    const map = buildWeaknessMap(getLearnState(), loadKeybrLetterStats());
    const ا = map["ا"];
    const ف = map["ف"];
    expect(ا).toBeDefined();
    expect(ف).toBeDefined();
    expect(ا?.total).toBe(10);
    expect(ف?.total).toBe(1000); //the flood is real in the evidence
    //each source is one vote: ا (rank 1 of its source) outranks ف
    //(rank 0 of its source) despite the 100:1 sample difference
    expect((ا?.score ?? 0) - (ف?.score ?? 0)).toBeGreaterThan(0.4);
  });

  it("slows weak: same accuracy but slower latency ranks higher in keybr", () => {
    seedKeybr([
      { codePoint: FA_F, hitCount: 8, missCount: 2, timeToType: 120 },
      { codePoint: FA_ALEF, hitCount: 8, missCount: 2, timeToType: 600 },
      { codePoint: FA_SEEN, hitCount: 8, missCount: 2, timeToType: 350 },
    ]);
    const map = buildWeaknessMap(getLearnState(), loadKeybrLetterStats());
    const ف = map["ف"];
    const ا = map["ا"];
    const س = map["س"];
    //identical accuracy — latency decides the order
    expect(ا?.score ?? 0).toBeGreaterThan(ف?.score ?? 0);
    expect(ف?.score ?? 0).toBeLessThan(س?.score ?? 0);
    expect(ا?.score ?? 0).toBeGreaterThan(س?.score ?? 0);
  });

  it("combines raw accuracy across gated sources for the display field", () => {
    seedDrillStats({ ف: { correct: 8, incorrect: 2 } });
    seedKeybr([
      { codePoint: FA_F, hitCount: 20, missCount: 0, timeToType: 100 },
    ]);
    const map = buildWeaknessMap(getLearnState(), loadKeybrLetterStats());
    //(8+20)/(10+20) = 28/30 — raw, across both gated sources
    expect(map["ف"]?.acc).toBeCloseTo(28 / 30, 6);
    expect(map["ف"]?.total).toBe(30);
    expect(map["ف"]?.evidence).toEqual([
      { source: "drill", n: 10 },
      { source: "keybr", n: 20 },
    ]);
  });

  it("returns an empty map when no source has enough evidence", () => {
    seedDrillStats({ ف: { correct: 1, incorrect: 1 } });
    expect(buildWeaknessMap(getLearnState(), loadKeybrLetterStats())).toEqual(
      {},
    );
  });
});
