import { describe, expect, it } from "vitest";

import {
  createLetterStrikeEngine,
  type LetterStrikeState,
  type WaveSpawn,
} from "../../../src/ts/utils/letter-strike/engine";
import { BALANCE } from "../../../src/ts/utils/letter-strike/balance";

/** a wave callback with fixed words and a controllable speed; the boss
 * word rides the wave the test asks for */
function makeSpawnWave(
  words: string[],
  speed = 5,
): (wave: number) => WaveSpawn[] {
  return (wave: number) => {
    const spawns: WaveSpawn[] = words.map((word) => ({
      word,
      speed,
      isBoss: false,
    }));
    if (wave % BALANCE.bossEveryWaves === 0 && spawns.length > 0) {
      spawns[spawns.length - 1] = {
        word: "administration",
        speed,
        isBoss: true,
      };
    }
    return spawns;
  };
}

function createState(
  words: string[],
  speed = 5,
): {
  engine: ReturnType<typeof createLetterStrikeEngine>;
  state: () => LetterStrikeState;
} {
  const engine = createLetterStrikeEngine({
    spawnWave: makeSpawnWave(words, speed),
  });
  return { engine, state: () => engine.state() };
}

describe("letter strike engine (idea G8 phase 1)", () => {
  it("spawns the first wave staggered above the arena", () => {
    const { state } = createState(["cat", "dog", "bird", "fish"]);
    const s = state();
    expect(s.wave).toBe(1);
    expect(s.ships).toHaveLength(4);
    expect(s.lives).toBe(BALANCE.lives);
    expect(s.empCharged).toBe(false);
    //staggered: each next ship sits higher (smaller y)
    for (let i = 1; i < s.ships.length; i++) {
      expect(s.ships[i]?.y).toBeLessThan(s.ships[i - 1]?.y ?? 0);
    }
  });

  it("the first letter locks the NEAREST candidate and consumes it", () => {
    const { engine, state } = createState(["cat", "code"]);
    //both start with c: the nearest = largest y = the first-listed ship
    engine.feedKey("c");
    const locked = state().ships.find((s) => s.typed > 0);
    expect(state().lockedShipId).toBe(locked?.id);
    expect(locked?.typed).toBe(1);
  });

  it("completing a word destroys the ship and scores len x 10 x mult", () => {
    const { engine, state } = createState(["cat"]);
    for (const ch of "cat") engine.feedKey(ch);
    const s = state();
    //the screen never rests: destroying the last ship summons wave 2
    expect(s.ships).toHaveLength(1);
    expect(s.ships[0]?.typed).toBe(0);
    expect(s.combo).toBe(1);
    expect(s.score).toBe(3 * BALANCE.scorePerChar);
    expect(s.wave).toBe(2);
    expect(s.lockedShipId).toBeUndefined();
  });

  it("a wrong letter is inert, locked or not", () => {
    const { engine, state } = createState(["cat", "dog"]);
    engine.feedKey("c"); //lock cat, typed=1
    engine.feedKey("x"); //wrong while locked: no penalty
    let s = state();
    expect(s.ships.find((ship) => ship.word === "cat")?.typed).toBe(1);
    expect(s.combo).toBe(0);
    engine.feedKey("a");
    engine.feedKey("t"); //cat destroyed; combo=1
    engine.feedKey("z"); //wrong while unlocked: nothing locks
    s = state();
    expect(s.lockedShipId).toBeUndefined();
    expect(s.ships.every((ship) => ship.typed === 0)).toBe(true);
  });

  it("Backspace rewinds the lock one letter and releases at zero", () => {
    const { engine, state } = createState(["cat"]);
    engine.feedKey("c");
    engine.feedKey("a");
    engine.feedKey("Backspace");
    expect(state().ships[0]?.typed).toBe(1);
    engine.feedKey("Backspace");
    expect(state().ships[0]?.typed).toBe(0);
    expect(state().lockedShipId).toBeUndefined();
  });

  it("the boss needs two full passages: the prefix resets after the first", () => {
    const bossEngine = createLetterStrikeEngine({
      spawnWave: (wave) =>
        wave % 4 === 0
          ? [{ word: "administration", speed: 5, isBoss: true }]
          : [{ word: "cat", speed: 5, isBoss: false }],
    });
    //clear waves 1-3 (one ship each)
    for (let w = 1; w <= 3; w++) {
      let guard = 0;
      while (bossEngine.state().wave === w && guard++ < 10) {
        const word = bossEngine.state().ships[0]?.word ?? "";
        for (const ch of word) bossEngine.feedKey(ch);
      }
    }
    expect(bossEngine.state().wave).toBe(4);
    const boss = bossEngine.state().ships[0];
    expect(boss?.isBoss).toBe(true);
    expect(boss?.armorHp).toBe(BALANCE.bossArmor);
    const scoreBeforeBoss = bossEngine.state().score;
    //first full passage: prefix resets, ship stays, no score yet
    for (const ch of "administration") bossEngine.feedKey(ch);
    const afterFirst = bossEngine.state();
    expect(afterFirst.ships).toHaveLength(1);
    expect(afterFirst.ships[0]?.typed).toBe(0);
    expect(afterFirst.ships[0]?.armorHp).toBe(BALANCE.bossArmor - 1);
    expect(afterFirst.score).toBe(scoreBeforeBoss);
    //second passage: destroyed and scored
    for (const ch of "administration") bossEngine.feedKey(ch);
    const afterSecond = bossEngine.state();
    expect(afterSecond.ships.every((s) => !s.isBoss)).toBe(true);
    expect(afterSecond.score).toBe(
      scoreBeforeBoss + "administration".length * BALANCE.scorePerChar,
    );
  });

  it("the EMP clears every ship for no score and recharges every 3 waves", () => {
    const { engine, state } = createState(["cat", "dog", "bird", "fish"]);
    //Space before a charge: inert
    engine.feedKey(" ");
    expect(state().ships.length).toBe(4);
    //clear waves 1-3: after the 3rd cleared wave the EMP is charged
    for (let w = 1; w <= 3; w++) {
      let guard = 0;
      while (engine.state().wavesCleared < w && guard++ < 30) {
        const word = engine.state().ships[0]?.word ?? "";
        for (const ch of word) engine.feedKey(ch);
      }
    }
    expect(state().empCharged).toBe(true);
    const scoreBefore = state().score;
    const waveBefore = state().wave;
    engine.feedKey(" ");
    const s = state();
    expect(s.empCharged).toBe(false);
    expect(s.score).toBe(scoreBefore); //no score for the EMP
    expect(s.wave).toBe(waveBefore + 1); //the screen emptied -> next wave
    expect(s.ships.length).toBeGreaterThan(0);
  });

  it("a ship reaching the floor costs a life and breaks the combo", () => {
    const { engine, state } = createState(["cat"], 10);
    engine.feedKey("c");
    engine.feedKey("a");
    engine.feedKey("t");
    expect(state().combo).toBe(1);
    //fast-forward: the wave-2 ship falls far past the floor
    engine.tick(20000);
    const s = state();
    expect(s.lives).toBe(BALANCE.lives - 1);
    expect(s.combo).toBe(0);
    //the screen emptied by the escape -> wave 3 arrived
    expect(s.wave).toBe(3);
  });

  it("losing every life ends the run with a result", () => {
    const { engine, state } = createState(["cat"], 10);
    //three waves' worth of escapes: 3 lives
    let guard = 0;
    while (state().phase === "running" && guard++ < 60) {
      engine.tick(20000);
    }
    const s = state();
    expect(s.phase).toBe("done");
    expect(s.lives).toBe(0);
    expect(s.result).toBeDefined();
    expect(s.result?.wave).toBeGreaterThan(0);
  });

  it("the snapshot hands out fresh ship references (the KI-34 lesson)", () => {
    const { state } = createState(["cat"]);
    const a = state().ships[0];
    const b = state().ships[0];
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
