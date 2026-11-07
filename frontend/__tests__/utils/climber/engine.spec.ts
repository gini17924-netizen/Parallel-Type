import { describe, expect, it } from "vitest";

import { BALANCE } from "../../../src/ts/utils/climber/balance";
import {
  createClimberEngine,
  type ClimberEngine,
} from "../../../src/ts/utils/climber/engine";
import { stageOf, timerFor } from "../../../src/ts/utils/climber/gen";

const WORDS = ["cat", "sun", "map", "fox", "day", "ring", "mesh", "task"];

function makeEngine(): ClimberEngine {
  let i = 0;
  return createClimberEngine({
    wordFor: () => WORDS[i++ % WORDS.length] ?? "cat",
  });
}

/** types the active word cleanly */
function jump(engine: ClimberEngine): void {
  const word = engine.state().word;
  for (const ch of word) engine.feedKey(ch);
}

describe("sky climber engine (idea G15 phase 1, mode A)", () => {
  it("completing the word jumps one platform with stage scoring", () => {
    const engine = makeEngine();
    jump(engine);
    const state = engine.state();
    expect(state.platformIndex).toBe(1);
    expect(state.score).toBe(BALANCE.scorePerPlatform * stageOf(1));
    expect(state.word).not.toBe(WORDS[0]); //a fresh obligation
    expect(state.typed).toBe(0);
  });

  it("a wrong key resets the partial without falling (doc §۰.A.۳)", () => {
    const engine = makeEngine();
    const word = engine.state().word;
    engine.feedKey(word[0] ?? "c");
    engine.feedKey("z");
    const state = engine.state();
    expect(state.typed).toBe(0);
    expect(state.platformIndex).toBe(0); //no fall
    expect(state.totalFalls).toBe(0);
  });

  it("a timer zero falls ONE floor; the word and partial survive", () => {
    const engine = makeEngine();
    const word = engine.state().word;
    engine.feedKey(word[0] ?? "c");
    engine.feedKey(word[1] ?? "a");
    engine.tick(BALANCE.timerStartMs + 5000); //way past zero
    const state = engine.state();
    expect(state.totalFalls).toBe(1); //ONE fall per tick (doc §۵)
    expect(state.platformIndex).toBe(0); //already at the ground…
    expect(state.word).toBe(word); //the same obligation
    expect(state.typed).toBe(2); //the partial survived
  });

  it("the ground floor is death", () => {
    const engine = makeEngine();
    engine.tick(BALANCE.timerStartMs + 1000);
    const state = engine.state();
    expect(state.phase).toBe("done");
    expect(state.result?.height).toBe(0);
    expect(state.result?.falls).toBe(1);
  });

  it("two consecutive falls from the same platform = game over", () => {
    const engine = makeEngine();
    jump(engine); //index 1
    jump(engine); //index 2
    engine.tick(BALANCE.timerStartMs + 1000); //fall → 1
    jump(engine); //climb → 2, the chain breaks
    engine.tick(timerFor(2) + 1000); //fall → 1
    engine.tick(timerFor(1) + 1000); //a second fall with no jump between → death
    const state = engine.state();
    expect(state.phase).toBe("done");
    expect(state.result?.falls).toBe(3); //fall, jump, fall, fall
  });

  it("a successful jump breaks the fall chain", () => {
    const engine = makeEngine();
    jump(engine); //1
    engine.tick(BALANCE.timerStartMs + 1000); //fall → 0
    jump(engine); //1 — the chain resets
    expect(engine.state().consecutiveFalls).toBe(0);
    engine.tick(BALANCE.timerStartMs + 1000); //fall → 0
    expect(engine.state().phase).toBe("running"); //not two in a row
  });

  it("the timer shrinks with height (8s → 4s floor)", () => {
    const engine = makeEngine();
    expect(engine.state().timerFullMs).toBe(BALANCE.timerStartMs);
    for (let i = 0; i < 45; i++) jump(engine);
    const state = engine.state();
    expect(state.timerFullMs).toBe(BALANCE.timerMinMs); //the floor hit
    expect(state.platformIndex).toBe(45);
    expect(state.stage).toBe(4); //1 + floor(45/15)
  });

  it("the snapshot hands out fresh platform windows (the KI-34 lesson)", () => {
    const engine = makeEngine();
    const a = engine.state().platforms;
    const b = engine.state().platforms;
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
