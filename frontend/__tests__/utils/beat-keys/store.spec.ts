import { beforeEach, describe, expect, it } from "vitest";

import {
  BEAT_KEYS_SCORES_KEY,
  _resetBeatKeysForTests,
  getBeatBest,
  getBeatKeysHistory,
  getBeatOffsetMs,
  recordBeatKeysRun,
  sanitizeImportedBeatKeysScores,
  setBeatOffsetMs,
} from "../../../src/ts/utils/beat-keys/store";

describe("beat-keys store (idea G21 phase 1)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetBeatKeysForTests();
  });

  it("records the first run as the per-BPM best with history", () => {
    const result = recordBeatKeysRun({
      bpm: 100,
      score: 4200,
      acc: 96.5,
      rank: "S",
      maxCombo: 14,
      misses: 0,
    });
    expect(result.isNewRecord).toBe(true);
    expect(getBeatBest(100)?.score).toBe(4200);
    expect(getBeatBest(70)).toBeUndefined(); //per-BPM isolation
    expect(getBeatKeysHistory()).toHaveLength(1);
  });

  it("keeps the best per bpm on a weaker run; history grows newest-first", () => {
    recordBeatKeysRun({
      bpm: 100,
      score: 5000,
      acc: 98,
      rank: "S",
      maxCombo: 16,
      misses: 0,
    });
    const weaker = recordBeatKeysRun({
      bpm: 100,
      score: 2100,
      acc: 80,
      rank: "B",
      maxCombo: 8,
      misses: 3,
    });
    expect(weaker.isNewRecord).toBe(false);
    expect(getBeatBest(100)?.score).toBe(5000);
    expect(getBeatKeysHistory()[0]?.score).toBe(2100);
  });

  it("the calibration offset defaults to 0 and clamps to +-300", () => {
    expect(getBeatOffsetMs()).toBe(0);
    setBeatOffsetMs(-120);
    expect(getBeatOffsetMs()).toBe(-120);
    setBeatOffsetMs(9999);
    expect(getBeatOffsetMs()).toBe(300);
    setBeatOffsetMs(-9999);
    expect(getBeatOffsetMs()).toBe(-300);
  });

  it("caps the history at the newest 10", () => {
    for (let i = 0; i < 12; i++) {
      recordBeatKeysRun({
        bpm: 100,
        score: 100 + i,
        acc: 50,
        rank: "C",
        maxCombo: i,
        misses: 5,
      });
    }
    const history = getBeatKeysHistory();
    expect(history).toHaveLength(10);
    expect(history[0]?.maxCombo).toBe(11);
    expect(getBeatBest(100)?.score).toBe(111);
  });

  it("the reset hook clears storage and cache", () => {
    recordBeatKeysRun({
      bpm: 70,
      score: 900,
      acc: 70,
      rank: "B",
      maxCombo: 5,
      misses: 2,
    });
    _resetBeatKeysForTests();
    expect(window.localStorage.getItem(BEAT_KEYS_SCORES_KEY)).toBeNull();
    expect(getBeatBest(70)).toBeUndefined();
  });

  it("sanitize drops garbage rows and clamps the offset (audit L4)", () => {
    const sanitized = sanitizeImportedBeatKeysScores({
      bestByBpm: {
        "100": { score: 4200, acc: 96.5, rank: "S", maxCombo: 14 },
        "666": { junk: true },
      },
      history: [
        {
          at: 10,
          bpm: 100,
          score: 80,
          acc: 55,
          rank: "C",
          maxCombo: 2,
          misses: 4,
        },
        { junk: true },
      ],
      settings: { offsetMs: "late" },
    });
    expect(Object.keys(sanitized.bestByBpm)).toEqual(["100"]);
    expect(sanitized.history).toHaveLength(1);
    expect(sanitized.settings.offsetMs).toBe(0);
    expect(sanitizeImportedBeatKeysScores(null)).toEqual({
      bestByBpm: {},
      history: [],
      settings: { offsetMs: 0 },
    });
  });
});
