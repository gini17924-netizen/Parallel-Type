import { describe, expect, it } from "vitest";

import { createTowerDefenseEngine } from "../../src/ts/utils/tower-defense/engine";
import {
  BALANCE,
  waveEnemyCount,
} from "../../src/ts/utils/tower-defense/balance";
import { createTowerWaveSpawner } from "../../src/ts/utils/tower-defense/spawner";
import { createSeededRng } from "../../src/ts/utils/daily-gauntlet/seeded-rng";
import {
  resolveTowerVerdict,
  towerLanSpawner,
} from "../../src/ts/utils/tower-defense/lan";

const POOL = [
  "cat",
  "house",
  "keyboard",
  "typewriter",
  "rooster",
  "anchor",
  "moonlight",
  "riveting",
  "defender",
  "stronghold",
];

function typeWord(
  engine: ReturnType<typeof createTowerDefenseEngine>,
): number {
  //types the targeted enemy's full word; returns the kills delta
  const before = engine.state().kills;
  const enemy = engine
    .state()
    .enemies.find((e) => e.typed > 0) ??
    engine.state().enemies.reduce(
      (best, e) => (best === undefined || e.y > best.y ? e : best),
      undefined,
    );
  if (enemy === undefined) return before;
  for (const ch of enemy.word) engine.feedKey(ch);
  return engine.state().kills - before;
}

describe("phase 85 — the tower defense engine", () => {
  it("the seeded spawner builds IDENTICAL waves on both machines", () => {
    const seed = 77;
    //the two construction paths the app actually uses: the page builds
    //the spawner from the pool + the seeded rng; the lan module wraps the
    //same pair — both must produce the identical waves
    const spawnerA = createTowerWaveSpawner({
      words: POOL,
      rng: createSeededRng(seed),
    });
    const spawnerB = towerLanSpawner(POOL, seed);
    const wavesA = [1, 2, 3].map((w) => spawnerA.spawnWave(w));
    const wavesB = [1, 2, 3].map((w) => spawnerB.spawnWave(w));
    for (let i = 0; i < 3; i++) {
      expect(wavesA[i]).toEqual(wavesB[i]);
    }
  });

  it("wave 3 carries a tank (long word, 3x score mult flag)", () => {
    const spawner = createTowerWaveSpawner({
      words: [...POOL, "stronghold", "typewriter"],
      rng: () => 0.5,
    });
    const wave3 = spawner.spawnWave(3);
    expect(wave3.some((s) => s.isTank)).toBe(true);
    const tank = wave3.find((s) => s.isTank) as { word: string };
    expect(tank.word.length).toBeGreaterThanOrEqual(BALANCE.tankMinLen);
  });

  it("the wave enemy count steps 5 -> 12", () => {
    expect(waveEnemyCount(1)).toBe(5);
    expect(waveEnemyCount(2)).toBe(6);
    expect(waveEnemyCount(9)).toBe(12);
  });

  it("targeting picks the enemy NEAREST the tower (largest y)", () => {
    const engine = createTowerDefenseEngine({
      spawnWave: () => [
        { word: "far", speed: 1, lane: 0, isTank: false },
        { word: "near", speed: 1, lane: 1, isTank: false },
      ],
    });
    //march until "near" is clearly the lowest
    engine.tick(6000);
    //typing 'n' engages the nearest enemy's word, not the far one's
    const state = engine.feedKey("n");
    const near = state.enemies.find((e) => e.word === "near");
    expect(near?.typed).toBe(1);
  });

  it("a breach costs 1 tower hp and breaks the kill combo", () => {
    const engine = createTowerDefenseEngine({
      spawnWave: () => [
        { word: "marcher", speed: 40, lane: 0, isTank: false },
        { word: "marcher", speed: 40, lane: 1, isTank: false },
        { word: "marcher", speed: 40, lane: 2, isTank: false },
      ],
    });
    //kill the first target: type its full word (the combo counts KILLS)
    let guard = 0;
    while (engine.state().kills < 1 && guard < 20) {
      guard++;
      const enemies = engine.state().enemies;
      const target =
        enemies.find((e) => e.typed > 0) ??
        enemies.reduce((best, e) => (best === undefined || e.y > best.y ? e : best), undefined);
      if (target === undefined) break;
      for (const ch of target.word) engine.feedKey(ch);
    }
    expect(engine.state().combo).toBe(1);
    //march until the FIRST breach: one breach = 1 hp + the streak broken
    //(later waves keep breaching — that is the game working as designed)
    let breached = false;
    for (let t = 0; t < 40 && !breached; t++) {
      const hpBefore = engine.state().towerHp;
      engine.tick(1000);
      if (engine.state().towerHp < hpBefore) breached = true;
    }
    expect(breached).toBe(true);
    expect(engine.state().towerHp).toBe(BALANCE.towerStartHp - 1);
    expect(engine.state().combo).toBe(0);
  });

  it("tower 0 ends the run with the result", () => {
    const engine = createTowerDefenseEngine({
      spawnWave: () => [
        { word: "marcher", speed: 40, lane: 0, isTank: false },
        { word: "marcher", speed: 40, lane: 1, isTank: false },
      ],
      towerHp: 2,
    });
    for (let t = 0; t < 60; t++) engine.tick(1000);
    expect(engine.state().phase).toBe("done");
    expect(engine.state().result).toBeDefined();
    expect(engine.state().result?.towerHp).toBe(0);
  });

  it("a cleared wave repairs the tower +2 (capped)", () => {
    const engine = createTowerDefenseEngine({
      spawnWave: (wave) =>
        Array.from({ length: waveEnemyCount(wave) }, (_, i) => ({
          word: "key",
          speed: 0.1,
          lane: i % BALANCE.lanes,
          isTank: false,
        })),
      towerHp: 7,
    });
    //destroy wave 1 by typing the ENGINE'S target (a started word first,
    //else the enemy nearest the tower) — never assume enemies[0]
    let guard = 0;
    while (
      engine.state().enemies.length > 0 &&
      engine.state().wave === 1 &&
      guard < 100
    ) {
      guard++;
      const enemies = engine.state().enemies;
      const target =
        enemies.find((e) => e.typed > 0) ??
        enemies.reduce((best, e) => (best === undefined || e.y > best.y ? e : best), undefined);
      if (target === undefined) break;
      for (const ch of target.word) engine.feedKey(ch);
    }
    //wave 1 cleared: the tower repaired to min(start, 7+2) = 9 and the
    //next wave already marching
    expect(engine.state().towerHp).toBe(9);
    expect(engine.state().wavesCleared).toBe(1);
    expect(engine.state().wave).toBe(2);
  });

  it("the verdict: the higher score wins, survival breaks the tie", () => {
    expect(
      resolveTowerVerdict({ score: 500, elapsedMs: 1000 }, {
        score: 400,
        elapsedMs: 500,
      }),
    ).toBe("won");
    expect(
      resolveTowerVerdict({ score: 400, elapsedMs: 1000 }, {
        score: 500,
        elapsedMs: 500,
      }),
    ).toBe("lost");
    //equal score: the LONGER survival wins
    expect(
      resolveTowerVerdict({ score: 400, elapsedMs: 9000 }, {
        score: 400,
        elapsedMs: 5000,
      }),
    ).toBe("won");
    expect(
      resolveTowerVerdict({ score: 400, elapsedMs: 5000 }, {
        score: 400,
        elapsedMs: 9000,
      }),
    ).toBe("lost");
    expect(
      resolveTowerVerdict({ score: 400, elapsedMs: 5000 }, {
        score: 400,
        elapsedMs: 5000,
      }),
    ).toBe("draw");
  });
});
