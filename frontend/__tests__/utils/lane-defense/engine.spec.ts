import { describe, expect, it } from "vitest";

import { BALANCE, comboMult } from "../../../src/ts/utils/lane-defense/balance";
import {
  createLaneDefenseEngine,
  type LaneDefenseState,
} from "../../../src/ts/utils/lane-defense/engine";
import type { EnemySpawn } from "../../../src/ts/utils/lane-defense/spawner";

function makeSpawnWave(
  words: string[],
  speed = 5,
): (wave: number) => EnemySpawn[] {
  return (wave: number) => {
    const spawns: EnemySpawn[] = words.map((word) => ({
      word,
      speed,
      lane: 0,
      isTank: false,
    }));
    if (wave % BALANCE.tankEveryWaves === 0 && spawns.length > 0) {
      spawns[spawns.length - 1] = {
        word: "defender",
        speed,
        lane: 0,
        isTank: true,
      };
    }
    return spawns;
  };
}

function createState(
  words: string[],
  speed = 5,
): {
  engine: ReturnType<typeof createLaneDefenseEngine>;
  state: () => LaneDefenseState;
} {
  const engine = createLaneDefenseEngine({
    spawnWave: makeSpawnWave(words, speed),
  });
  return { engine, state: () => engine.state() };
}

describe("lane defense engine (idea G9 phase 1)", () => {
  it("spawns the first wave staggered off the right edge", () => {
    const { state } = createState(["cat", "dog", "bird"]);
    const s = state();
    expect(s.wave).toBe(1);
    expect(s.enemies).toHaveLength(3);
    expect(s.wallHp).toBe(BALANCE.wallStartHp);
    for (let i = 1; i < s.enemies.length; i++) {
      expect(s.enemies[i]?.x).toBeGreaterThan(s.enemies[i - 1]?.x ?? 0);
    }
  });

  it("targeting: a started word first, else the enemy nearest the wall", () => {
    const { engine, state } = createState(["cat", "cod"]);
    //both start with c; nearest the wall = smallest x = the first-listed
    engine.feedKey("c");
    const started = state().enemies.find((e) => e.typed > 0);
    expect(started?.word).toBe("cat");
    //after finishing it, typing c again locks the next nearest
    engine.feedKey("a");
    engine.feedKey("t");
    engine.feedKey("c");
    expect(state().enemies.find((e) => e.typed > 0)?.word).toBe("cod");
  });

  it("a wrong key breaks the combo but keeps the typed progress", () => {
    const { engine, state } = createState(["cat"]);
    engine.feedKey("c");
    engine.feedKey("a");
    engine.feedKey("z"); //wrong: combo breaks, typed stays
    const s = state();
    expect(s.combo).toBe(0);
    expect(s.enemies[0]?.typed).toBe(2);
    expect(s.wallHp).toBe(BALANCE.wallStartHp); //no wall damage
  });

  it("completing a word kills the enemy and scores (tank pays 3x)", () => {
    const { engine, state } = createState(["cat"]);
    for (const ch of "cat") engine.feedKey(ch);
    let s = state();
    expect(s.kills).toBe(1);
    expect(s.score).toBe(3 * BALANCE.scorePerChar * comboMult(1));
    expect(s.wave).toBe(2); //the screen emptied -> wave 2
    //a tank wave: the tank's word scores 3x
    const tankEngine = createLaneDefenseEngine({
      spawnWave: (wave) =>
        wave % 3 === 0
          ? [{ word: "defender", speed: 5, lane: 0, isTank: true }]
          : [{ word: "cat", speed: 5, lane: 0, isTank: false }],
    });
    for (let w = 1; w <= 2; w++) {
      let guard = 0;
      while (tankEngine.state().wave === w && guard++ < 10) {
        const word = tankEngine.state().enemies[0]?.word ?? "";
        for (const ch of word) tankEngine.feedKey(ch);
      }
    }
    const scoreBeforeTank = tankEngine.state().score;
    for (const ch of "defender") tankEngine.feedKey(ch);
    s = tankEngine.state();
    expect(s.score).toBe(
      scoreBeforeTank +
        "defender".length * BALANCE.scorePerChar * BALANCE.tankScoreMult,
    );
  });

  it("a breach costs wall hp and breaks the combo; killing the rest repairs", () => {
    //a fast breacher + a slow survivor: the damage is observable MID-wave
    //(a breach that empties the screen heals +2 within the same tick)
    const engine = createLaneDefenseEngine({
      spawnWave: (wave) => [
        {
          word: wave % 3 === 0 ? "defender" : "cat",
          speed: 50,
          lane: 0,
          isTank: false,
        },
        {
          word: wave % 3 === 0 ? "guardian" : "dog",
          speed: 0.5,
          lane: 1,
          isTank: false,
        },
      ],
    });
    //the fast cat breaches first (the slow dog is still walking)
    engine.tick(20000);
    let s = engine.state();
    expect(s.wallHp).toBe(BALANCE.wallStartHp - 1);
    expect(s.combo).toBe(0);
    expect(s.enemies.length).toBeGreaterThan(0); //the wave continues
    //kill the survivor by typing: the wave clears -> +2 repair (capped)
    let guard = 0;
    while (engine.state().enemies.length > 0 && guard++ < 20) {
      const word = engine.state().enemies[0]?.word ?? "";
      for (const ch of word) engine.feedKey(ch);
    }
    s = engine.state();
    expect(s.wallHp).toBe(BALANCE.wallStartHp); //9 + 2 capped at 10
  });

  it("wall 0 ends the run with a result", () => {
    //wallHp 1 + a fast breacher: the very first breach ends the run
    const engine = createLaneDefenseEngine({
      spawnWave: (wave) => [
        {
          word: wave % 3 === 0 ? "defender" : "cat",
          speed: 50,
          lane: 0,
          isTank: false,
        },
        {
          word: wave % 3 === 0 ? "guardian" : "dog",
          speed: 0.5,
          lane: 1,
          isTank: false,
        },
      ],
      wallHp: 1,
    });
    engine.tick(20000);
    const s = engine.state();
    expect(s.phase).toBe("done");
    expect(s.wallHp).toBe(0);
    expect(s.result).toBeDefined();
    expect(s.result?.wave).toBeGreaterThan(0);
  });

  it("the snapshot hands out fresh enemy references (the KI-34 lesson)", () => {
    const { state } = createState(["cat"]);
    const a = state().enemies[0];
    const b = state().enemies[0];
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
