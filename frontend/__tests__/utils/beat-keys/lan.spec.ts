import { beforeEach, describe, expect, it } from "vitest";

import {
  beatLanChart,
  lanBeatKeys,
  resolveBeatVerdict,
  type BeatRemoteState,
} from "../../../src/ts/utils/beat-keys/lan";
import { BALANCE } from "../../../src/ts/utils/beat-keys/balance";
import {
  _resetLanRegistryForTests,
  getLanGame,
  getLanGames,
  registerLanGame,
} from "../../../src/ts/utils/games/lan-registry";

describe("beat-keys LanPlayable (online wave, phase 41 — pattern S)", () => {
  beforeEach(() => {
    _resetLanRegistryForTests();
    registerLanGame(lanBeatKeys);
  });

  it("is a registry member with the beat-keys route and card", () => {
    expect(getLanGames().map((game) => game.gameId)).toContain("beat-keys");
    const game = getLanGame("beat-keys");
    expect(game?.route).toBe("/games/beat-keys");
    expect(game?.label).toBe("beat keys");
    expect(game?.icon).toBe("fa-drum");
  });

  it("buildStart seeds the chart and carries lang + difficulty", () => {
    const start = lanBeatKeys.buildStart({ lang: "farsi", difficulty: "hard" });
    expect(start.gameId).toBe("beat-keys");
    expect(start.seed).toBeGreaterThanOrEqual(1);
    expect(start.seed).toBeLessThanOrEqual(2147483647);
    expect(start.params).toEqual({ lang: "farsi", difficulty: "hard" });
  });

  it("buildStart applies the documented defaults and clamps garbage", () => {
    expect(lanBeatKeys.buildStart({}).params).toEqual({
      lang: "english",
      difficulty: "normal",
    });
    expect(
      lanBeatKeys.buildStart({ difficulty: "lunatic" }).params["difficulty"],
    ).toBe("normal");
  });

  it("validateStart accepts a good start and rejects bad shapes", () => {
    const good = lanBeatKeys.buildStart({});
    expect(lanBeatKeys.validateStart(good)).toBe(true);
    expect(lanBeatKeys.validateStart({ ...good, seed: 0 })).toBe(false);
    expect(
      lanBeatKeys.validateStart({ ...good, params: { lang: "english" } }),
    ).toBe(false);
    expect(
      lanBeatKeys.validateStart({
        ...good,
        params: { lang: "english", difficulty: "lunatic" },
      }),
    ).toBe(false);
    expect(
      lanBeatKeys.validateStart({
        ...good,
        params: { lang: "", difficulty: "normal" },
      }),
    ).toBe(false);
  });

  it("the score verdict: the higher score wins, the exact parity is a draw", () => {
    expect(resolveBeatVerdict({ score: 600 }, { score: 450 })).toBe("won");
    expect(resolveBeatVerdict({ score: 450 }, { score: 600 })).toBe("lost");
    expect(resolveBeatVerdict({ score: 600 }, { score: 600 })).toBe("draw");
  });

  it("progress encoding coerces garbage to zeroes", () => {
    expect(
      lanBeatKeys.encodeProgress({ score: 450, acc: 96.4, maxCombo: 12 }),
    ).toEqual({ score: 450, acc: 96, maxCombo: 12 });
    expect(lanBeatKeys.encodeProgress({ score: "many" })).toEqual({
      score: 0,
      acc: 0,
      maxCombo: 0,
    });
  });

  it("progress decoding trusts only well-formed states", () => {
    const state: BeatRemoteState = { score: 630, acc: 91, maxCombo: 8 };
    expect(
      lanBeatKeys.decodeProgress({ score: 630, acc: 91, maxCombo: 8 }),
    ).toEqual(state);
    expect(lanBeatKeys.decodeProgress({ score: 630, acc: 91 })).toBeUndefined();
    expect(
      lanBeatKeys.decodeProgress({ score: -1, acc: 0, maxCombo: 0 }),
    ).toBeUndefined();
    expect(
      lanBeatKeys.decodeProgress({ score: 4, acc: 50, maxCombo: "high" }),
    ).toBeUndefined();
    expect(lanBeatKeys.decodeProgress("garbage")).toBeUndefined();
  });

  it("the seeded chart is deterministic per seed and difficulty", () => {
    const a = beatLanChart(41, "normal");
    const b = beatLanChart(41, "normal");
    //same seed + difficulty -> the identical notes (the shared chart)
    expect(a.notes).toEqual(b.notes);
    expect(a.bpm).toBe(b.bpm);
    //the difficulty's BPM carries (doc §۰.۳)
    expect(beatLanChart(41, "easy").bpm).toBe(BALANCE.bpmByDifficulty.easy);
    expect(beatLanChart(41, "hard").bpm).toBe(BALANCE.bpmByDifficulty.hard);
    //a different seed reshuffles the lane patterns
    const c = beatLanChart(42, "normal");
    expect(
      a.notes.some(
        (note, i) =>
          note.lane !== c.notes[i]?.lane || note.key !== c.notes[i]?.key,
      ),
    ).toBe(true);
    //every note rides the four lanes and the lane keys
    for (const note of a.notes) {
      expect(BALANCE.laneKeys).toContain(note.key);
      expect(note.lane).toBe(
        (BALANCE.laneKeys as readonly string[]).indexOf(note.key),
      );
      expect(note.tMs).toBeGreaterThanOrEqual(BALANCE.leadInBeats * a.beatMs);
    }
  });

  it("the chart's length is the shared clock: notes cover the duration", () => {
    const chart = beatLanChart(41, "normal");
    expect(chart.durationBeats).toBe(BALANCE.durationBeats);
    //notes exist (an all-rest chart would stall both machines)
    expect(chart.notes.length).toBeGreaterThan(0);
    //no two same-key notes inside the judge window (the doc guarantee)
    const byKey = new Map<string, number>();
    for (const note of chart.notes) {
      const last = byKey.get(note.key);
      if (last !== undefined) {
        expect(note.tMs - last).toBeGreaterThanOrEqual(BALANCE.windowPoorMs);
      }
      byKey.set(note.key, note.tMs);
    }
  });
});
