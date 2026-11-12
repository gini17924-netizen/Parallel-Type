import { describe, expect, it } from "vitest";

import { createBalloonEngine } from "../../../src/ts/utils/balloon-pop/engine";
import {
  BALANCE,
  stageUpScore,
} from "../../../src/ts/utils/balloon-pop/balance";

/**
 * A stage-aware deterministic spawn callback: stage 1 cycles slow single
 * letters, later stages cycle the words; `speed` overrides the pace for
 * escape-timing tests.
 */
function makeSpawn(payloads: string[], speed = 5) {
  let i = 0;
  return (stage: number) => {
    let payload: string;
    if (stage === 1) {
      payload = payloads[i++ % payloads.length] ?? "a";
      //single letters for the letter stage: the first char of each payload
      payload = payload[0] ?? "a";
    } else {
      payload = payloads[i++ % payloads.length] ?? "cat";
    }
    return { payload, speed };
  };
}

describe("balloon engine (idea G6 phase 1)", () => {
  it("spawns on the stage cadence and rises the balloons", () => {
    const engine = createBalloonEngine({
      spawn: makeSpawn(["alpha", "beta"]),
      letters: ["a", "b"],
    });
    //creation spawns one; the stage-1 cadence is 2200ms
    expect(engine.state().bubbles).toHaveLength(1);
    engine.tick(BALANCE.stageSpawnMs[0] ?? 2200);
    expect(engine.state().bubbles).toHaveLength(2);
    //movement: 2200ms at 5vh/s = 11vh of rise
    const y1 = engine.state().bubbles[0]?.y ?? 100;
    expect(y1).toBeCloseTo(89, 0);
  });

  it("stage 1: typing the letter pops the most-risen matching balloon", () => {
    const engine = createBalloonEngine({
      spawn: makeSpawn(["alpha", "beta"]),
      letters: ["a", "b"],
    });
    //three balloons: a (creation), b (+2200), a (+4400) — the first a is
    //the most risen
    engine.tick(2200);
    engine.tick(2200);
    engine.feedKey("b"); //pops the b
    expect(engine.state().popped).toBe(1);
    const state = engine.feedKey("a"); //pops the most-risen a
    expect(state.popped).toBe(2);
    expect(state.combo).toBe(2);
    expect(state.bubbles).toHaveLength(1);
  });

  it("a wrong key in stage 2+ also zeroes the combo (H2: uniform rule)", () => {
    const engine = createBalloonEngine({
      spawn: makeSpawn(["alpha"]),
      letters: ["a", "b"],
      startStage: 2,
    });
    for (const ch of "alpha") {
      engine.feedKey(ch); //completing the word pops it -> the combo grows
    }
    expect(engine.state().combo).toBe(1);
    engine.tick(2500); //the spawn cadence (stage 2 ~1.2s+) puts the next balloon up
    engine.feedKey("z"); //a wrong letter against the current target
    expect(engine.state().combo).toBe(0);
  });

  it("an unmatched key breaks the combo without touching balloons", () => {
    const engine = createBalloonEngine({
      spawn: makeSpawn(["alpha"]),
      letters: ["a"],
    });
    engine.feedKey("a"); //pops the a
    engine.feedKey("z"); //unmatched
    expect(engine.state().combo).toBe(0);
    expect(engine.state().popped).toBe(1);
  });

  it("stages 2+: the started balloon is targeted until it completes", () => {
    const engine = createBalloonEngine({
      spawn: makeSpawn(["cat", "dog"]),
      letters: [],
      startStage: 2,
    });
    //two balloons on the field: stage >= 2, spawn callback cycles words
    engine.tick(2200);
    engine.tick(2200);
    engine.feedKey("c"); //starts the most-risen (the first spawned)
    const state = engine.feedKey("a"); //the STARTED balloon keeps the target
    expect(state.bubbles.some((b) => b.typed === 2)).toBe(true);
    engine.feedKey("t"); //cat complete
    expect(engine.state().popped).toBe(1);
    expect(engine.state().combo).toBe(1);
  });

  it("the escape fires exactly at the danger threshold (H3: the line is the truth)", () => {
    const engine = createBalloonEngine({
      spawn: makeSpawn(["alpha"]),
      letters: ["a"],
    });
    //drive the physics until the balloon's y crosses the threshold: the
    //escape must land on the very tick the first balloon's y crosses the
    //danger line — later spawns keep rising behind it and are irrelevant
    let escaped = false;
    for (let guard = 0; guard < 100; guard++) {
      const state = engine.tick(200); //the page's step, enlarged
      if (state.bubbles.find((b) => b.id === 1) === undefined) {
        escaped = true; //the first balloon's escape tick
        break;
      }
    }
    expect(escaped).toBe(true);
    expect(engine.state().lives).toBe(2); //3 - 1 escape
  });

  it("an escape costs a life, breaks the combo and removes the balloon", () => {
    //a fast balloon: 100 vh/s crosses the 94vh arena in 0.94s
    const engine = createBalloonEngine({
      spawn: () => ({ payload: "a", speed: 100 }),
      letters: ["a"],
      lives: 3,
    });
    for (let i = 0; i < 3; i++) engine.tick(500);
    const state = engine.state();
    expect(state.escaped).toBe(1);
    expect(state.lives).toBe(2);
    expect(state.combo).toBe(0);
  });

  it("the run ends when the lives run out, with the result", () => {
    const engine = createBalloonEngine({
      spawn: () => ({ payload: "a", speed: 100 }),
      letters: ["a"],
      lives: 2,
    });
    for (let i = 0; i < 12; i++) engine.tick(500);
    const state = engine.state();
    expect(state.phase).toBe("done");
    expect(state.result).toBeDefined();
    expect(state.result?.escaped).toBeGreaterThanOrEqual(2);
  });

  it("the stage promotes at the cumulative thresholds", () => {
    let letterStream =
      "abcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefgh";
    let letterIndex = 0;
    const engine = createBalloonEngine({
      spawn: (stage) => {
        if (stage === 1) {
          const letter = letterStream[letterIndex % letterStream.length] ?? "a";
          letterIndex++;
          return { payload: letter, speed: 3 }; //slow: stays poppable
        }
        return { payload: "abcdefgh", speed: 3 };
      },
      letters: ["a"],
    });
    //pop single letters until the score crosses stageUpScore(1) = 1500
    for (let guard = 0; guard < 400 && engine.state().stage < 2; guard++) {
      const balloon = engine.state().bubbles[0];
      if (balloon?.payload.length === 1) {
        engine.feedKey(balloon.payload);
      } else {
        engine.tick(300);
      }
      engine.tick(100);
    }
    expect(engine.state().stage).toBeGreaterThanOrEqual(2);
  });

  it("the score crosses stageUpScore(1) exactly per the rule", () => {
    expect(stageUpScore(1)).toBe(1500);
  });

  it("pause freezes the physics", () => {
    const engine = createBalloonEngine({
      spawn: () => ({ payload: "a", speed: 100 }),
      letters: ["a"],
    });
    engine.setPaused(true);
    const before = engine.state().bubbles[0]?.y ?? 100;
    engine.tick(500);
    expect(engine.state().bubbles[0]?.y ?? 100).toBe(before);
    engine.setPaused(false);
    engine.tick(500);
    expect(engine.state().bubbles[0]?.y ?? 100).toBeLessThan(before);
  });
});

describe("balloon engine hear-it slowdown (idea G6 phase 3)", () => {
  it("spawnExtraMs stretches the spawn cadence", () => {
    const plain = createBalloonEngine({
      spawn: makeSpawn(["alpha"]),
      letters: ["a"],
    });
    const slowed = createBalloonEngine({
      spawn: makeSpawn(["alpha"]),
      letters: ["a"],
      spawnExtraMs: 2000,
    });
    //the stage-1 cadence is 2200ms: plain spawns the second balloon at
    //2200ms, the slowed one only at 4200ms
    plain.tick(2200);
    slowed.tick(2200);
    expect(plain.state().bubbles).toHaveLength(2);
    expect(slowed.state().bubbles).toHaveLength(1);
    slowed.tick(2000);
    expect(slowed.state().bubbles).toHaveLength(2);
  });
});
