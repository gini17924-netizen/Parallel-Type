import { beforeEach, describe, expect, it } from "vitest";

import {
  lanStrike,
  resolveStrikeVerdict,
  strikeLanSpawner,
  type StrikeRemoteState,
} from "../../../src/ts/utils/letter-strike/lan";
import {
  _resetLanRegistryForTests,
  getLanGame,
  getLanGames,
  registerLanGame,
} from "../../../src/ts/utils/games/lan-registry";

describe("letter-strike LanPlayable (online wave, phase 31 — pattern S)", () => {
  beforeEach(() => {
    _resetLanRegistryForTests();
    registerLanGame(lanStrike);
  });

  it("is a registry member with the letter-strike route and card", () => {
    expect(getLanGames().map((game) => game.gameId)).toContain("letter-strike");
    const game = getLanGame("letter-strike");
    expect(game?.route).toBe("/games/letter-strike");
    expect(game?.label).toBe("letter strike");
    expect(game?.icon).toBe("fa-rocket");
  });

  it("buildStart seeds the death race and carries lang", () => {
    const start = lanStrike.buildStart({ lang: "farsi" });
    expect(start.gameId).toBe("letter-strike");
    expect(start.seed).toBeGreaterThanOrEqual(1);
    expect(start.seed).toBeLessThanOrEqual(2147483647);
    expect(start.params).toEqual({ lang: "farsi" });
  });

  it("buildStart applies the documented default language", () => {
    expect(lanStrike.buildStart({}).params).toEqual({ lang: "english" });
  });

  it("validateStart accepts a good start and rejects bad shapes", () => {
    const good = lanStrike.buildStart({});
    expect(lanStrike.validateStart(good)).toBe(true);
    expect(lanStrike.validateStart({ ...good, seed: 0 })).toBe(false);
    expect(lanStrike.validateStart({ ...good, params: { lang: "" } })).toBe(
      false,
    );
    expect(lanStrike.validateStart({ ...good, params: {} })).toBe(false);
    expect(lanStrike.validateStart({ ...good, params: { lang: 42 } })).toBe(
      false,
    );
  });

  it("the death-race verdict: the higher score wins, the longer survival breaks the tie", () => {
    const mine = { score: 1200, elapsedMs: 90_000 };
    expect(resolveStrikeVerdict(mine, { score: 900, elapsedMs: 60_000 })).toBe(
      "won",
    );
    expect(resolveStrikeVerdict(mine, { score: 1500, elapsedMs: 60_000 })).toBe(
      "lost",
    );
    //equal score: standing longer means the better run
    expect(
      resolveStrikeVerdict(mine, { score: 1200, elapsedMs: 120_000 }),
    ).toBe("lost");
    expect(resolveStrikeVerdict(mine, { score: 1200, elapsedMs: 60_000 })).toBe(
      "won",
    );
    expect(resolveStrikeVerdict(mine, { score: 1200, elapsedMs: 90_000 })).toBe(
      "draw",
    );
  });

  it("progress encoding coerces garbage to zeroes", () => {
    expect(lanStrike.encodeProgress({ score: 450, lives: 2 })).toEqual({
      score: 450,
      lives: 2,
    });
    expect(lanStrike.encodeProgress({ score: "many" })).toEqual({
      score: 0,
      lives: 0,
    });
  });

  it("progress decoding trusts only well-formed states", () => {
    const state: StrikeRemoteState = { score: 630, lives: 1 };
    expect(lanStrike.decodeProgress({ score: 630, lives: 1 })).toEqual(state);
    expect(lanStrike.decodeProgress({ score: 630 })).toBeUndefined();
    expect(lanStrike.decodeProgress({ score: -1, lives: 0 })).toBeUndefined();
    expect(
      lanStrike.decodeProgress({ score: 4, lives: "none" }),
    ).toBeUndefined();
    expect(lanStrike.decodeProgress("garbage")).toBeUndefined();
  });

  it("the seeded spawner builds the identical waves on both machines", () => {
    const pool = [
      "ship",
      "wave",
      "cannon",
      "fleet",
      "anchor",
      "hull",
      "radar",
      "marine",
      "vessel",
      "torpedo",
      "broadside",
      "administer",
    ];
    const spawnerA = strikeLanSpawner(pool, 31);
    const spawnerB = strikeLanSpawner(pool, 31);
    //same seed -> the identical ships, speeds and bosses, wave after wave
    for (const wave of [1, 2, 4, 9]) {
      expect(spawnerA.spawnWave(wave)).toEqual(spawnerB.spawnWave(wave));
    }
    //a different seed reshuffles (nine picks across two waves)
    const spawnerC = strikeLanSpawner(pool, 32);
    const wordsA = [...spawnerA.spawnWave(1), ...spawnerA.spawnWave(2)].map(
      (spawn) => spawn.word,
    );
    const wordsC = [...spawnerC.spawnWave(1), ...spawnerC.spawnWave(2)].map(
      (spawn) => spawn.word,
    );
    expect(wordsA.some((word, i) => word !== wordsC[i])).toBe(true);
  });

  it("the seeded spawner keeps the wave cadence and the boss flag", () => {
    const pool = ["ship", "wave", "cannon", "administer"];
    const spawner = strikeLanSpawner(pool, 31);
    //the wave size steps 4 -> 5 ...
    expect(spawner.spawnWave(1)).toHaveLength(4);
    expect(spawner.spawnWave(2)).toHaveLength(5);
    //every 4th wave carries one boss (long word, slower)
    const bossWave = spawner.spawnWave(4);
    const bosses = bossWave.filter((spawn) => spawn.isBoss);
    expect(bosses).toHaveLength(1);
    expect(bosses[0]?.word).toBe("administer");
    //the regular waves carry no bosses
    expect(spawner.spawnWave(1).every((spawn) => !spawn.isBoss)).toBe(true);
  });
});
