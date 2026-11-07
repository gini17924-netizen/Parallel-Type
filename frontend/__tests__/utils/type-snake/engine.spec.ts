import { describe, expect, it } from "vitest";

import { BALANCE } from "../../../src/ts/utils/type-snake/balance";
import {
  createTypeSnakeEngine,
  type TypeSnakeEngine,
  type TypeSnakeState,
} from "../../../src/ts/utils/type-snake/engine";

function makeEngine(
  opts: {
    words?: string[];
    rng?: () => number;
    cols?: number;
    rows?: number;
    startSnake?: { x: number; y: number }[];
  } = {},
): { engine: TypeSnakeEngine; state: () => TypeSnakeState } {
  let i = 0;
  const words = opts.words ?? ["hi", "run"];
  const engine = createTypeSnakeEngine({
    foodWord: () => words[i++ % words.length] ?? "hi",
    rng: opts.rng ?? (() => 0.5),
    cols: opts.cols,
    rows: opts.rows,
    startSnake: opts.startSnake,
  });
  return { engine, state: () => engine.state() };
}

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

describe("type snake engine (idea G11 phase 1)", () => {
  it("spawns a 4-cell snake and a food off the body", () => {
    const { state } = makeEngine({ rng: makeRng(7) });
    const s = state();
    expect(s.snake).toHaveLength(BALANCE.startLength);
    expect(s.food).toBeDefined();
    const bodyKeys = new Set(s.snake.map((p) => `${p.x},${p.y}`));
    expect(bodyKeys.has(`${s.food?.x},${s.food?.y}`)).toBe(false);
  });

  it("the snake walks toward the food (auto-steer)", () => {
    const { engine, state } = makeEngine({ rng: makeRng(7) });
    const startDist =
      Math.abs((state().snake[0]?.x ?? 0) - (state().food?.x ?? 0)) +
      Math.abs((state().snake[0]?.y ?? 0) - (state().food?.y ?? 0));
    for (let i = 0; i < 6; i++) engine.tick(BALANCE.startIntervalMs);
    const endDist =
      Math.abs((state().snake[0]?.x ?? 0) - (state().food?.x ?? 0)) +
      Math.abs((state().snake[0]?.y ?? 0) - (state().food?.y ?? 0));
    expect(endDist).toBeLessThan(startDist);
  });

  it("the head waits on the food until the word is typed", () => {
    const { engine, state } = makeEngine({ rng: makeRng(7) });
    const food = state().food;
    //walk until the head stands on the food (generous cap)
    let guard = 0;
    while (
      guard++ < 400 &&
      (state().snake[0]?.x !== food?.x || state().snake[0]?.y !== food?.y)
    ) {
      engine.tick(BALANCE.startIntervalMs);
    }
    expect(state().snake[0]?.x).toBe(food?.x);
    expect(state().snake[0]?.y).toBe(food?.y);
    const before = state().snake.length;
    //unripe: the snake keeps waiting (no movement)
    engine.tick(BALANCE.startIntervalMs);
    expect(state().snake[0]?.x).toBe(food?.x);
    expect(state().snake.length).toBe(before);
  });

  it("typing the word ripens the food; the eat lands on arrival", () => {
    const { engine, state } = makeEngine({ rng: makeRng(7) });
    const food = state().food;
    const word = food?.word ?? "";
    for (const ch of word) engine.feedKey(ch);
    expect(state().food?.typed).toBe(word.length);
    //walk to the food: the eat lands automatically
    let guard = 0;
    while (state().eaten === 0 && guard++ < 400) {
      engine.tick(BALANCE.startIntervalMs);
    }
    const s = state();
    expect(s.eaten).toBe(1);
    expect(s.snake.length).toBe(BALANCE.startLength + 1);
    expect(s.score).toBe(word.length * BALANCE.scorePerChar);
    expect(s.combo).toBe(1);
    //a fresh food with a fresh word arrived
    expect(s.food?.typed).toBe(0);
  });

  it("a wrong letter is inert (no ripening)", () => {
    const { engine, state } = makeEngine({ rng: makeRng(7) });
    const word = state().food?.word ?? "";
    const wrongChar = word.startsWith("a") ? "z" : "a";
    engine.feedKey(wrongChar);
    expect(state().food?.typed).toBe(0);
  });

  it("every 5 foods the interval speeds up x1.1 (floored)", () => {
    const { engine, state } = makeEngine({ rng: makeRng(7) });
    const startInterval = state().intervalMs;
    //ripens + eats 5 foods: type, walk, repeat
    let guard = 0;
    while (state().eaten < 5 && guard++ < 3000) {
      const food = state().food;
      for (const ch of food?.word ?? "") engine.feedKey(ch);
      engine.tick(state().intervalMs); //one movement tick
      //walk to the food
      let walk = 0;
      while (
        walk++ < 400 &&
        state().eaten < 5 &&
        (state().snake[0]?.x !== state().food?.x ||
          state().snake[0]?.y !== state().food?.y)
      ) {
        engine.tick(state().intervalMs);
      }
    }
    expect(state().eaten).toBe(5);
    expect(state().intervalMs).toBe(
      Math.max(
        BALANCE.minIntervalMs,
        Math.round(startInterval / BALANCE.speedUpFactor),
      ),
    );
  });

  it("a surrounded snake dies with a result (the steer fallback exhausted)", () => {
    //a 5x4 grid with a 14-cell body: the head's four neighbors are ALL
    //body and the tail is far away (the tail-vacate cannot save it) —
    //the very first step has nowhere to go
    const { engine, state } = makeEngine({
      rng: makeRng(7),
      cols: 5,
      rows: 4,
      startSnake: [
        { x: 1, y: 1 }, //the head: boxed in by its own body
        { x: 2, y: 1 },
        { x: 3, y: 1 },
        { x: 4, y: 1 },
        { x: 4, y: 0 },
        { x: 3, y: 0 },
        { x: 2, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: 2 },
        { x: 1, y: 2 },
        { x: 2, y: 2 },
        { x: 3, y: 2 }, //the tail: NOT adjacent to the head
      ],
    });
    engine.tick(BALANCE.startIntervalMs);
    const s = state();
    expect(s.phase).toBe("done");
    expect(s.result).toBeDefined();
    expect(s.result?.length).toBe(14);
  });

  it("the snapshot hands out fresh snake references (the KI-34 lesson)", () => {
    const { state } = makeEngine({ rng: makeRng(7) });
    const a = state().snake[0];
    const b = state().snake[0];
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
