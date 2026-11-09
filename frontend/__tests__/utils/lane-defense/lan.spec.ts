import { beforeEach, describe, expect, it } from "vitest";

import {
  lanLaneDefense,
  laneLanSpawner,
  resolveLaneVerdict,
  type LaneRemoteState,
} from "../../../src/ts/utils/lane-defense/lan";
import {
  _resetLanRegistryForTests,
  getLanGame,
  getLanGames,
  registerLanGame,
} from "../../../src/ts/utils/games/lan-registry";

describe("lane-defense LanPlayable (online wave, phase 33 — pattern S)", () => {
  beforeEach(() => {
    _resetLanRegistryForTests();
    registerLanGame(lanLaneDefense);
  });

  it("is a registry member with the lane-defense route and card", () => {
    expect(getLanGames().map((game) => game.gameId)).toContain("lane-defense");
    const game = getLanGame("lane-defense");
    expect(game?.route).toBe("/games/lane-defense");
    expect(game?.label).toBe("lane defense");
    expect(game?.icon).toBe("fa-shield-alt");
  });

  it("buildStart seeds the death race and carries lang", () => {
    const start = lanLaneDefense.buildStart({ lang: "farsi" });
    expect(start.gameId).toBe("lane-defense");
    expect(start.seed).toBeGreaterThanOrEqual(1);
    expect(start.seed).toBeLessThanOrEqual(2147483647);
    expect(start.params).toEqual({ lang: "farsi" });
  });

  it("buildStart applies the documented default language", () => {
    expect(lanLaneDefense.buildStart({}).params).toEqual({
      lang: "english",
    });
  });

  it("validateStart accepts a good start and rejects bad shapes", () => {
    const good = lanLaneDefense.buildStart({});
    expect(lanLaneDefense.validateStart(good)).toBe(true);
    expect(lanLaneDefense.validateStart({ ...good, seed: 0 })).toBe(false);
    expect(
      lanLaneDefense.validateStart({ ...good, params: { lang: "" } }),
    ).toBe(false);
    expect(lanLaneDefense.validateStart({ ...good, params: {} })).toBe(false);
    expect(
      lanLaneDefense.validateStart({ ...good, params: { lang: 42 } }),
    ).toBe(false);
  });

  it("the death-race verdict: the higher score wins, the longer survival breaks the tie", () => {
    const mine = { score: 1500, elapsedMs: 90_000 };
    expect(resolveLaneVerdict(mine, { score: 1200, elapsedMs: 60_000 })).toBe(
      "won",
    );
    expect(resolveLaneVerdict(mine, { score: 1800, elapsedMs: 60_000 })).toBe(
      "lost",
    );
    //equal score: standing longer means the better run
    expect(resolveLaneVerdict(mine, { score: 1500, elapsedMs: 120_000 })).toBe(
      "lost",
    );
    expect(resolveLaneVerdict(mine, { score: 1500, elapsedMs: 60_000 })).toBe(
      "won",
    );
    expect(resolveLaneVerdict(mine, { score: 1500, elapsedMs: 90_000 })).toBe(
      "draw",
    );
  });

  it("progress encoding coerces garbage to zeroes", () => {
    expect(lanLaneDefense.encodeProgress({ score: 450, wallHp: 7 })).toEqual({
      score: 450,
      wallHp: 7,
    });
    expect(lanLaneDefense.encodeProgress({ score: "many" })).toEqual({
      score: 0,
      wallHp: 0,
    });
  });

  it("progress decoding trusts only well-formed states", () => {
    const state: LaneRemoteState = { score: 630, wallHp: 4 };
    expect(lanLaneDefense.decodeProgress({ score: 630, wallHp: 4 })).toEqual(
      state,
    );
    expect(lanLaneDefense.decodeProgress({ score: 630 })).toBeUndefined();
    expect(
      lanLaneDefense.decodeProgress({ score: -1, wallHp: 0 }),
    ).toBeUndefined();
    expect(
      lanLaneDefense.decodeProgress({ score: 4, wallHp: "gone" }),
    ).toBeUndefined();
    expect(lanLaneDefense.decodeProgress("garbage")).toBeUndefined();
  });

  it("the seeded spawner builds the identical waves on both machines", () => {
    const pool = [
      "wall",
      "lane",
      "guard",
      "shield",
      "rampart",
      "defense",
      "spear",
      "march",
      "troop",
      "vanguard",
      "bastion",
      "fortify",
    ];
    const spawnerA = laneLanSpawner(pool, 33);
    const spawnerB = laneLanSpawner(pool, 33);
    //same seed -> the identical words, speeds, lanes and tanks, wave
    //after wave
    for (const wave of [1, 2, 3, 6]) {
      expect(spawnerA.spawnWave(wave)).toEqual(spawnerB.spawnWave(wave));
    }
    //a different seed reshuffles (nine picks across two waves)
    const spawnerC = laneLanSpawner(pool, 34);
    const wordsA = [...spawnerA.spawnWave(1), ...spawnerA.spawnWave(2)].map(
      (spawn) => spawn.word,
    );
    const wordsC = [...spawnerC.spawnWave(1), ...spawnerC.spawnWave(2)].map(
      (spawn) => spawn.word,
    );
    expect(wordsA.some((word, i) => word !== wordsC[i])).toBe(true);
  });

  it("the seeded spawner keeps the wave cadence, lanes and tanks", () => {
    const pool = [
      "wall",
      "lane",
      "guard",
      "shield",
      "rampart",
      "defense",
      "spear",
      "march",
    ];
    const spawner = laneLanSpawner(pool, 33);
    //the wave size steps 5 -> 6 ...
    expect(spawner.spawnWave(1)).toHaveLength(5);
    expect(spawner.spawnWave(2)).toHaveLength(6);
    //lanes stay within the five lanes
    for (const spawn of [...spawner.spawnWave(1), ...spawner.spawnWave(3)]) {
      expect(spawn.lane).toBeGreaterThanOrEqual(0);
      expect(spawn.lane).toBeLessThan(5);
    }
    //every 3rd wave carries one tank
    const tanks = spawner.spawnWave(3).filter((spawn) => spawn.isTank);
    expect(tanks).toHaveLength(1);
    //the regular waves carry no tanks
    expect(spawner.spawnWave(1).every((spawn) => !spawn.isTank)).toBe(true);
  });
});
