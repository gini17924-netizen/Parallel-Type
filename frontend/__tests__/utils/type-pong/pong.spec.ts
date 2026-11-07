import { describe, expect, it } from "vitest";

import {
  createPongEngine,
  type PongEngine,
  type PongState,
} from "../../../src/ts/utils/type-pong/pong";

function makeEngine(
  opts: {
    aiSpeed?: number;
    words?: string[];
  } = {},
): { engine: PongEngine; state: () => PongState } {
  let i = 0;
  const words = opts.words ?? ["return", "volley"];
  const engine = createPongEngine({
    nextWord: () => words[i++ % words.length] ?? "return",
    rng: (() => {
      let s = 7;
      return () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
      };
    })(),
    aiSpeed: opts.aiSpeed ?? 40,
  });
  return { engine, state: () => engine.state() };
}

describe("type pong engine (idea G13 phase 1)", () => {
  it("serves the ball from the center with the first word", () => {
    const { state } = makeEngine();
    const s = state();
    expect(s.ball.x).toBe(50);
    expect(s.ball.y).toBe(50);
    expect(s.word.length).toBeGreaterThan(0);
    expect(s.playerScore).toBe(0);
    expect(s.aiScore).toBe(0);
  });

  it("each correct char pulls the paddle toward the ball's live x", () => {
    const { engine, state } = makeEngine();
    //let the ball drift away from the paddle's start first
    engine.tick(300);
    const startX = state().playerX;
    //completing the word snaps the paddle onto the ball's x (the paddle
    //is no longer at startX — the pull moved it)
    for (const ch of "return") engine.feedKey(ch);
    const after = state().playerX;
    expect(after).not.toBe(startX);
    expect(after).toBeCloseTo(state().ball.x, 4);
  });

  it("a wrong char stalls the paddle (inert)", () => {
    const { engine, state } = makeEngine();
    const before = state().playerX;
    engine.feedKey("z"); //wrong: inert
    expect(state().playerX).toBe(before);
    expect(state().typed).toBe(0);
  });

  it("the AI paddle tracks the ball at its capped speed", () => {
    const { engine, state } = makeEngine({ aiSpeed: 40 });
    const aiBefore = state().aiX;
    engine.tick(500); //0.5s at 40 units/s = up to 20 units
    const aiAfter = state().aiX;
    expect(Math.abs(aiAfter - aiBefore)).toBeLessThanOrEqual(20.5);
  });

  it("a passed paddle scores; first to 5 wins", () => {
    //the AI at speed 0: it never tracks — the ball eventually passes it
    const { engine, state } = makeEngine({ aiSpeed: 0 });
    //idle until someone reaches 5 (the ball keeps serving on points)
    let guard = 0;
    while (state().phase === "running" && guard++ < 3000) {
      engine.tick(50);
    }
    const s = state();
    expect(s.phase).toBe("done");
    expect(s.winner).toBeDefined();
    expect(s.playerScore >= 5 || s.aiScore >= 5).toBe(true);
    expect(s.result).toBeDefined();
  });

  it("the snapshot hands out fresh ball references (the KI-34 lesson)", () => {
    const { state } = makeEngine();
    const a = state().ball;
    const b = state().ball;
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
