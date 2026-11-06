import { describe, it, expect } from "vitest";

import {
  effectiveWordLengths,
  goldEarned,
  startRound,
  submitWord,
} from "../../../src/ts/utils/deck-runner/round-engine";
import type {
  BlindConfig,
  RoundState,
} from "../../../src/ts/utils/deck-runner/round-engine";
import type { WordSource } from "../../../src/ts/utils/deck-runner/words-source";

function sourceFrom(words: string[]): WordSource & { queue: string[] } {
  const queue = [...words];
  return {
    queue,
    id: "test-src",
    nextWord: () => queue.shift() ?? "spare",
  };
}

function config(overrides: Partial<BlindConfig> = {}): BlindConfig {
  return {
    quota: 100000, //default: never won unless overridden
    wordBudget: 50,
    wordSourceId: "test-src",
    isBoss: false,
    ...overrides,
  };
}

function typeWord(
  state: RoundState,
  cfg: BlindConfig,
  src: ReturnType<typeof sourceFrom>,
  typed: string,
): RoundState {
  return submitWord(state, cfg, src, { typed, elapsedMs: 400 });
}

describe("deck-runner round engine (G24)", () => {
  it("startRound pulls the first word and sets budget", () => {
    const src = sourceFrom(["abc", "def"]);
    const state = startRound(config(), src);
    expect(state.currentWord).toBe("abc");
    expect(state.wordsLeft).toBe(50);
    expect(state.finished).toBe(false);
    expect(state.combo).toBe(0);
  });

  it("a correct word scores, grows the combo and advances", () => {
    const src = sourceFrom(["abc", "def", "ghi"]);
    let state = startRound(config(), src);
    state = typeWord(state, config(), src, "abc");
    expect(state.score).toBe(15); //3 chars × 5, mult 1
    expect(state.combo).toBe(1);
    expect(state.wordsLeft).toBe(49);
    expect(state.currentWord).toBe("def");
    expect(state.events[0]?.correct).toBe(true);
  });

  it("an incorrect word breaks the combo, counts errors and burns budget", () => {
    const src = sourceFrom(["abc", "abd", "abe"]);
    let state = startRound(config({ quota: 999999 }), src);
    state = typeWord(state, config({ quota: 999999 }), src, "abc");
    state = typeWord(state, config({ quota: 999999 }), src, "abd");
    state = typeWord(state, config({ quota: 999999 }), src, "abx"); //1 error vs abe
    expect(state.combo).toBe(0); //broken
    expect(state.events[2]?.correct).toBe(false);
    expect(state.events[2]?.errors).toBe(1);
    expect(state.events[2]?.accuracy).toBeCloseTo(2 / 3, 6);
    expect(state.wordsLeft).toBe(47);
  });

  it("skip burns budget but preserves the combo", () => {
    const src = sourceFrom(["abc", "skipme", "ghi"]);
    const cfg = config({ quota: 999999 });
    let state = startRound(cfg, src);
    state = typeWord(state, cfg, src, "abc");
    expect(state.combo).toBe(1);
    state = submitWord(state, cfg, src, { skipped: true });
    expect(state.combo).toBe(1); //survived
    expect(state.events[1]?.skipped).toBe(true);
    expect(state.wordsLeft).toBe(48);
  });

  it("crossing the quota finishes the round as won, immediately", () => {
    const src = sourceFrom(["abc", "def", "ghi"]);
    let state = startRound(config({ quota: 10, wordBudget: 10 }), src);
    state = typeWord(state, config({ quota: 10, wordBudget: 10 }), src, "abc");
    expect(state.finished).toBe(true);
    expect(state.won).toBe(true);
    expect(state.score).toBe(15);
    //currentWord frozen after finish
    expect(state.currentWord).toBe("abc");
  });

  it("exhausting the budget without the quota loses", () => {
    const src = sourceFrom(["abc"]);
    let state = startRound(config({ quota: 100, wordBudget: 1 }), src);
    state = typeWord(state, config({ quota: 100, wordBudget: 1 }), src, "abc");
    expect(state.finished).toBe(true);
    expect(state.won).toBe(false);
  });

  it("errorPenalty boss subtracts chips and floors at zero", () => {
    const src = sourceFrom(["abc", "xyz"]);
    const cfg = config({
      quota: 999999,
      wordBudget: 10,
      isBoss: true,
      bossRule: { kind: "errorPenalty", chips: 50 },
    });
    let state = startRound(cfg, src);
    state = typeWord(state, cfg, src, "xyz"); //wrong: score 15 then -50 -> floor 0
    expect(state.score).toBe(0);
  });

  it("perfectComboOnly freezes the combo on imperfect words", () => {
    const src = sourceFrom(["abc", "def", "abz", "ghi"]);
    const cfg = config({
      quota: 999999,
      isBoss: true,
      bossRule: { kind: "perfectComboOnly" },
    });
    let state = startRound(cfg, src);
    state = typeWord(state, cfg, src, "abc"); //combo 1
    state = typeWord(state, cfg, src, "def"); //combo 2
    state = typeWord(state, cfg, src, "abx"); //imperfect: frozen at 2
    expect(state.combo).toBe(2);
  });

  it("without the boss rule an imperfect word resets the combo", () => {
    const src = sourceFrom(["abc", "abd", "abe", "ghi"]);
    const cfg = config({ quota: 999999 });
    let state = startRound(cfg, src);
    state = typeWord(state, cfg, src, "abc");
    state = typeWord(state, cfg, src, "abd");
    state = typeWord(state, cfg, src, "abx"); //1 error vs abd
    expect(state.combo).toBe(0);
  });

  it("gold: won small = 3, won boss = 5, loss = 0", () => {
    const wonState = {
      score: 10,
      wordsLeft: 0,
      combo: 0,
      events: [],
      finished: true,
      won: true,
      currentWord: "",
    };
    const lostState = { ...wonState, won: false };
    expect(goldEarned(config(), wonState)).toBe(3);
    expect(goldEarned(config({ isBoss: true }), wonState)).toBe(5);
    expect(goldEarned(config(), lostState)).toBe(0);
  });

  it("longWords boss raises the source minimum length", () => {
    expect(
      effectiveWordLengths(
        config({ isBoss: true, bossRule: { kind: "longWords", minLength: 6 } }),
      ),
    ).toEqual({ minLength: 6, maxLength: 10 });
    expect(effectiveWordLengths(config())).toEqual({
      minLength: 3,
      maxLength: 10,
    });
  });
});
