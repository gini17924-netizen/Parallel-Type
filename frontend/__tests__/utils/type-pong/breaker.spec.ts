import { describe, expect, it } from "vitest";

import { BALANCE } from "../../../src/ts/utils/type-pong/balance";
import {
  createBreakerEngine,
  type BreakerEngine,
  type BreakerState,
} from "../../../src/ts/utils/type-pong/breaker";

function makeEngine(
  opts: {
    words?: string[];
    lives?: number;
  } = {},
): { engine: BreakerEngine; state: () => BreakerState } {
  let i = 0;
  const words = opts.words ?? ["cat", "dog", "bird", "fish"];
  const engine = createBreakerEngine({
    nextWord: () => words[i++ % words.length] ?? "cat",
    rng: (() => {
      let s = 7;
      return () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
      };
    })(),
    lives: opts.lives,
  });
  return { engine, state: () => engine.state() };
}

function activeWord(s: BreakerState): string {
  return s.activeWord ?? "";
}

describe("breaker engine (idea G13 phase 1, mode B)", () => {
  it("builds the 5x8 brick wall with words and hp", () => {
    const { state } = makeEngine();
    const s = state();
    expect(s.bricks).toHaveLength(BALANCE.breakerRows * BALANCE.breakerCols);
    expect(s.bricks.every((b) => b.word.length > 0)).toBe(true);
    //longer words get 2 hp
    const longBrick = s.bricks.find((b) => b.word.length >= 6);
    if (longBrick !== undefined) expect(longBrick.hp).toBe(2);
    const shortBrick = s.bricks.find((b) => b.word.length < 6);
    if (shortBrick !== undefined) expect(shortBrick.hp).toBe(1);
  });

  it("the active brick is the LOWEST alive one (nearest the paddle)", () => {
    const { engine, state } = makeEngine();
    //break the bottom row's brick by typing; the next active shifts up
    const first = activeWord(state());
    for (const ch of first) engine.feedKey(ch);
    const second = activeWord(state());
    expect(second).not.toBe(first); //shifted to a different brick
    const s = state();
    expect(s.bricks.filter((b) => b.alive).length).toBe(
      BALANCE.breakerRows * BALANCE.breakerCols - 1,
    );
  });

  it("completing a word breaks the brick and scores len x 20", () => {
    const { engine, state } = makeEngine({ words: ["cat"] });
    for (const ch of "cat") engine.feedKey(ch);
    const s = state();
    expect(s.bricksBroken).toBe(1);
    expect(s.score).toBe(3 * BALANCE.breakerScorePerChar);
  });

  it("a wrong char is inert (the paddle stalls)", () => {
    const { engine, state } = makeEngine({ words: ["cat"] });
    engine.feedKey("c");
    engine.feedKey("z"); //wrong
    const s = state();
    expect(s.activeTyped).toBe(1);
    expect(s.bricksBroken).toBe(0);
  });

  it("the ball damages bricks (AABB) and bounces off", () => {
    const { engine, state } = makeEngine();
    //the ball launches up: it will hit the brick wall eventually
    //idle-tick until the ball reaches the bricks
    for (let i = 0; i < 60; i++) engine.tick(50);
    const s = state();
    //some brick took damage (the ball collided)
    const damaged = s.bricks.filter(
      (b) => !b.alive || b.hp < (b.word.length >= 6 ? 2 : 1),
    );
    expect(damaged.length).toBeGreaterThan(0);
  });

  it("breaking every brick wins the run", () => {
    //the 40-brick wall with 2-letter words: type them all
    const { engine, state } = makeEngine({
      words: ["ab"],
      lives: 99,
    });
    let guard = 0;
    while (state().phase === "running" && guard++ < 100) {
      const word = activeWord(state());
      for (const ch of word) engine.feedKey(ch);
    }
    const s = state();
    expect(s.phase).toBe("won");
    expect(s.result?.won).toBe(true);
    expect(s.bricksBroken).toBe(40); //5 rows x 8 cols
  });

  it("losing every life ends the run (the ball escapes)", () => {
    //the ball launches up and comes down; the player never types → the
    //paddle never moves → the ball keeps escaping
    const { engine, state } = makeEngine({ lives: 1 });
    let guard = 0;
    while (state().phase === "running" && guard++ < 1000) {
      engine.tick(50);
    }
    const s = state();
    expect(s.phase).toBe("lost");
    expect(s.result?.won).toBe(false);
  });

  it("the snapshot hands out fresh brick references (the KI-34 lesson)", () => {
    const { state } = makeEngine();
    const a = state().bricks[0];
    const b = state().bricks[0];
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
