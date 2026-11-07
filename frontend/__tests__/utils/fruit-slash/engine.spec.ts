import { describe, expect, it } from "vitest";

import {
  createFruitSlashEngine,
  type FruitSlashEngine,
  type FruitSlashState,
} from "../../../src/ts/utils/fruit-slash/engine";
import { BALANCE } from "../../../src/ts/utils/fruit-slash/balance";

/** the real game ticks at 50ms — big single steps make the semi-implicit
 * Euler arc overshoot, so every test drives time in 50ms chunks */
function tickFor(engine: FruitSlashEngine, ms: number): FruitSlashState {
  let left = ms;
  let state = engine.state();
  while (left > 0) {
    const step = Math.min(50, left);
    state = engine.tick(step);
    left -= step;
  }
  return state;
}

/** a controllable launcher: the words cycle in order; bombEvery marks
 * every Nth launch as a bomb (1 = all bombs). rng pinned to 0.5 unless
 * overridden: launch x=50, vy=-67.5, vx=+12 */
function makeEngine(
  words: string[],
  opts: {
    bombEvery?: number;
    rng?: () => number;
  } = {},
): { engine: FruitSlashEngine; state: () => FruitSlashState } {
  let i = 0;
  const engine = createFruitSlashEngine({
    spawn: () => {
      const word = words[i % words.length] ?? "fig";
      const isBomb =
        opts.bombEvery !== undefined && (i + 1) % opts.bombEvery === 0;
      i += 1;
      return { word, isBomb };
    },
    rng: opts.rng ?? (() => 0.5),
  });
  return { engine, state: () => engine.state() };
}

describe("fruit slash engine (idea G10 phase 1)", () => {
  it("launches into an arc: gravity bends the rise into a fall", () => {
    const { engine, state } = makeEngine(["fig"]);
    const y0 = state().fruits[0]?.y;
    expect(y0).toBe(BALANCE.launchYVh);
    tickFor(engine, 500); //still rising (apex at ~964ms)
    expect(state().fruits[0]?.y).toBeLessThan(y0 ?? 0);
    tickFor(engine, 1200); //the apex has passed: the fall took over
    expect(state().fruits[0]?.vy).toBeGreaterThan(0);
  });

  it("word-oriented matching: one keypress advances EVERY matching fruit", () => {
    const { engine, state } = makeEngine(["cat", "cot"]);
    tickFor(engine, 1500); //the cadence launches cot; cat is still airborne
    engine.feedKey("c");
    expect(state().fruits.every((f) => f.typed === 1)).toBe(true);
    //"o" advances cot but resets cat's partial (wrong for cat)
    engine.feedKey("o");
    const s = state();
    expect(s.fruits.find((f) => f.word === "cat")?.typed).toBe(0);
    expect(s.fruits.find((f) => f.word === "cot")?.typed).toBe(2);
  });

  it("completing a word slashes it; the apex adds the +30 bonus", () => {
    const { engine, state } = makeEngine(["fig"]);
    //slash immediately: age ~0 is far from the apex (~964ms) -> base only
    for (const ch of "fig") engine.feedKey(ch);
    const s = state();
    expect(s.slashed).toBe(1);
    expect(s.score).toBe(3 * BALANCE.scorePerChar);
    //the cadence launches the next fruit; slash it inside the apex window
    tickFor(engine, 1500);
    let guard = 0;
    while (
      guard++ < 40 &&
      Math.abs(
        (state().fruits[0]?.ageMs ?? 0) - (state().fruits[0]?.apexAtMs ?? 0),
      ) > 100
    ) {
      engine.tick(50);
    }
    for (const ch of "fig") engine.feedKey(ch);
    const s2 = state();
    //combo 2 still rides mult 1: base 30 + the 30 apex bonus
    expect(s2.slashed).toBe(2);
    expect(s2.score).toBe(
      s.score + 3 * BALANCE.scorePerChar + BALANCE.apexBonus,
    );
  });

  it("typing a bomb's word costs a life; three bombs end the run", () => {
    const { engine, state } = makeEngine(["boom"], { bombEvery: 1 });
    for (const ch of "boom") engine.feedKey(ch);
    expect(state().bombsTyped).toBe(1);
    expect(state().phase).toBe("running");
    //the next bomb spawns on the cadence; type it; then the third
    for (let bomb = 2; bomb <= 3; bomb++) {
      tickFor(engine, 1600);
      for (const ch of "boom") engine.feedKey(ch);
    }
    const s = state();
    expect(s.phase).toBe("done");
    expect(s.result?.endedBy).toBe("bombs");
    expect(s.result?.bombsTyped).toBe(3);
  });

  it("a bomb held half-typed for 2s defuses itself and scores", () => {
    const { engine, state } = makeEngine(["boom"], { bombEvery: 1 });
    engine.feedKey("b"); //partial bomb: the half-life clock starts
    expect(state().fruits[0]?.isBomb).toBe(true);
    tickFor(engine, BALANCE.bombHalfLifeMs + 100);
    expect(state().fruits[0]?.defused).toBe(true);
    //completing it now: slashed for score, no bomb counted
    for (const ch of "oom") engine.feedKey(ch);
    const s = state();
    expect(s.bombsTyped).toBe(0);
    expect(s.slashed).toBe(1);
  });

  it("a fruit landing is an escape (combo break)", () => {
    const { engine, state } = makeEngine(["fig"]);
    for (const ch of "fig") engine.feedKey(ch); //combo 1
    tickFor(engine, 4000); //fruits fall past the floor on the cadence
    const s = state();
    expect(s.escaped).toBeGreaterThanOrEqual(1);
    expect(s.combo).toBe(0);
  });

  it("the 90-second window ends the run with a result", () => {
    const { engine, state } = makeEngine(["fig"]);
    tickFor(engine, BALANCE.durationMs + 100);
    const s = state();
    expect(s.phase).toBe("done");
    expect(s.result?.endedBy).toBe("time");
    expect(s.result?.slashed).toBe(0);
  });

  it("the spawn cadence respects the 3-in-flight cap", () => {
    const { engine, state } = makeEngine(["fig"]);
    tickFor(engine, 6000); //several spawn intervals elapse
    expect(state().fruits.length).toBeLessThanOrEqual(BALANCE.maxInFlight);
  });

  it("the snapshot hands out fresh fruit references (the KI-34 lesson)", () => {
    const { state } = makeEngine(["fig"]);
    const a = state().fruits[0];
    const b = state().fruits[0];
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
