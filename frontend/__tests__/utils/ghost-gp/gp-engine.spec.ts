import { describe, expect, it } from "vitest";

import { createGpEngine } from "../../../src/ts/utils/ghost-gp/gp-engine";

//the race mechanics are the duel engine's (idea G2, spec-tested there);
//these pin the ghost wiring: a 60wpm constant ghost over 3 two-char words
//finishes at 8 chars -> 1600ms
const WORDS = ["aa", "bb", "cc"];

describe("ghost-gp engine (idea G3 phase 1)", () => {
  it("the ghost crosses the finish line and wins an idle race", () => {
    const engine = createGpEngine({
      words: WORDS,
      ghost: { kind: "constant", wpm: 60, label: "ghost" },
    });
    engine.start(1000);
    const state = engine.tick(1000 + 1700);
    expect(state.phase).toBe("botWon");
    expect(state.finishedAtMs).toBe(1600);
    expect(state.botWordIndex).toBe(3);
  });

  it("a player completing the race strictly earlier wins against the ghost", () => {
    const engine = createGpEngine({
      words: WORDS,
      ghost: { kind: "constant", wpm: 60, label: "ghost" },
    });
    engine.start(1000);
    //word 0 and 1 done fast, the last completion at elapsed 300
    engine.feed({ type: "char", correct: true }, 1100);
    engine.feed({ type: "char", correct: true }, 1150);
    engine.feed({ type: "wordCompleted", errors: 0 }, 1200);
    engine.feed({ type: "char", correct: true }, 1300);
    engine.feed({ type: "char", correct: true }, 1350);
    engine.feed({ type: "wordCompleted", errors: 0 }, 1400);
    engine.feed({ type: "char", correct: true }, 1450);
    engine.feed({ type: "char", correct: true }, 1500);
    const state = engine.feed({ type: "wordCompleted", errors: 0 }, 1600 - 300);
    expect(state.phase).toBe("playerWon");
    expect(state.finishedAtMs).toBe(300);
    expect(state.playerCorrectChars).toBe(6);
  });

  it("a curve ghost paces by its accumulated per-second wpm", () => {
    //burst [240]: second 0 contributes 20 chars -> the 8-char race is
    //crossed at 400ms (20 chars/s), far before the constant-60 math would
    const engine = createGpEngine({
      words: WORDS,
      ghost: {
        kind: "curve",
        perSecondWpm: [240],
        averageWpm: 240,
        label: "g",
      },
    });
    engine.start(1000);
    const state = engine.tick(1000 + 450);
    expect(state.phase).toBe("botWon");
    expect(state.finishedAtMs).toBe(400);
  });
});
